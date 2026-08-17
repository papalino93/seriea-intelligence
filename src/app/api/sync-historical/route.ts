import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSeasonMatchesForYear } from '@/lib/football-data'
import { syncMatchesToDb } from '@/lib/sync-matches'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

// Stagioni note come accessibili sul piano free di football-data.org al
// momento della scrittura (2023, 2024 — 2025/26 è la corrente, sincronizzata
// da /api/sync). Anni precedenti restituiscono 403: gestito come skip, non errore fatale.
const HISTORICAL_YEARS = [2023, 2024]

/**
 * Backfill una tantum dello storico Serie A (Fase 3: serve per "Precedenti"
 * nella pagina partita, che altrimenti resterebbe vuoto per mesi finché non
 * si accumula naturalmente stagione per stagione). Non è pensata per girare
 * ripetutamente: la stagione corrente resta sempre sincronizzata da /api/sync.
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
  let requestsUsed = 0
  const results: string[] = []

  try {
    for (const year of HISTORICAL_YEARS) {
      try {
        const { competition: apiCompetition, matches } = await fetchSeasonMatchesForYear(year)
        requestsUsed += 1
        const { seasonYear, matchCount } = await syncMatchesToDb(admin, apiCompetition, matches, false)
        results.push(`${seasonYear}: ${matchCount} partite`)
      } catch (yearErr) {
        // Un anno non accessibile (403, cambio policy del provider) non deve
        // bloccare gli altri: si registra e si continua.
        results.push(`${year}: non accessibile (${extractErrorMessage(yearErr)})`)
      }
    }

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'historical-backfill',
      status: 'success',
      requests_used: requestsUsed,
      message: results.join(' · '),
    })

    return NextResponse.json({ ok: true, results, requestsUsed })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'historical-backfill',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
