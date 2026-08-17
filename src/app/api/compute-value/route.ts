import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

type Outcome = 'home' | 'draw' | 'away'

type OddsRow = { match_id: number; bookmaker_id: number; outcome: Outcome; value: number }
type PredictionRow = { match_id: number; home_win: number; draw: number; away_win: number }

/**
 * Value Engine (documento di progettazione, sezione 9): confronta le
 * probabilità del modello con quelle implicite dalle quote, NORMALIZZATE per
 * rimuovere il margine del bookmaker (l'overround) — altrimenti l'EV
 * calcolato è sistematicamente distorto verso il pessimismo, come segnalato
 * esplicitamente nel documento. La normalizzazione è per bookmaker: sommare
 * le probabilità implicite di 1/X/2 di bookmaker DIVERSI non avrebbe senso,
 * ogni bookmaker ha il proprio margine.
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
    if (!user) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'richiede ruolo admin' }, { status: 403 })
  }

  const admin = createAdminClient()

  try {
    const { data: predictions, error: predError } = await admin
      .from('predictions')
      .select('match_id, home_win, draw, away_win')
    if (predError) throw predError

    const { data: odds, error: oddsError } = await admin
      .from('odds')
      .select('match_id, bookmaker_id, outcome, value')
      .eq('is_current', true)
    if (oddsError) throw oddsError

    const { data: bookmakers } = await admin.from('bookmakers').select('id, name')
    const bookmakerNameById = new Map((bookmakers ?? []).map((b) => [b.id, b.name]))

    const predictionByMatch = new Map((predictions as PredictionRow[]).map((p) => [p.match_id, p]))

    // ---- raggruppa quote per partita+bookmaker, così possiamo normalizzare correttamente ----
    const oddsByMatchBookmaker = new Map<string, Partial<Record<Outcome, number>>>()
    for (const o of odds as OddsRow[]) {
      const key = `${o.match_id}:${o.bookmaker_id}`
      const entry = oddsByMatchBookmaker.get(key) ?? {}
      entry[o.outcome] = o.value
      oddsByMatchBookmaker.set(key, entry)
    }

    // ---- per ogni (match, outcome): trova la miglior EV tra i bookmaker con quotazione completa 1X2 ----
    type Best = { edge: number; ev: number; impliedProbability: number; bestOdds: number; bookmakerName: string }
    const bestByMatchOutcome = new Map<string, Best>()

    for (const [key, byOutcome] of oddsByMatchBookmaker) {
      const [matchIdStr, bookmakerIdStr] = key.split(':')
      const matchId = Number(matchIdStr)
      const bookmakerId = Number(bookmakerIdStr)
      const prediction = predictionByMatch.get(matchId)
      if (!prediction) continue
      if (byOutcome.home == null || byOutcome.draw == null || byOutcome.away == null) continue

      const rawImplied = {
        home: 1 / byOutcome.home,
        draw: 1 / byOutcome.draw,
        away: 1 / byOutcome.away,
      }
      const overround = rawImplied.home + rawImplied.draw + rawImplied.away
      const normalizedImplied = {
        home: rawImplied.home / overround,
        draw: rawImplied.draw / overround,
        away: rawImplied.away / overround,
      }
      const modelProb = { home: prediction.home_win, draw: prediction.draw, away: prediction.away_win }

      for (const outcome of ['home', 'draw', 'away'] as const) {
        const edge = modelProb[outcome] - normalizedImplied[outcome]
        const decimalOdds = byOutcome[outcome]!
        const ev = modelProb[outcome] * decimalOdds - 1

        const outKey = `${matchId}:${outcome}`
        const existing = bestByMatchOutcome.get(outKey)
        if (!existing || ev > existing.ev) {
          bestByMatchOutcome.set(outKey, {
            edge,
            ev,
            impliedProbability: normalizedImplied[outcome],
            bestOdds: decimalOdds,
            bookmakerName: bookmakerNameById.get(bookmakerId) ?? 'sconosciuto',
          })
        }
      }
    }

    const rows = Array.from(bestByMatchOutcome.entries()).map(([key, best]) => {
      const [matchIdStr, outcome] = key.split(':')
      const matchId = Number(matchIdStr)
      const prediction = predictionByMatch.get(matchId)!
      const modelProb = { home: prediction.home_win, draw: prediction.draw, away: prediction.away_win }[
        outcome as Outcome
      ]
      return {
        match_id: matchId,
        outcome,
        model_probability: modelProb,
        implied_probability: best.impliedProbability,
        best_odds: best.bestOdds,
        bookmaker_name: best.bookmakerName,
        edge: best.edge,
        ev: best.ev,
        computed_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      const { error: insertError } = await admin.from('value_signals').upsert(rows, { onConflict: 'match_id,outcome' })
      if (insertError) throw insertError
    }

    const valueCount = rows.filter((r) => r.edge >= 0.03).length

    await admin.from('sync_logs').insert({
      source: 'value-engine',
      sync_type: 'value',
      status: 'success',
      requests_used: 0,
      message: `${rows.length} segnali calcolati, ${valueCount} con edge ≥ 3 punti percentuali`,
    })

    return NextResponse.json({ ok: true, computed: rows.length, valueCount })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'value-engine',
      sync_type: 'value',
      status: 'error',
      requests_used: 0,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
