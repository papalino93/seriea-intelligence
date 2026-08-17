import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractErrorMessage } from '@/lib/error-message'
import {
  fitModel,
  scoreMatrix,
  market1X2,
  marketOverUnder,
  marketBTTS,
  topExactScores,
  teamRatings,
  type MatchResult,
} from '@/lib/prediction/dixon-coles'

export const maxDuration = 60

// Bump quando cambi la logica del modello (parametri, feature): versiona lo
// storico invece di sovrascriverlo, coerente col documento (sezione 17,
// "mai sovrascrivere le previsioni passate quando il modello viene aggiornato").
const MODEL_VERSION = 'dixon-coles-v1'

type FinishedMatchRow = {
  kickoff_at: string
  home_score: number | null
  away_score: number | null
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}

type UpcomingMatchRow = {
  id: number
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const hasValidSecret =
    !!process.env.SYNC_SECRET && authHeader === `Bearer ${process.env.SYNC_SECRET}`

  if (!hasValidSecret) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'richiede ruolo admin' }, { status: 403 })
  }

  const admin = createAdminClient()

  try {
    // ---- 1. Storico gol reali per il fit (mai xG/dati stimati, solo risultati veri) ----
    const { data: finished, error: finishedError } = await admin
      .from('matches')
      .select(
        `kickoff_at, home_score, away_score,
         home_team:teams!matches_home_team_id_fkey(id, name),
         away_team:teams!matches_away_team_id_fkey(id, name)`
      )
      .eq('status', 'finished')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
    if (finishedError) throw finishedError

    const trainMatches: MatchResult[] = ((finished as unknown as FinishedMatchRow[]) ?? [])
      .filter((m) => m.home_team && m.away_team)
      .map((m) => ({
        homeTeam: m.home_team!.name,
        awayTeam: m.away_team!.name,
        homeGoals: m.home_score!,
        awayGoals: m.away_score!,
        date: new Date(m.kickoff_at),
      }))

    if (trainMatches.length < 50) {
      // Con troppo poco storico il fit è inaffidabile — meglio dichiararlo che
      // produrre probabilità inventate. 50 è una soglia prudenziale, non una
      // costante magica: sotto quella il modello ha visto troppe poche
      // partite per stimare 2 parametri a squadra in modo sensato.
      return NextResponse.json(
        { error: `Solo ${trainMatches.length} partite concluse nel database: troppo poche per un fit affidabile (minimo 50). Carica lo storico dal pannello admin.` },
        { status: 422 }
      )
    }

    const fitted = fitModel(trainMatches, { asOf: new Date() })

    // ---- 2. Team ratings: snapshot dei parametri stimati ----
    const { data: teamsInDb } = await admin.from('teams').select('id, name')
    const ratings = teamRatings(fitted)
    const ratingRows = (teamsInDb ?? [])
      .filter((t) => fitted.teams.has(t.name))
      .map((t) => {
        const params = fitted.teams.get(t.name)!
        return {
          team_id: t.id,
          model_version: MODEL_VERSION,
          attack: params.attack,
          defense: params.defense,
          rating: ratings.get(t.name) ?? 0,
        }
      })
    if (ratingRows.length > 0) {
      const { error: ratingsError } = await admin.from('team_ratings').insert(ratingRows)
      if (ratingsError) throw ratingsError
    }

    // ---- 3. Previsioni per le partite non ancora giocate ----
    const { data: upcoming, error: upcomingError } = await admin
      .from('matches')
      .select(`id, home_team:teams!matches_home_team_id_fkey(id, name), away_team:teams!matches_away_team_id_fkey(id, name)`)
      .eq('status', 'scheduled')
    if (upcomingError) throw upcomingError

    let predicted = 0
    let skippedNewTeams = 0
    const predictionRows: Record<string, unknown>[] = []

    for (const m of (upcoming as unknown as UpcomingMatchRow[]) ?? []) {
      if (!m.home_team || !m.away_team) continue
      if (!fitted.teams.has(m.home_team.name) || !fitted.teams.has(m.away_team.name)) {
        // Squadra senza storico nel modello (es. neopromossa, nessun risultato
        // ancora giocato): non inventiamo una previsione, si salta.
        skippedNewTeams++
        continue
      }

      const matrix = scoreMatrix(fitted, m.home_team.name, m.away_team.name)
      const oneXTwo = market1X2(matrix)
      const overUnder = marketOverUnder(matrix, 2.5)
      const btts = marketBTTS(matrix)
      const topScores = topExactScores(matrix, 5)

      predictionRows.push({
        match_id: m.id,
        model_version: MODEL_VERSION,
        home_win: oneXTwo.home,
        draw: oneXTwo.draw,
        away_win: oneXTwo.away,
        over_2_5: overUnder.over,
        under_2_5: overUnder.under,
        btts_yes: btts.yes,
        btts_no: btts.no,
        top_scores: topScores,
        computed_at: new Date().toISOString(),
      })
      predicted++
    }

    if (predictionRows.length > 0) {
      const { error: predError } = await admin
        .from('predictions')
        .upsert(predictionRows, { onConflict: 'match_id,model_version' })
      if (predError) throw predError
    }

    await admin.from('sync_logs').insert({
      source: 'dixon-coles',
      sync_type: 'predictions',
      status: 'success',
      requests_used: 0,
      message: `${predicted} previsioni calcolate su ${trainMatches.length} partite storiche (${skippedNewTeams} partite saltate per squadre senza storico)`,
    })

    return NextResponse.json({ ok: true, predicted, skippedNewTeams, trainSize: trainMatches.length })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'dixon-coles',
      sync_type: 'predictions',
      status: 'error',
      requests_used: 0,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
