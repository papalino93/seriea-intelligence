import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSeasonMatches } from '@/lib/football-data'
import { syncMatchesToDb } from '@/lib/sync-matches'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

/**
 * Sincronizza calendario, squadre e giornate della stagione CORRENTE di Serie
 * A da football-data.org. Budget: 1 richiesta per esecuzione — ampiamente
 * dentro il tier gratuito (10 richieste/minuto, nessun limite giornaliero).
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

    const { seasonYear, matchCount } = await syncMatchesToDb(admin, apiCompetition, matches, true)

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'calendar',
      status: 'success',
      requests_used: requestsUsed,
      message: `${matchCount} partite sincronizzate (stagione ${seasonYear})`,
    })

    return NextResponse.json({ ok: true, matches: matchCount, requestsUsed })
  } catch (err) {
    const message = extractErrorMessage(err)
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
