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

export interface ScorerEntry {
  player: { id: number; name: string }
  team: { id: number }
  goals: number
  playedMatches: number
  assists: number | null
}

/**
 * 1 richiesta. Top marcatori per stagione (fino a 100). Usato per stimare il
 * tasso di gol/partita per giocatore — non è gol/90' vero (non abbiamo i
 * minuti giocati, solo le presenze), va dichiarato come approssimazione.
 */
export async function fetchTopScorers(year: number): Promise<ScorerEntry[]> {
  const res = await fetch(`${BASE_URL}/competitions/${SERIE_A_COMPETITION_CODE}/scorers?season=${year}&limit=100`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`football-data.org /scorers?season=${year}: HTTP ${res.status} ${body}`)
  }
  const json = await res.json()
  return json.scorers as ScorerEntry[]
}

/**
 * 1 richiesta, tutte le 20 squadre con rosa attuale. Usata per correggere
 * l'assegnazione squadra dei marcatori: i dati storici (/scorers) riflettono
 * la squadra di quando i gol sono stati segnati, non quella attuale — un
 * giocatore trasferito in estate risulterebbe ancora nella vecchia squadra
 * se usassimo solo lo storico (successo con Dovbyk: Roma nel 2024/25, Bologna ora).
 */
export async function fetchCurrentSquads(): Promise<Map<number, number>> {
  const res = await fetch(`${BASE_URL}/competitions/${SERIE_A_COMPETITION_CODE}/teams`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`football-data.org /teams: HTTP ${res.status} ${body}`)
  }
  const json = await res.json()
  const playerTeam = new Map<number, number>()
  for (const team of json.teams as { id: number; squad: { id: number }[] }[]) {
    for (const player of team.squad) {
      playerTeam.set(player.id, team.id)
    }
  }
  return playerTeam
}

export interface SquadPlayer {
  externalId: number
  name: string
  teamExternalId: number
  position: string | null
}

/**
 * 1 richiesta, stesso endpoint di fetchCurrentSquads ma tiene anche
 * nome/ruolo — usata per popolare la rosa completa (non solo chi ha già
 * segnato), serve come bacino ampio per un "outsider" scelto a caso tra
 * marcatori consigliati (difensori/portieri inclusi, non solo attaccanti).
 */
export async function fetchFullSquads(): Promise<SquadPlayer[]> {
  const res = await fetch(`${BASE_URL}/competitions/${SERIE_A_COMPETITION_CODE}/teams`, {
    headers: authHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`football-data.org /teams: HTTP ${res.status} ${body}`)
  }
  const json = await res.json()
  const players: SquadPlayer[] = []
  for (const team of json.teams as { id: number; squad: { id: number; name: string; position: string | null }[] }[]) {
    for (const player of team.squad) {
      players.push({ externalId: player.id, name: player.name, teamExternalId: team.id, position: player.position })
    }
  }
  return players
}

/** Normalizza gli stati di football-data.org sul nostro enum interno. */
export function mapMatchStatus(status: string): 'scheduled' | 'live' | 'finished' | 'postponed' {
  if (['IN_PLAY', 'PAUSED'].includes(status)) return 'live'
  if (status === 'FINISHED') return 'finished'
  if (['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(status)) return 'postponed'
  return 'scheduled'
}
