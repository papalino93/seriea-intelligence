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

/**
 * Esclude/reinclude manualmente un giocatore dai marcatori consigliati (es.
 * infortunio o squalifica saputa dalle notizie) — non esiste una fonte dati
 * gratuita per infortuni, quindi questo è l'unico modo onesto di tenerne
 * conto senza inventare dati. Solo admin: la stessa esclusione vale per
 * tutti gli utenti che seguono quella squadra.
 */
export async function toggleScorerExclusion(playerId: number, excluded: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'non autorizzato' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: 'richiede ruolo admin' }

  const admin = createAdminClient()
  const { error } = await admin.from('player_scorers').update({ excluded }).eq('id', playerId)
  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  return { ok: true }
}
