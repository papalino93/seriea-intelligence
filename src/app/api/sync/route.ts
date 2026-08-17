import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSeasonMatches, mapMatchStatus, type FootballDataMatch } from '@/lib/football-data'

export const maxDuration = 60

/**
 * Sincronizza calendario, squadre e giornate di Serie A da football-data.org.
 * Budget: 1 richiesta per esecuzione — ampiamente dentro il tier gratuito
 * (10 richieste/minuto, nessun limite giornaliero).
 *
 * Le scritture su Postgres sono in batch (un upsert per tabella, non uno per
 * partita): con ~380 partite a stagione, centinaia di round-trip sequenziali
 * rischierebbero il timeout della funzione serverless.
 *
 * Autorizzazione, due percorsi:
 *  1. Sessione utente con ruolo admin (pulsante nel pannello admin).
 *  2. Header "Authorization: Bearer <SYNC_SECRET>" (per un futuro cron esterno,
 *     dato che il piano gratuito Vercel limita i cron nativi a 1x/giorno —
 *     vedi documento di progettazione, sezione 13).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const hasValidSecret =
    !!process.env.SYNC_SECRET && authHeader === `Bearer ${process.env.SYNC_SECRET}`

  if (!hasValidSecret) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'richiede ruolo admin' }, { status: 403 })
    }
  }

  const admin = createAdminClient()
  let requestsUsed = 0

  try {
    const { competition: apiCompetition, matches } = await fetchSeasonMatches()
    requestsUsed += 1

    const { data: competition, error: compError } = await admin
      .from('competitions')
      .upsert(
        { external_id: apiCompetition.id, name: apiCompetition.name, country: 'Italy' },
        { onConflict: 'external_id' }
      )
      .select()
      .single()
    if (compError) throw compError

    const seasonInfo = matches[0]?.season
    const seasonYear = seasonInfo ? new Date(seasonInfo.startDate).getFullYear() : new Date().getFullYear()
    const seasonExternalId = seasonInfo?.id ?? apiCompetition.id * 10000 + seasonYear

    const { data: season, error: seasonError } = await admin
      .from('seasons')
      .upsert(
        { competition_id: competition.id, year: seasonYear, external_id: seasonExternalId, is_current: true },
        { onConflict: 'competition_id,year' }
      )
      .select()
      .single()
    if (seasonError) throw seasonError

    // ---- Squadre: dedup per external_id, un solo upsert batch ----
    const teamsByExternalId = new Map<number, { external_id: number; name: string; logo_url: string | null }>()
    for (const m of matches) {
      teamsByExternalId.set(m.homeTeam.id, {
        external_id: m.homeTeam.id,
        name: m.homeTeam.name,
        logo_url: m.homeTeam.crest,
      })
      teamsByExternalId.set(m.awayTeam.id, {
        external_id: m.awayTeam.id,
        name: m.awayTeam.name,
        logo_url: m.awayTeam.crest,
      })
    }
    const { data: teams, error: teamsError } = await admin
      .from('teams')
      .upsert(Array.from(teamsByExternalId.values()), { onConflict: 'external_id' })
      .select()
    if (teamsError) throw teamsError
    const teamIdByExternalId = new Map(teams.map((t) => [t.external_id, t.id]))

    // ---- Giornate: dedup per matchday, un solo upsert batch ----
    const matchdays = [...new Set(matches.map((m) => m.matchday))]
    const { data: rounds, error: roundsError } = await admin
      .from('rounds')
      .upsert(
        matchdays.map((round_number) => ({
          season_id: season.id,
          round_number,
          label: `Giornata ${round_number}`,
        })),
        { onConflict: 'season_id,round_number' }
      )
      .select()
    if (roundsError) throw roundsError
    const roundIdByNumber = new Map(rounds.map((r) => [r.round_number, r.id]))

    // ---- Partite: un solo upsert batch ----
    const matchRows = matches.map((m: FootballDataMatch) => ({
      external_id: m.id,
      season_id: season.id,
      round_id: roundIdByNumber.get(m.matchday) ?? null,
      home_team_id: teamIdByExternalId.get(m.homeTeam.id),
      away_team_id: teamIdByExternalId.get(m.awayTeam.id),
      kickoff_at: m.utcDate,
      venue: m.venue,
      status: mapMatchStatus(m.status),
      home_score: m.score.fullTime.home,
      away_score: m.score.fullTime.away,
      home_score_ht: m.score.halfTime.home,
      away_score_ht: m.score.halfTime.away,
      referee_name: m.referees?.[0]?.name ?? null,
      updated_at: new Date().toISOString(),
    }))
    if (matchRows.length > 0) {
      const { error: matchesError } = await admin
        .from('matches')
        .upsert(matchRows, { onConflict: 'external_id' })
      if (matchesError) throw matchesError
    }

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'calendar',
      status: 'success',
      requests_used: requestsUsed,
      message: `${matches.length} partite sincronizzate (stagione ${seasonYear})`,
    })

    return NextResponse.json({ ok: true, matches: matches.length, requestsUsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'errore sconosciuto'
    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'calendar',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
