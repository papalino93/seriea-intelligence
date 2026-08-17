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

const OUTCOME_LABEL: Record<string, string> = { home: 'vittoria squadra di casa (1)', draw: 'pareggio (X)', away: 'vittoria squadra ospite (2)' }

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

    if (recipients.length === 0) {
      // Nessun destinatario: NON segniamo i segnali come notificati, altrimenti
      // resterebbero silenziosamente "persi" per sempre (il dedup li
      // escluderebbe dai run futuri anche quando i destinatari torneranno).
      await admin.from('sync_logs').insert({
        source: 'notify',
        sync_type: 'notifications',
        status: 'error',
        requests_used: 0,
        message: `${newSignals.length} nuovi segnali trovati ma nessun destinatario con email valida`,
      })
      return NextResponse.json({ ok: false, sent: 0, error: 'nessun destinatario' })
    }

    const cardsHtml = newSignals
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

    await sendEmail(
      recipients,
      `Serie A Intelligence — ${newSignals.length} nuov${newSignals.length === 1 ? 'o segnale' : 'i segnali'} "possibile value"`,
      `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;">
        <p style="color:#8FA096;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;">Serie A Intelligence</p>
        <h1 style="color:#ECF2EE;font-size:20px;margin:8px 0 16px;">Nuovi segnali "possibile value"</h1>
        <p style="color:#8FA096;font-size:13px;margin:0 0 16px;">
          Il nostro modello statistico ha trovato ${newSignals.length} caso${newSignals.length === 1 ? '' : 'i'} in cui la
          probabilità stimata per un esito è significativamente più alta di quella implicita nelle quote dei bookmaker.
        </p>
        ${cardsHtml}
        <p style="color:#8FA096;font-size:12px;margin-top:16px;">
          Importante: sono probabilità stimate da un modello statistico (Dixon-Coles), non un pronostico garantito —
          il modello può sbagliare. Non è un consiglio di gioco.
        </p>
      </div>`
    )

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
