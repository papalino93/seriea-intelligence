'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Ogni utente sceglie la propria squadra preferita. La tabella profiles non
 * ha nessuna policy RLS di update (solo self-read) — coerente col resto
 * dell'app, tutte le scritture passano dal service role dopo aver verificato
 * la sessione a mano, non dalla sessione utente diretta.
 */
export async function setFavoriteTeam(teamId: number | null) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'non autorizzato' }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ favorite_team_id: teamId }).eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  return { ok: true }
}
