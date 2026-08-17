const BASE_URL = 'https://api.football-data.org/v4'

// Codice competizione Serie A su football-data.org (stabile).
export const SERIE_A_COMPETITION_CODE = 'SA'

function authHeaders() {
  return { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! }
}

export interface FootballDataTeam {
  id: number
  name: string
  crest: string | null
}

export interface FootballDataMatch {
  id: number
  utcDate: string
  status: string
  matchday: number
  venue: string | null
  homeTeam: FootballDataTeam
  awayTeam: FootballDataTeam
  score: {
    fullTime: { home: number | null; away: number | null }
    halfTime: { home: number | null; away: number | null }
  }
  season: { id: number; startDate: string }
  referees: { name: string; type: string }[]
}

export interface SeasonMatchesResult {
  competition: { id: number; name: string }
  matches: FootballDataMatch[]
}

/**
 * 1 richiesta. Restituisce tutte le partite della stagione corrente di Serie A
 * (football-data.org seleziona la stagione in corso di default, non serve
 * un'interrogazione separata per determinarla).
 */
export async function fetchSeasonMatches(): Promise<SeasonMatchesResult> {
  return fetchSeasonMatchesForYear(null)
}

/**
 * 1 richiesta. Come fetchSeasonMatches ma per un anno specifico (usato per il
 * backfill storico) — passare null per la stagione corrente. Il piano free
 * copre solo le ultime ~3 stagioni: anni precedenti restituiscono 403.
 */
export async function fetchSeasonMatchesForYear(year: number | null): Promise<SeasonMatchesResult> {
  const qs = year ? `?season=${year}` : ''
  const res = await fetch(`${BASE_URL}/competitions/${SERIE_A_COMPETITION_CODE}/matches${qs}`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`football-data.org /matches${qs}: HTTP ${res.status} ${body}`)
  }

  const json = await res.json()
  return { competition: json.competition, matches: json.matches as FootballDataMatch[] }
}

/** Normalizza gli stati di football-data.org sul nostro enum interno. */
export function mapMatchStatus(status: string): 'scheduled' | 'live' | 'finished' | 'postponed' {
  if (['IN_PLAY', 'PAUSED'].includes(status)) return 'live'
  if (status === 'FINISHED') return 'finished'
  if (['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(status)) return 'postponed'
  return 'scheduled'
}
