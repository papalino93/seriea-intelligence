import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchCurrentSeasonYear,
  fetchSeasonFixtures,
  mapFixtureStatus,
  SERIE_A_LEAGUE_ID,
  type ApiFootballFixture,
} from '@/lib/api-football'

/**
 * Sincronizza calendario, squadre e giornate di Serie A da API-Football.
 * Budget: 2 richieste API-Football per esecuzione (leghe + fixtures) —
 * ampiamente dentro il tier gratuito di 100/giorno anche eseguita più volte.
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
    const year = await fetchCurrentSeasonYear()
    requestsUsed += 1

    const { data: competition, error: compError } = await admin
      .from('competitions')
      .upsert(
        { api_football_id: SERIE_A_LEAGUE_ID, name: 'Serie A', country: 'Italy' },
        { onConflict: 'api_football_id' }
      )
      .select()
      .single()
    if (compError) throw compError

    const { data: season, error: seasonError } = await admin
      .from('seasons')
      .upsert(
        {
          competition_id: competition.id,
          year,
          api_football_id: SERIE_A_LEAGUE_ID * 10000 + year,
          is_current: true,
        },
        { onConflict: 'competition_id,year' }
      )
      .select()
      .single()
    if (seasonError) throw seasonError

    const fixtures = await fetchSeasonFixtures(year)
    requestsUsed += 1

    for (const fx of fixtures as ApiFootballFixture[]) {
      const { data: homeTeam } = await admin
        .from('teams')
        .upsert(
          {
            api_football_id: fx.teams.home.id,
            name: fx.teams.home.name,
            logo_url: fx.teams.home.logo,
          },
          { onConflict: 'api_football_id' }
        )
        .select()
        .single()

      const { data: awayTeam } = await admin
        .from('teams')
        .upsert(
          {
            api_football_id: fx.teams.away.id,
            name: fx.teams.away.name,
            logo_url: fx.teams.away.logo,
          },
          { onConflict: 'api_football_id' }
        )
        .select()
        .single()

      const roundNumber = parseInt(fx.league.round.replace(/\D/g, ''), 10) || 0
      const { data: round } = await admin
        .from('rounds')
        .upsert(
          { season_id: season.id, round_number: roundNumber, label: fx.league.round },
          { onConflict: 'season_id,round_number' }
        )
        .select()
        .single()

      await admin.from('matches').upsert(
        {
          api_football_id: fx.fixture.id,
          season_id: season.id,
          round_id: round?.id ?? null,
          home_team_id: homeTeam?.id,
          away_team_id: awayTeam?.id,
          kickoff_at: fx.fixture.date,
          venue: fx.fixture.venue?.name ?? null,
          status: mapFixtureStatus(fx.fixture.status.short),
          home_score: fx.goals.home,
          away_score: fx.goals.away,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'api_football_id' }
      )
    }

    await admin.from('sync_logs').insert({
      source: 'api-football',
      sync_type: 'calendar',
      status: 'success',
      requests_used: requestsUsed,
      message: `${fixtures.length} partite sincronizzate (stagione ${year})`,
    })

    return NextResponse.json({ ok: true, matches: fixtures.length, requestsUsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'errore sconosciuto'
    await admin.from('sync_logs').insert({
      source: 'api-football',
      sync_type: 'calendar',
      status: 'error',
      requests_used: requestsUsed,
      message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
