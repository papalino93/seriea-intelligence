import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/mail'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

const VALUE_EDGE_THRESHOLD = 0.03

type ValueSignalRow = {
  match_id: number
  outcome: 'home' | 'draw' | 'away'
  edge: number
  best_odds: number
  bookmaker_name: string
  matches: { home_team: { name: string } | null; away_team: { name: string } | null } | null
}

const OUTCOME_LABEL: Record<string, string> = { home: '1', draw: 'X', away: '2' }

/**
 * Fase 11: notifica via email i nuovi segnali "value" (non ancora notificati
 * in precedenza — dedup tramite notifications_sent, altrimenti ogni cron
 * giornaliero rimanderebbe la stessa email in loop).
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
    const { data: signals, error: signalsError } = await admin
      .from('value_signals')
      .select(
        `match_id, outcome, edge, best_odds, bookmaker_name,
         matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name))`
      )
      .gte('edge', VALUE_EDGE_THRESHOLD)
    if (signalsError) throw signalsError

    const { data: alreadySent } = await admin.from('notifications_sent').select('match_id, outcome').eq('kind', 'value_signal')
    const sentSet = new Set((alreadySent ?? []).map((r) => `${r.match_id}:${r.outcome}`))

    const newSignals = ((signals as unknown as ValueSignalRow[]) ?? []).filter(
      (s) => !sentSet.has(`${s.match_id}:${s.outcome}`)
    )

    if (newSignals.length === 0) {
      await admin.from('sync_logs').insert({
        source: 'notify',
        sync_type: 'notifications',
        status: 'success',
        requests_used: 0,
        message: 'nessun nuovo segnale da notificare',
      })
      return NextResponse.json({ ok: true, sent: 0 })
    }

    const { data: profiles } = await admin.from('profiles').select('email')
    const recipients = (profiles ?? []).map((p) => p.email).filter(Boolean)

    if (recipients.length > 0) {
      const listHtml = newSignals
        .map(
          (s) =>
            `<li>${s.matches?.home_team?.name ?? '—'} vs ${s.matches?.away_team?.name ?? '—'} — ${OUTCOME_LABEL[s.outcome]} @ ${s.best_odds.toFixed(2)} (${s.bookmaker_name}), edge ${(s.edge * 100).toFixed(1)} punti</li>`
        )
        .join('')
      await sendEmail(
        recipients,
        `Serie A Intelligence — ${newSignals.length} nuovi segnali value`,
        `<h2>Nuovi segnali "possibile value"</h2><ul>${listHtml}</ul><p>Probabilità stimate da un modello statistico, non un pronostico garantito.</p>`
      )
    }

    await admin.from('notifications_sent').insert(
      newSignals.map((s) => ({
        kind: 'value_signal',
        match_id: s.match_id,
        outcome: s.outcome,
        detail: `edge ${(s.edge * 100).toFixed(1)}pt @ ${s.best_odds.toFixed(2)} (${s.bookmaker_name})`,
      }))
    )

    await admin.from('sync_logs').insert({
      source: 'notify',
      sync_type: 'notifications',
      status: 'success',
      requests_used: 0,
      message: `${newSignals.length} nuovi segnali notificati a ${recipients.length} utenti`,
    })

    return NextResponse.json({ ok: true, sent: newSignals.length, recipients: recipients.length })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'notify',
      sync_type: 'notifications',
      status: 'error',
      requests_used: 0,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
