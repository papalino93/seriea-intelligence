'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function assertAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('non autorizzato')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') throw new Error('richiede ruolo admin')
}

/** Invita un nuovo utente via email — nessun self-signup pubblico, solo admin. */
export async function inviteUser(email: string) {
  try {
    await assertAdmin()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'errore' }
  }
  if (!email || !email.includes('@')) return { error: 'email non valida' }

  // Stesso punto di atterraggio del magic link (/auth/confirm) — senza
  // questo, l'invito reindirizza alla Site URL "nuda" e la sessione non
  // verrebbe stabilita correttamente, stesso bug già risolto per il login.
  const headersList = await headers()
  const origin = `https://${headersList.get('host')}`

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/dashboard`,
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/users')
  return { ok: true }
}

/** Cambia il ruolo di un utente esistente (admin/user). */
export async function updateUserRole(userId: string, role: 'admin' | 'user') {
  try {
    await assertAdmin()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'errore' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ role }).eq('id', userId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/users')
  return { ok: true }
}
