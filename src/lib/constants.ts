/**
 * Soglia minima di edge (punti percentuali, come frazione: 0.03 = 3pt) per
 * segnalare un "possibile value" invece di scartarlo come rumore statistico
 * (documento di progettazione, sezione 9). Condivisa tra route di calcolo e
 * componenti UI — prima era duplicata in 3 punti diversi, rischio di deriva.
 */
export const VALUE_EDGE_THRESHOLD = 0.03

/**
 * Data di taglio per "ultimi risultati" / "precedenti": esclude lo storico
 * caricato in blocco (2023-2024, usato solo per allenare il modello) da
 * queste viste — mostrerebbe risultati vecchi di anni spacciati per
 * "recenti". Include la stagione corrente + quella precedente (che diventa
 * storico reale, non sintetico, una volta conclusa) — un anno indietro dal
 * 1° agosto, coerente con l'inizio della Serie A.
 */
export function recentFormCutoffDate(): Date {
  const now = new Date()
  const seasonStartYear = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return new Date(Date.UTC(seasonStartYear - 1, 7, 1))
}

export type ScorerSuggestions = { top: string[]; underdog: string | null }

/**
 * Sceglie i marcatori da suggerire tra una lista già ordinata per gol
 * decrescenti: 2-3 "papabili" (i più probabili) + 1 "outsider" (uno tra chi
 * ha segnato meno, ma ha comunque segnato — mai un nome a caso o inventato,
 * solo dati reali messi in evidenza diversamente). Preferisce chi ha già
 * segnato in questa stagione (nelle rotazioni adesso, non solo un buon
 * passato — es. evita di consigliare un giocatore fuori rosa). Se nessuno ha
 * ancora presenze in stagione corrente (prima giornata, il campionato deve
 * ancora iniziare), usa il vecchio criterio: tutti i candidati per gol
 * storici, senza filtro di attività.
 */
export function pickScorerSuggestions<T extends { name: string; goals: number; current_season_matches: number }>(
  scorers: T[]
): ScorerSuggestions {
  const activeThisSeason = scorers.filter((s) => s.current_season_matches > 0)
  const pool = activeThisSeason.length > 0 ? activeThisSeason : scorers

  const top = pool.slice(0, 3).map((s) => s.name)
  const underdog = pool.length > 3 ? pool[pool.length - 1].name : null
  return { top, underdog }
}
