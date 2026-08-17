import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SyncButton from './sync-button'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const { data: logs } = await supabase
    .from('sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentUsage } = await supabase
    .from('sync_logs')
    .select('source, requests_used')
    .gte('created_at', oneDayAgo)

  const usageBySource = new Map<string, number>()
  for (const row of recentUsage ?? []) {
    usageBySource.set(row.source, (usageBySource.get(row.source) ?? 0) + (row.requests_used ?? 0))
  }
  // Budget indicativi giornalieri, solo per le fonti dove il piano free ha un
  // tetto rilevante (football-data.org: 10/min, nessun limite giornaliero —
  // non serve monitorarlo qui; the-odds-api: 500/mese ≈ 16/giorno di media).
  const DAILY_BUDGETS: Record<string, number> = { 'the-odds-api': 20 }

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
            ← dashboard
          </Link>
          <Link href="/dashboard/admin/users" className="font-mono text-xs text-text-secondary underline">
            gestione utenti
          </Link>
        </div>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Admin</p>
        <h1 className="mt-2 font-display text-2xl">Sincronizzazione dati</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Recupera calendario, squadre e giornate da football-data.org (1 richiesta per esecuzione).
        </p>

        <div className="flex flex-wrap items-start">
          <SyncButton variant="calendar" />
          <SyncButton variant="odds" />
          <SyncButton variant="historical" />
          <SyncButton variant="predictions" />
          <SyncButton variant="value" />
          <SyncButton variant="scorers" />
          <SyncButton variant="notify" />
          <SyncButton variant="summary" />
        </div>

        <h2 className="mt-10 font-display text-sm text-text-secondary">Consumi API (ultime 24h)</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {usageBySource.size === 0 && (
            <p className="font-mono text-xs text-text-secondary">Nessuna richiesta nelle ultime 24 ore.</p>
          )}
          {Array.from(usageBySource.entries()).map(([source, count]) => {
            const budget = DAILY_BUDGETS[source]
            const overThreshold = budget != null && count >= budget * 0.8
            return (
              <div
                key={source}
                className={`rounded-lg border p-3 font-mono text-xs ${
                  overThreshold ? 'border-accent-danger/60' : 'border-border'
                }`}
              >
                <p className="text-text-secondary">{source}</p>
                <p className="mt-1 text-sm">
                  {count}
                  {budget != null && <span className="text-text-secondary"> / ~{budget} al giorno</span>}
                </p>
                {overThreshold && <p className="mt-1 text-accent-danger">vicino al limite del piano free</p>}
              </div>
            )
          })}
        </div>

        <h2 className="mt-10 font-display text-sm text-text-secondary">Ultime sincronizzazioni</h2>
        <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
          {!logs?.length && (
            <p className="px-4 py-3 font-mono text-xs text-text-secondary">Nessuna sincronizzazione ancora.</p>
          )}
          {logs?.map((log) => (
            <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-xs">
              <span className={log.status === 'success' ? 'text-accent-pitch' : 'text-accent-danger'}>
                {log.status}
              </span>
              <span className="text-text-secondary">{log.message}</span>
              <span className="text-text-secondary">
                {new Date(log.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
