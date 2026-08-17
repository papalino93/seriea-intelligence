const BASE_URL = 'https://v3.football.api-sports.io'

// ID della Serie A su API-Football (stabile, non cambia stagione per stagione).
export const SERIE_A_LEAGUE_ID = 135

function authHeaders() {
  return { 'x-apisports-key': process.env.API_FOOTBALL_KEY! }
}

export interface ApiFootballFixture {
  fixture: {
    id: number
    date: string
    status: { short: string }
    venue: { name: string | null }
  }
  league: { round: string }
  teams: {
    home: { id: number; name: string; logo: string }
    away: { id: number; name: string; logo: string }
  }
  goals: { home: number | null; away: number | null }
}

/**
 * 1 richiesta. Trova l'anno della stagione corrente di Serie A
 * (API-Football indicizza le stagioni per anno di inizio, es. 2026 per 2026/27).
 */
export async function fetchCurrentSeasonYear(): Promise<number> {
  const res = await fetch(`${BASE_URL}/leagues?id=${SERIE_A_LEAGUE_ID}`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`API-Football /leagues: HTTP ${res.status}`)

  const json = await res.json()
  const current = json.response?.[0]?.seasons?.find((s: { year: number; current: boolean }) => s.current)
  if (!current) throw new Error('Nessuna stagione corrente restituita da API-Football')
  return current.year as number
}

/**
 * 1 richiesta. Tutte le partite della stagione (intero campionato, non solo
 * la prossima giornata) — è più economico in richieste rispetto a interrogare
 * giornata per giornata, e ci lascia libertà di calcolare "prossima giornata"
 * lato nostro.
 */
export async function fetchSeasonFixtures(seasonYear: number): Promise<ApiFootballFixture[]> {
  const res = await fetch(
    `${BASE_URL}/fixtures?league=${SERIE_A_LEAGUE_ID}&season=${seasonYear}`,
    { headers: authHeaders(), cache: 'no-store' }
  )
  if (!res.ok) throw new Error(`API-Football /fixtures: HTTP ${res.status}`)

  const json = await res.json()
  return json.response as ApiFootballFixture[]
}

/** Normalizza i codici di stato di API-Football sul nostro enum interno. */
export function mapFixtureStatus(short: string): 'scheduled' | 'live' | 'finished' | 'postponed' {
  if (['1H', '2H', 'HT', 'ET', 'P', 'LIVE', 'BT'].includes(short)) return 'live'
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished'
  if (['PST', 'CANC', 'ABD', 'SUSP', 'INT'].includes(short)) return 'postponed'
  return 'scheduled'
}
