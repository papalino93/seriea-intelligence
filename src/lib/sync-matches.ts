import { createAdminClient } from '@/lib/supabase/admin'
import { mapMatchStatus, type FootballDataMatch } from '@/lib/football-data'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Scrive competizione/stagione/squadre/giornate/partite su Postgres in batch
 * (un upsert per tabella). Condivisa tra la sync della stagione corrente
 * (/api/sync) e il backfill storico (/api/sync-historical) per non duplicare
 * la stessa logica — e lo stesso rischio di bug — in due posti.
 */
export async function syncMatchesToDb(
  admin: AdminClient,
  apiCompetition: { id: number; name: string },
  matches: FootballDataMatch[],
  isCurrent: boolean
): Promise<{ seasonYear: number; matchCount: number }> {
  if (matches.length === 0) return { seasonYear: new Date().getFullYear(), matchCount: 0 }

  const { data: competition, error: compError } = await admin
    .from('competitions')
    .upsert({ external_id: apiCompetition.id, name: apiCompetition.name, country: 'Italy' }, { onConflict: 'external_id' })
    .select()
    .single()
  if (compError) throw compError

  const seasonInfo = matches[0]?.season
  const seasonYear = seasonInfo ? new Date(seasonInfo.startDate).getFullYear() : new Date().getFullYear()
  const seasonExternalId = seasonInfo?.id ?? apiCompetition.id * 10000 + seasonYear

  const { data: season, error: seasonError } = await admin
    .from('seasons')
    .upsert(
      { competition_id: competition.id, year: seasonYear, external_id: seasonExternalId, is_current: isCurrent },
      { onConflict: 'competition_id,year' }
    )
    .select()
    .single()
  if (seasonError) throw seasonError

  // ---- Squadre: dedup per external_id, un solo upsert batch ----
  const teamsByExternalId = new Map<number, { external_id: number; name: string; logo_url: string | null }>()
  for (const m of matches) {
    teamsByExternalId.set(m.homeTeam.id, { external_id: m.homeTeam.id, name: m.homeTeam.name, logo_url: m.homeTeam.crest })
    teamsByExternalId.set(m.awayTeam.id, { external_id: m.awayTeam.id, name: m.awayTeam.name, logo_url: m.awayTeam.crest })
  }
  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .upsert(Array.from(teamsByExternalId.values()), { onConflict: 'external_id' })
    .select()
  if (teamsError) throw teamsError
  const teamIdByExternalId = new Map(teams.map((t) => [t.external_id, t.id]))

  // ---- Giornate: dedup per matchday, un solo upsert batch ----
  const matchdays = [...new Set(matches.map((m) => m.matchday))]
  const { data: rounds, error: roundsError } = await admin
    .from('rounds')
    .upsert(
      matchdays.map((round_number) => ({ season_id: season.id, round_number, label: `Giornata ${round_number}` })),
      { onConflict: 'season_id,round_number' }
    )
    .select()
  if (roundsError) throw roundsError
  const roundIdByNumber = new Map(rounds.map((r) => [r.round_number, r.id]))

  // ---- Partite: un solo upsert batch ----
  const matchRows = matches.map((m: FootballDataMatch) => ({
    external_id: m.id,
    season_id: season.id,
    round_id: roundIdByNumber.get(m.matchday) ?? null,
    home_team_id: teamIdByExternalId.get(m.homeTeam.id),
    away_team_id: teamIdByExternalId.get(m.awayTeam.id),
    kickoff_at: m.utcDate,
    venue: m.venue,
    status: mapMatchStatus(m.status),
    home_score: m.score.fullTime.home,
    away_score: m.score.fullTime.away,
    home_score_ht: m.score.halfTime.home,
    away_score_ht: m.score.halfTime.away,
    referee_name: m.referees?.[0]?.name ?? null,
    updated_at: new Date().toISOString(),
  }))
  const { error: matchesError } = await admin.from('matches').upsert(matchRows, { onConflict: 'external_id' })
  if (matchesError) throw matchesError

  return { seasonYear, matchCount: matches.length }
}
