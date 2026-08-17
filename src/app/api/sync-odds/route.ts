import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSerieAOdds, teamNamesMatch, type OddsApiEvent } from '@/lib/odds-api'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

type AdminClient = ReturnType<typeof createAdminClient>

interface InternalMatch {
  id: number
  kickoff_at: string
  home_team: { name: string } | null
  away_team: { name: string } | null
}

/**
 * Trova la partita interna corrispondente a un evento The Odds API: le due
 * fonti dati usano nomi squadra diversi (vedi lib/odds-api.ts) e non
 * condividono un id, quindi il matching è per nome (normalizzato) + prossimità
 * di data — necessaria per non confondere andata e ritorno tra le stesse due squadre.
 */
function findInternalMatch(event: OddsApiEvent, candidates: InternalMatch[]): InternalMatch | null {
  const eventDate = new Date(event.commence_time).getTime()
  let best: InternalMatch | null = null
  let bestDiff = Infinity

  for (const m of candidates) {
    if (!m.home_team || !m.away_team) continue
    if (!teamNamesMatch(event.home_team, m.home_team.name)) continue
    if (!teamNamesMatch(event.away_team, m.away_team.name)) continue

    const diff = Math.abs(new Date(m.kickoff_at).getTime() - eventDate)
    if (diff < bestDiff) {
      bestDiff = diff
      best = m
    }
  }

  // Oltre 3 giorni di scarto: troppo lontano per essere la stessa partita,
  // meglio scartare che abbinare male (coerente con "mai dati inventati/sbagliati").
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000
  return bestDiff <= THREE_DAYS_MS ? best : null
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

  const admin: AdminClient = createAdminClient()
  let requestsUsed = 0

  try {
    const events = await fetchSerieAOdds()
    requestsUsed += 1

    const { data: candidates, error: matchesError } = await admin
      .from('matches')
      .select('id, kickoff_at, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)')
      .eq('status', 'scheduled')
    if (matchesError) throw matchesError

    // ---- Bookmaker: dedup, upsert batch ----
    const bookmakersByKey = new Map<string, { external_key: string; name: string }>()
    for (const ev of events) {
      for (const bk of ev.bookmakers) {
        bookmakersByKey.set(bk.key, { external_key: bk.key, name: bk.title })
      }
    }
    const { data: bookmakers, error: bkError } = await admin
      .from('bookmakers')
      .upsert(Array.from(bookmakersByKey.values()), { onConflict: 'external_key' })
      .select()
    if (bkError) throw bkError
    const bookmakerIdByKey = new Map(bookmakers.map((b) => [b.external_key, b.id]))

    // ---- Mercato 1X2 (h2h): singola riga ----
    const { data: market, error: marketError } = await admin
      .from('markets')
      .upsert({ market_type: 'h2h', market_label: '1X2' }, { onConflict: 'market_type' })
      .select()
      .single()
    if (marketError) throw marketError

    // ---- Abbinamento eventi -> partite interne ----
    const matchedMatchIds = new Set<number>()
    const oddsRows: { match_id: number; bookmaker_id: number; market_id: number; outcome: string; value: number }[] = []
    let unmatchedEvents = 0

    for (const ev of events) {
      const internal = findInternalMatch(ev, candidates as unknown as InternalMatch[])
      if (!internal) {
        unmatchedEvents++
        continue
      }
      matchedMatchIds.add(internal.id)

      for (const bk of ev.bookmakers) {
        const bookmakerId = bookmakerIdByKey.get(bk.key)
        if (!bookmakerId) continue
        const h2h = bk.markets.find((m) => m.key === 'h2h')
        if (!h2h) continue

        for (const outcome of h2h.outcomes) {
          let key: 'home' | 'draw' | 'away' | null = null
          if (outcome.name === 'Draw') key = 'draw'
          else if (teamNamesMatch(outcome.name, ev.home_team)) key = 'home'
          else if (teamNamesMatch(outcome.name, ev.away_team)) key = 'away'
          if (!key) continue

          oddsRows.push({ match_id: internal.id, bookmaker_id: bookmakerId, market_id: market.id, outcome: key, value: outcome.price })
        }
      }
    }

    // ---- Rilevamento variazione quota significativa (Fase 11): confronta la
    // migliore quota per esito PRIMA di questo sync con quella nuova, prima
    // di marcare le righe vecchie come storiche (altrimenti perdiamo il valore
    // "prima"). Soglia 15%: sotto è normale oscillazione, sopra è degno di nota.
    const MOVEMENT_THRESHOLD = 0.15
    let significantMovements = 0
    if (matchedMatchIds.size > 0) {
      const { data: previousOdds } = await admin
        .from('odds')
        .select('match_id, outcome, value')
        .in('match_id', Array.from(matchedMatchIds))
        .eq('is_current', true)

      const previousBest = new Map<string, number>()
      for (const o of previousOdds ?? []) {
        const key = `${o.match_id}:${o.outcome}`
        previousBest.set(key, Math.max(previousBest.get(key) ?? 0, o.value))
      }
      const newBest = new Map<string, number>()
      for (const r of oddsRows) {
        const key = `${r.match_id}:${r.outcome}`
        newBest.set(key, Math.max(newBest.get(key) ?? 0, r.value))
      }

      const movementRows: { match_id: number; outcome: string; old_value: number; new_value: number; pct_change: number }[] = []
      for (const [key, newValue] of newBest) {
        const oldValue = previousBest.get(key)
        if (!oldValue) continue // prima volta che vediamo quote per questa partita: non è una "variazione"
        const pctChange = (newValue - oldValue) / oldValue
        if (Math.abs(pctChange) >= MOVEMENT_THRESHOLD) {
          const [matchIdStr, outcome] = key.split(':')
          movementRows.push({ match_id: Number(matchIdStr), outcome, old_value: oldValue, new_value: newValue, pct_change: pctChange })
        }
      }
      if (movementRows.length > 0) {
        await admin.from('odds_movements').insert(movementRows)
        significantMovements = movementRows.length
      }
    }

    // ---- Append-only: le righe correnti diventano storiche, poi si inseriscono le nuove ----
    if (matchedMatchIds.size > 0) {
      const { error: staleError } = await admin
        .from('odds')
        .update({ is_current: false })
        .in('match_id', Array.from(matchedMatchIds))
        .eq('is_current', true)
      if (staleError) throw staleError
    }

    if (oddsRows.length > 0) {
      const { error: insertError } = await admin.from('odds').insert(oddsRows)
      if (insertError) throw insertError
    }

    await admin.from('sync_logs').insert({
      source: 'the-odds-api',
      sync_type: 'odds',
      status: 'success',
      requests_used: requestsUsed,
      message: `${matchedMatchIds.size} partite con quote aggiornate (${oddsRows.length} righe), ${unmatchedEvents} eventi non abbinati, ${significantMovements} variazioni significative`,
    })

    return NextResponse.json({
      ok: true,
      matched: matchedMatchIds.size,
      unmatchedEvents,
      oddsRows: oddsRows.length,
      significantMovements,
      requestsUsed,
    })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'the-odds-api',
      sync_type: 'odds',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
