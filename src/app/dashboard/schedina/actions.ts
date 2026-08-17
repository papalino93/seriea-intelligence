'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface SelectionInput {
  matchId: number
  outcome: 'home' | 'draw' | 'away'
  odds: number
  bookmakerName: string
}

/**
 * Scrive tramite la sessione dell'utente (non service role): le RLS su
 * bet_slips/bet_slip_selections garantiscono che possa scrivere solo le
 * proprie schedine, a livello di dato — non solo di controllo in UI.
 */
export async function saveBetSlip(selections: SelectionInput[], stake: number | null) {
  if (selections.length === 0) return { error: 'Nessuna selezione' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'non autorizzato' }

  const { data: slip, error: slipError } = await supabase
    .from('bet_slips')
    .insert({ user_id: user.id, stake })
    .select()
    .single()
  if (slipError) return { error: slipError.message }

  const { error: selError } = await supabase.from('bet_slip_selections').insert(
    selections.map((s) => ({
      bet_slip_id: slip.id,
      match_id: s.matchId,
      outcome: s.outcome,
      odds_at_selection: s.odds,
      bookmaker_name: s.bookmakerName,
    }))
  )
  if (selError) return { error: selError.message }

  revalidatePath('/dashboard/schedina')
  return { ok: true, slipId: slip.id }
}
