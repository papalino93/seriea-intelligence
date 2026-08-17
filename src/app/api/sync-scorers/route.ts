import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchTopScorers, type ScorerEntry } from '@/lib/football-data'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

// Stagione precedente completa (storico affidabile) + stagione corrente (che
// all'inizio ha zero partite giocate, ma via via che la stagione avanza
// contribuisce dati più recenti) — sommati, così il tasso si aggiorna da solo
// senza bisogno di gestire a mano la transizione tra stagioni.
const SEASONS_TO_BLEND = [2024, 2025]

/** Fase 6: Marcatori. Stima gol/partita per giocatore da dati storici reali (mai inventati). */
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
  let requestsUsed = 0

  try {
    const blended = new Map<
      number,
      { name: string; teamExternalId: number; goals: number; playedMatches: number; assists: number }
    >()

    for (const year of SEASONS_TO_BLEND) {
      let scorers: ScorerEntry[]
      try {
        scorers = await fetchTopScorers(year)
        requestsUsed += 1
      } catch {
        continue // stagione non accessibile: si continua con le altre, non è fatale
      }

      for (const s of scorers) {
        const existing = blended.get(s.player.id)
        if (existing) {
          existing.goals += s.goals
          existing.playedMatches += s.playedMatches
          existing.assists += s.assists ?? 0
          existing.teamExternalId = s.team.id // preferisci la squadra della stagione più recente (iterata per ultima)
        } else {
          blended.set(s.player.id, {
            name: s.player.name,
            teamExternalId: s.team.id,
            goals: s.goals,
            playedMatches: s.playedMatches,
            assists: s.assists ?? 0,
          })
        }
      }
    }

    const { data: teams } = await admin.from('teams').select('id, external_id')
    const teamIdByExternal = new Map((teams ?? []).map((t) => [t.external_id, t.id]))

    const rows = Array.from(blended.entries()).map(([externalId, p]) => ({
      external_id: externalId,
      name: p.name,
      team_id: teamIdByExternal.get(p.teamExternalId) ?? null,
      goals: p.goals,
      played_matches: p.playedMatches,
      assists: p.assists,
      updated_at: new Date().toISOString(),
    }))

    if (rows.length > 0) {
      const { error: insertError } = await admin.from('player_scorers').upsert(rows, { onConflict: 'external_id' })
      if (insertError) throw insertError
    }

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'scorers',
      status: 'success',
      requests_used: requestsUsed,
      message: `${rows.length} marcatori sincronizzati (stagioni ${SEASONS_TO_BLEND.join('+')})`,
    })

    return NextResponse.json({ ok: true, scorers: rows.length, requestsUsed })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'scorers',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
