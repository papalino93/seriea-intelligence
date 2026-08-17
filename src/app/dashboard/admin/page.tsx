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

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
          ← dashboard
        </Link>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Admin</p>
        <h1 className="mt-2 font-display text-2xl">Sincronizzazione dati</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Recupera calendario, squadre e giornate da football-data.org (1 richiesta per esecuzione).
        </p>

        <SyncButton />

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
