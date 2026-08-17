import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

/**
 * Orchestrazione giornaliera (Fase 10): richiamata da Vercel Cron una volta
 * al giorno (vedi vercel.json — il piano Hobby limita a cadenza giornaliera,
 * coerente col documento di progettazione sezione 13). Chiama in sequenza le
 * stesse route che l'admin può già invocare a mano dal pannello — stesso
 * codice, non duplicato, invocabile sia da cron che manualmente.
 *
 * Autenticazione: CRON_SECRET, non SYNC_SECRET — Vercel inietta
 * automaticamente "Authorization: Bearer $CRON_SECRET" sulle chiamate cron
 * quando quella variabile d'ambiente esiste (meccanismo nativo della
 * piattaforma, non serve gestirlo a mano). SYNC_SECRET resta per le
 * chiamate interne a valle verso le altre route.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })
  }

  const origin = new URL(request.url).origin
  const steps: { name: string; endpoint: string }[] = [
    { name: 'calendario', endpoint: '/api/sync' },
    { name: 'quote', endpoint: '/api/sync-odds' },
    { name: 'marcatori', endpoint: '/api/sync-scorers' },
    { name: 'rosa completa', endpoint: '/api/sync-squads' },
    { name: 'previsioni', endpoint: '/api/compute-predictions' },
    { name: 'value', endpoint: '/api/compute-value' },
    { name: 'commento IA', endpoint: '/api/generate-summary' },
    { name: 'notifiche', endpoint: '/api/notify' },
  ]

  const results: { name: string; ok: boolean; detail: string }[] = []

  for (const step of steps) {
    try {
      const res = await fetch(`${origin}${step.endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SYNC_SECRET}` },
      })
      const json = await res.json()
      results.push({ name: step.name, ok: res.ok, detail: res.ok ? JSON.stringify(json) : (json.error ?? 'errore') })
    } catch (err) {
      // Uno step che fallisce non blocca gli altri: es. se le quote non sono
      // disponibili non ha senso saltare comunque il calendario.
      results.push({ name: step.name, ok: false, detail: extractErrorMessage(err) })
    }
  }

  const admin = createAdminClient()
  await admin.from('sync_logs').insert({
    source: 'cron',
    sync_type: 'daily-pipeline',
    status: results.every((r) => r.ok) ? 'success' : 'error',
    requests_used: 0,
    message: results.map((r) => `${r.name}: ${r.ok ? 'ok' : 'errore'}`).join(' · '),
  })

  return NextResponse.json({ ok: true, results })
}
