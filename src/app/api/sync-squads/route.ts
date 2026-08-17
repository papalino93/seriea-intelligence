import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchFullSquads } from '@/lib/football-data'
import { extractErrorMessage } from '@/lib/error-message'

export const maxDuration = 60

/**
 * Rosa completa (Fase 14): a differenza di player_scorers (solo chi ha già
 * segnato), qui teniamo TUTTI i giocatori attuali — serve come bacino ampio
 * per un "outsider" scelto a caso tra i marcatori consigliati.
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
    const squad = await fetchFullSquads()

    const { data: teams } = await admin.from('teams').select('id, external_id')
    const teamIdByExternal = new Map((teams ?? []).map((t) => [t.external_id, t.id]))

    const rows = squad.map((p) => ({
      external_id: p.externalId,
      name: p.name,
      team_id: teamIdByExternal.get(p.teamExternalId) ?? null,
      position: p.position,
      updated_at: new Date().toISOString(),
    }))

    let staleDeleted = 0
    if (rows.length > 0) {
      const { error: upsertError } = await admin.from('players').upsert(rows, { onConflict: 'external_id' })
      if (upsertError) throw upsertError

      // Come per i marcatori: l'upsert non rimuove chi non torna più in
      // questo sync (trasferito fuori Serie A, ritirato) — senza pulizia
      // resterebbe agganciato per sempre alla squadra dell'ultimo sync buono.
      const validExternalIds = rows.map((r) => r.external_id)
      const { error: deleteError, count } = await admin
        .from('players')
        .delete({ count: 'exact' })
        .not('external_id', 'in', `(${validExternalIds.join(',')})`)
      if (deleteError) throw deleteError
      staleDeleted = count ?? 0
    }

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'squads',
      status: 'success',
      requests_used: 1,
      message: `${rows.length} giocatori in rosa sincronizzati, ${staleDeleted} righe vecchie rimosse`,
    })

    return NextResponse.json({ ok: true, players: rows.length })
  } catch (err) {
    const message = extractErrorMessage(err)
    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'squads',
      status: 'error',
      requests_used: 0,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
