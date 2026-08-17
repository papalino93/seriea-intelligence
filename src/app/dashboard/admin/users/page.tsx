import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import UsersManager from './users-manager'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  const admin = createAdminClient()
  const { data: profiles } = await admin.from('profiles').select('id, email, role, created_at').order('created_at', { ascending: true })

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard/admin" className="font-mono text-xs text-text-secondary underline">
          ← pannello admin
        </Link>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Admin</p>
        <h1 className="mt-2 font-display text-2xl">Gestione utenti</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Invita nuovi utenti o cambia i ruoli — nessun self-signup pubblico, solo tu puoi aggiungere
          accessi.
        </p>

        <UsersManager users={profiles ?? []} currentUserId={user.id} />
      </div>
    </main>
  )
}
