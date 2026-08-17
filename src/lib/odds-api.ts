const BASE_URL = 'https://api.the-odds-api.com/v4'
export const SERIE_A_SPORT_KEY = 'soccer_italy_serie_a'

export interface OddsApiOutcome {
  name: string
  price: number
}

export interface OddsApiBookmaker {
  key: string
  title: string
  markets: { key: string; outcomes: OddsApiOutcome[] }[]
}

export interface OddsApiEvent {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsApiBookmaker[]
}

/**
 * 1 richiesta (1 mercato × 1 regione). Region "eu": bookmaker europei
 * generalisti (Pinnacle, Unibet, 1xBet, Betfair...) — nessuna garanzia di
 * copertura sui bookmaker italiani specifici (Snai/Sisal), va dichiarato
 * in UI, coerente col documento di progettazione sezione 4.2.
 */
export async function fetchSerieAOdds(): Promise<OddsApiEvent[]> {
  const url = `${BASE_URL}/sports/${SERIE_A_SPORT_KEY}/odds/?apiKey=${process.env.ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`The Odds API /odds: HTTP ${res.status} ${body}`)
  }
  return res.json()
}

const SUFFIX_WORDS = new Set([
  'calcio', 'football', 'club', 'fc', 'ac', 'ssc', 'ss', 'us', 'cfc', 'bc', 'acf', 'as', 'a.c.', 'a.s.', 'u.s.',
])

// Casi dove togliere i suffissi non basta: nomi davvero diversi per la stessa squadra.
const EXPLICIT_ALIASES: Record<string, string> = {
  'inter milan': 'internazionale',
  inter: 'internazionale',
}

/** Normalizza un nome squadra in un set di parole: minuscolo, senza cifre/suffissi societari. */
function normalizeTeamWords(name: string): Set<string> {
  const lower = name.toLowerCase().trim()
  const aliased = EXPLICIT_ALIASES[lower] ?? lower
  const words = aliased
    .replace(/\d+/g, '')
    .split(/\s+/)
    .filter((w) => w && !SUFFIX_WORDS.has(w))
  return new Set(words)
}

/** Solo per debug/log: rappresentazione leggibile del nome normalizzato. */
export function normalizeTeamName(name: string): string {
  return [...normalizeTeamWords(name)].join(' ').trim()
}

/**
 * Vero se due nomi squadra (formati anche molto diversi) si riferiscono alla
 * stessa squadra. Confronto a livello di PAROLE INTERE, non di sottostringa:
 * "milan" è sottostringa di "milano" ma sono due parole diverse — un
 * confronto su stringhe grezze abbinerebbe erroneamente AC Milan a Inter
 * (Internazionale Milano). Match solo se l'insieme di parole più corto è
 * interamente contenuto nell'altro.
 */
export function teamNamesMatch(a: string, b: string): boolean {
  const wa = normalizeTeamWords(a)
  const wb = normalizeTeamWords(b)
  if (wa.size === 0 || wb.size === 0) return false
  const [shorter, longer] = wa.size <= wb.size ? [wa, wb] : [wb, wa]
  return [...shorter].every((w) => longer.has(w))
}
