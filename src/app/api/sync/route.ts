import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSeasonMatches, mapMatchStatus, type FootballDataTeam } from '@/lib/football-data'

type AdminClient = ReturnType<typeof createAdminClient>

async function upsertTeam(admin: AdminClient, team: FootballDataTeam) {
  const { data } = await admin
    .from('teams')
    .upsert({ external_id: team.id, name: team.name, logo_url: team.crest }, { onConflict: 'external_id' })
    .select()
    .single()
  return data
}

/**
 * Sincronizza calendario, squadre e giornate di Serie A da football-data.org.
 * Budget: 1 richiesta per esecuzione — ampiamente dentro il tier gratuito
 * (10 richieste/minuto, nessun limite giornaliero).
 *
 * Autorizzazione, due percorsi:
 *  1. Sessione utente con ruolo admin (pulsante nel pannello admin).
 *  2. Header "Authorization: Bearer <SYNC_SECRET>" (per un futuro cron esterno,
 *     dato che il piano gratuito Vercel limita i cron nativi a 1x/giorno —
 *     vedi documento di progettazione, sezione 13).
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

    if (!user) {
      return NextResponse.json({ error: 'non autorizzato' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'richiede ruolo admin' }, { status: 403 })
    }
  }

  const admin = createAdminClient()
  let requestsUsed = 0

  try {
    const { competition: apiCompetition, matches } = await fetchSeasonMatches()
    requestsUsed += 1

    const { data: competition, error: compError } = await admin
      .from('competitions')
      .upsert(
        { external_id: apiCompetition.id, name: apiCompetition.name, country: 'Italy' },
        { onConflict: 'external_id' }
      )
      .select()
      .single()
    if (compError) throw compError

    const seasonInfo = matches[0]?.season
    const seasonYear = seasonInfo ? new Date(seasonInfo.startDate).getFullYear() : new Date().getFullYear()
    const seasonExternalId = seasonInfo?.id ?? apiCompetition.id * 10000 + seasonYear

    const { data: season, error: seasonError } = await admin
      .from('seasons')
      .upsert(
        { competition_id: competition.id, year: seasonYear, external_id: seasonExternalId, is_current: true },
        { onConflict: 'competition_id,year' }
      )
      .select()
      .single()
    if (seasonError) throw seasonError

    for (const m of matches) {
      const homeTeam = await upsertTeam(admin, m.homeTeam)
      const awayTeam = await upsertTeam(admin, m.awayTeam)

      const { data: round } = await admin
        .from('rounds')
        .upsert(
          { season_id: season.id, round_number: m.matchday, label: `Giornata ${m.matchday}` },
          { onConflict: 'season_id,round_number' }
        )
        .select()
        .single()

      await admin.from('matches').upsert(
        {
          external_id: m.id,
          season_id: season.id,
          round_id: round?.id ?? null,
          home_team_id: homeTeam?.id,
          away_team_id: awayTeam?.id,
          kickoff_at: m.utcDate,
          venue: m.venue,
          status: mapMatchStatus(m.status),
          home_score: m.score.fullTime.home,
          away_score: m.score.fullTime.away,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'external_id' }
      )
    }

    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'calendar',
      status: 'success',
      requests_used: requestsUsed,
      message: `${matches.length} partite sincronizzate (stagione ${seasonYear})`,
    })

    return NextResponse.json({ ok: true, matches: matches.length, requestsUsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'errore sconosciuto'
    await admin.from('sync_logs').insert({
      source: 'football-data.org',
      sync_type: 'calendar',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
