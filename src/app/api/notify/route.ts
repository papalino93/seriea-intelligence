import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/mail'
import { extractErrorMessage } from '@/lib/error-message'
import { VALUE_EDGE_THRESHOLD } from '@/lib/constants'

export const maxDuration = 60

type ValueSignalRow = {
  match_id: number
  outcome: 'home' | 'draw' | 'away'
  edge: number
  best_odds: number
  bookmaker_name: string
  matches: { home_team: { name: string } | null; away_team: { name: string } | null } | null
}

type OddsMovementRow = {
  match_id: number
  outcome: 'home' | 'draw' | 'away'
  old_value: number
  new_value: number
  pct_change: number
  detected_at: string
  matches: { home_team: { name: string } | null; away_team: { name: string } | null } | null
}

const OUTCOME_LABEL: Record<string, string> = { home: 'vittoria squadra di casa (1)', draw: 'pareggio (X)', away: 'vittoria squadra ospite (2)' }

/**
 * Fase 11: notifica via email nuovi segnali "value" e variazioni quota
 * significative — dedup tramite notifications_sent, altrimenti ogni cron
 * giornaliero rimanderebbe la stessa email in loop. Per le variazioni quota:
 * al massimo una notifica per (partita, esito) — se le quote continuano a
 * muoversi dopo la prima notifica, non rimandiamo email su email per lo
 * stesso match, scelta deliberata contro l'affaticamento da notifiche.
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

    const { data: movements, error: movementsError } = await admin
      .from('odds_movements')
      .select(
        `match_id, outcome, old_value, new_value, pct_change, detected_at,
         matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name))`
      )
      .order('detected_at', { ascending: false })
    if (movementsError) throw movementsError

    const { data: alreadySent } = await admin.from('notifications_sent').select('kind, match_id, outcome')
    const sentSet = new Set((alreadySent ?? []).map((r) => `${r.kind}:${r.match_id}:${r.outcome}`))

    const newSignals = ((signals as unknown as ValueSignalRow[]) ?? []).filter(
      (s) => !sentSet.has(`value_signal:${s.match_id}:${s.outcome}`)
    )

    // Una sola riga per (match, outcome): la più recente non ancora notificata.
    const seenMovementKeys = new Set<string>()
    const newMovements = ((movements as unknown as OddsMovementRow[]) ?? []).filter((m) => {
      const key = `${m.match_id}:${m.outcome}`
      if (sentSet.has(`odds_movement:${m.match_id}:${m.outcome}`)) return false
      if (seenMovementKeys.has(key)) return false
      seenMovementKeys.add(key)
      return true
    })

    if (newSignals.length === 0 && newMovements.length === 0) {
      await admin.from('sync_logs').insert({
        source: 'notify',
        sync_type: 'notifications',
        status: 'success',
        requests_used: 0,
        message: 'nessun nuovo segnale o variazione da notificare',
      })
      return NextResponse.json({ ok: true, sent: 0 })
    }

    const { data: profiles } = await admin.from('profiles').select('email')
    const recipients = (profiles ?? []).map((p) => p.email).filter(Boolean)

    if (recipients.length === 0) {
      // Nessun destinatario: NON segniamo come notificati, altrimenti
      // resterebbero silenziosamente "persi" per sempre (il dedup li
      // escluderebbe dai run futuri anche quando i destinatari torneranno).
      await admin.from('sync_logs').insert({
        source: 'notify',
        sync_type: 'notifications',
        status: 'error',
        requests_used: 0,
        message: `${newSignals.length + newMovements.length} novità trovate ma nessun destinatario con email valida`,
      })
      return NextResponse.json({ ok: false, sent: 0, error: 'nessun destinatario' })
    }

    const valueCardsHtml = newSignals
      .map((s) => {
        const home = s.matches?.home_team?.name ?? '—'
        const away = s.matches?.away_team?.name ?? '—'
        return `
          <div style="border:1px solid #223028;border-radius:8px;padding:16px;margin-bottom:12px;background:#121915;">
            <p style="margin:0 0 8px;color:#ECF2EE;font-weight:600;font-size:15px;">${home} vs ${away}</p>
            <p style="margin:0 0 4px;color:#8FA096;font-size:13px;">Esito: <strong style="color:#ECF2EE;">${OUTCOME_LABEL[s.outcome]}</strong></p>
            <p style="margin:0 0 4px;color:#8FA096;font-size:13px;">Quota migliore trovata: <strong style="color:#C9A24B;">${s.best_odds.toFixed(2)}</strong> presso ${s.bookmaker_name}</p>
            <p style="margin:0;color:#8FA096;font-size:13px;">Il nostro modello stima questo esito ${(s.edge * 100).toFixed(1)} punti percentuali più probabile di quanto suggerisca la quota</p>
          </div>`
      })
      .join('')

    const movementCardsHtml = newMovements
      .map((m) => {
        const home = m.matches?.home_team?.name ?? '—'
        const away = m.matches?.away_team?.name ?? '—'
        const direction = m.pct_change > 0 ? 'salita' : 'scesa'
        return `
          <div style="border:1px solid #223028;border-radius:8px;padding:16px;margin-bottom:12px;background:#121915;">
            <p style="margin:0 0 8px;color:#ECF2EE;font-weight:600;font-size:15px;">${home} vs ${away}</p>
            <p style="margin:0 0 4px;color:#8FA096;font-size:13px;">Esito: <strong style="color:#ECF2EE;">${OUTCOME_LABEL[m.outcome]}</strong></p>
            <p style="margin:0;color:#8FA096;font-size:13px;">Quota migliore ${direction} da <strong style="color:#ECF2EE;">${m.old_value.toFixed(2)}</strong> a
              <strong style="color:#C9A24B;">${m.new_value.toFixed(2)}</strong> (${(Math.abs(m.pct_change) * 100).toFixed(0)}%)</p>
          </div>`
      })
      .join('')

    const totalNew = newSignals.length + newMovements.length
    await sendEmail(
      recipients,
      `Serie A Intelligence — ${totalNew} novit${totalNew === 1 ? 'à' : 'à'}`,
      `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
        <p style="color:#8FA096;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Serie A Intelligence</p>
        <h1 style="color:#ECF2EE;font-size:20px;margin:8px 0 16px;">Aggiornamenti sulla giornata</h1>
        ${
          newSignals.length > 0
            ? `<p style="color:#8FA096;font-size:13px;margin:0 0 8px;font-weight:600;">Nuovi segnali "possibile value" (${newSignals.length})</p>${valueCardsHtml}`
            : ''
        }
        ${
          newMovements.length > 0
            ? `<p style="color:#8FA096;font-size:13px;margin:16px 0 8px;font-weight:600;">Variazioni quota significative (${newMovements.length})</p>${movementCardsHtml}`
            : ''
        }
        <p style="color:#8FA096;font-size:12px;margin-top:16px;">
          Importante: sono probabilità stimate da un modello statistico (Dixon-Coles), non un pronostico garantito —
          il modello può sbagliare. Non è un consiglio di gioco.
        </p>
      </div>`
    )

    await admin.from('notifications_sent').insert([
      ...newSignals.map((s) => ({
        kind: 'value_signal',
        match_id: s.match_id,
        outcome: s.outcome,
        detail: `edge ${(s.edge * 100).toFixed(1)}pt @ ${s.best_odds.toFixed(2)} (${s.bookmaker_name})`,
      })),
      ...newMovements.map((m) => ({
        kind: 'odds_movement',
        match_id: m.match_id,
        outcome: m.outcome,
        detail: `${m.old_value.toFixed(2)} -> ${m.new_value.toFixed(2)} (${(m.pct_change * 100).toFixed(1)}%)`,
      })),
    ])

    await admin.from('sync_logs').insert({
      source: 'notify',
      sync_type: 'notifications',
      status: 'success',
      requests_used: 0,
      message: `${newSignals.length} segnali value + ${newMovements.length} variazioni quota notificati a ${recipients.length} utenti`,
    })

    return NextResponse.json({ ok: true, sent: totalNew, recipients: recipients.length })
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
