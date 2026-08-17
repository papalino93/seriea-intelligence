/**
 * Prediction Engine — Dixon-Coles (1997) con time-decay.
 *
 * Perché questo modello e non altri: vedi documento di progettazione, sezione 8.
 * In sintesi: Poisson bivariata (attacco/difesa per squadra + vantaggio casa)
 * con una correzione per la correlazione nei risultati bassi (0-0, 1-0, 0-1, 1-1),
 * pesata per recency così le partite recenti contano di più.
 *
 * Nessuna dipendenza esterna: gira così com'è sia dentro Next.js sia in Node puro
 * (utile per testare il fit su dati storici senza passare dall'app).
 */

export interface MatchResult {
  homeTeam: string
  awayTeam: string
  homeGoals: number
  awayGoals: number
  /** Data della partita, usata per il peso di recency rispetto a `asOf`. */
  date: Date
}

export interface TeamParams {
  attack: number
  defense: number
}

export interface FittedModel {
  teams: Map<string, TeamParams>
  homeAdvantage: number
  rho: number
}

export interface FitOptions {
  /**
   * Costante di decadimento temporale (giorni). Più alto = memoria più corta.
   * 0.0018 corrisponde a un dimezzamento del peso di una partita dopo ~385 giorni
   * (circa una stagione) — ordine di grandezza usato in letteratura per questo modello.
   */
  timeDecay?: number
  /** Data di riferimento per il peso di recency. Default: adesso. */
  asOf?: Date
  /** Intensità della regolarizzazione L2 su attacco/difesa (stabilizza il fit,
   * evita l'indeterminazione attacco/difesa senza vincoli espliciti). */
  l2?: number
  learningRate?: number
  iterations?: number
}

const DEFAULTS: Required<FitOptions> = {
  timeDecay: 0.0018,
  asOf: new Date(),
  l2: 0.001,
  learningRate: 0.05,
  iterations: 300,
}

function poissonWeight(date: Date, asOf: Date, timeDecay: number): number {
  const days = (asOf.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  return Math.exp(-timeDecay * Math.max(days, 0))
}

/**
 * Fit dei parametri via gradient ascent sulla log-verosimiglianza Poisson
 * (attacco/difesa per squadra + vantaggio casa), con regolarizzazione L2.
 * Il parametro rho della correzione Dixon-Coles viene stimato separatamente
 * dopo, via grid search 1D — è uno scalare singolo, non serve nel loop
 * principale e tenerlo fuori rende il gradiente esatto invece che approssimato.
 */
export function fitModel(matches: MatchResult[], options: FitOptions = {}): FittedModel {
  const opt = { ...DEFAULTS, ...options }

  const teamNames = Array.from(new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam])))
  const attack = new Map(teamNames.map((t) => [t, 0]))
  const defense = new Map(teamNames.map((t) => [t, 0]))
  let homeAdvantage = 0.25 // valore iniziale ragionevole, il fit lo corregge

  const weighted = matches.map((m) => ({
    ...m,
    weight: poissonWeight(m.date, opt.asOf, opt.timeDecay),
  }))

  for (let iter = 0; iter < opt.iterations; iter++) {
    const gradAttack = new Map(teamNames.map((t) => [t, 0]))
    const gradDefense = new Map(teamNames.map((t) => [t, 0]))
    let gradHomeAdv = 0

    for (const m of weighted) {
      const lambda = Math.exp(attack.get(m.homeTeam)! + defense.get(m.awayTeam)! + homeAdvantage)
      const mu = Math.exp(attack.get(m.awayTeam)! + defense.get(m.homeTeam)!)

      // d logL / d param, derivazione in cima al file: per ciascun match
      // il residuo (gol reali − gol attesi) è il gradiente comune a tutti
      // i parametri che influenzano quella squadra in quella partita.
      const homeResidual = m.weight * (m.homeGoals - lambda)
      const awayResidual = m.weight * (m.awayGoals - mu)

      gradAttack.set(m.homeTeam, gradAttack.get(m.homeTeam)! + homeResidual)
      gradDefense.set(m.awayTeam, gradDefense.get(m.awayTeam)! + homeResidual)

      gradAttack.set(m.awayTeam, gradAttack.get(m.awayTeam)! + awayResidual)
      gradDefense.set(m.homeTeam, gradDefense.get(m.homeTeam)! + awayResidual)

      gradHomeAdv += homeResidual
    }

    for (const t of teamNames) {
      const newAttack = attack.get(t)! + opt.learningRate * (gradAttack.get(t)! - opt.l2 * attack.get(t)!)
      const newDefense = defense.get(t)! + opt.learningRate * (gradDefense.get(t)! - opt.l2 * defense.get(t)!)
      attack.set(t, newAttack)
      defense.set(t, newDefense)
    }
    homeAdvantage += opt.learningRate * gradHomeAdv * 0.1 // passo più piccolo: un solo parametro globale, converge in fretta

    // Vincolo di identificabilità: senza normalizzare, attacco e difesa possono
    // scorrere insieme (es. tutti +1 attacco, tutti -1 difesa danno lo stesso
    // risultato) — la regolarizzazione L2 sopra già lo previene in pratica,
    // ma normalizziamo comunque la media a zero per interpretabilità dei numeri.
    const meanAttack = teamNames.reduce((s, t) => s + attack.get(t)!, 0) / teamNames.length
    for (const t of teamNames) attack.set(t, attack.get(t)! - meanAttack)
  }

  const rho = fitRho(weighted, attack, defense, homeAdvantage)

  const teams = new Map<string, TeamParams>()
  for (const t of teamNames) teams.set(t, { attack: attack.get(t)!, defense: defense.get(t)! })

  return { teams, homeAdvantage, rho }
}

/** Correzione Dixon-Coles per i risultati bassi (formula originale del paper). */
function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho
  if (x === 0 && y === 1) return 1 + lambda * rho
  if (x === 1 && y === 0) return 1 + mu * rho
  if (x === 1 && y === 1) return 1 - rho
  return 1
}

function fitRho(
  weighted: (MatchResult & { weight: number })[],
  attack: Map<string, number>,
  defense: Map<string, number>,
  homeAdvantage: number
): number {
  let best = 0
  let bestLL = -Infinity

  for (let r = -0.9; r <= 0.9; r += 0.005) {
    let ll = 0
    let validForAllMatches = true

    for (const m of weighted) {
      // tau vale 1 (nessun effetto) per ogni risultato diverso da 0-0/0-1/1-0/1-1:
      // includerlo con lo score "schiacciato" a quei valori distorcerebbe la stima
      // trattando una partita 3-2 come se fosse stata 1-1. Va escluso, non clampato.
      if (m.homeGoals > 1 || m.awayGoals > 1) continue

      const lambda = Math.exp(attack.get(m.homeTeam)! + defense.get(m.awayTeam)! + homeAdvantage)
      const mu = Math.exp(attack.get(m.awayTeam)! + defense.get(m.homeTeam)!)
      const t = tau(m.homeGoals, m.awayGoals, lambda, mu, r)

      // Un rho non valido per QUALSIASI partita del dataset va scartato per intero,
      // non semplicemente ignorato per quella partita: altrimenti il grid search
      // "conviene" spingere rho a un estremo scartando selettivamente le partite
      // che lo penalizzerebbero, invece di restare vincolato da tutte insieme.
      if (t <= 0) {
        validForAllMatches = false
        break
      }
      ll += m.weight * Math.log(t)
    }

    if (validForAllMatches && ll > bestLL) {
      bestLL = ll
      best = r
    }
  }
  return best
}

function poissonPmf(k: number, lambda: number): number {
  if (k < 0) return 0
  let logP = -lambda + k * Math.log(lambda)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/**
 * Matrice di probabilità P(gol casa = i, gol trasferta = j) per i,j in [0, maxGoals].
 * Normalizzata a somma 1 (la coda oltre maxGoals è trascurabile per maxGoals ≥ 8
 * con gol attesi realistici del calcio, ma normalizziamo comunque per correttezza).
 */
export function scoreMatrix(
  model: FittedModel,
  homeTeam: string,
  awayTeam: string,
  maxGoals = 8
): number[][] {
  const home = model.teams.get(homeTeam)
  const away = model.teams.get(awayTeam)
  if (!home || !away) {
    throw new Error(`Squadra non presente nel modello fittato: ${!home ? homeTeam : awayTeam}`)
  }

  const lambda = Math.exp(home.attack + away.defense + model.homeAdvantage)
  const mu = Math.exp(away.attack + home.defense)

  const matrix: number[][] = []
  let total = 0
  for (let i = 0; i <= maxGoals; i++) {
    const row: number[] = []
    for (let j = 0; j <= maxGoals; j++) {
      const base = poissonPmf(i, lambda) * poissonPmf(j, mu)
      const p = base * tau(i, j, lambda, mu, model.rho)
      row.push(p)
      total += p
    }
    matrix.push(row)
  }

  return matrix.map((row) => row.map((p) => p / total))
}

// ---------- Mercati derivati dalla matrice ----------

export function market1X2(matrix: number[][]): { home: number; draw: number; away: number } {
  let home = 0
  let draw = 0
  let away = 0
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i > j) home += matrix[i][j]
      else if (i === j) draw += matrix[i][j]
      else away += matrix[i][j]
    }
  }
  return { home, draw, away }
}

export function marketOverUnder(matrix: number[][], line: number): { over: number; under: number } {
  let over = 0
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i + j > line) over += matrix[i][j]
    }
  }
  return { over, under: 1 - over }
}

export function marketBTTS(matrix: number[][]): { yes: number; no: number } {
  let yes = 0
  for (let i = 1; i < matrix.length; i++) {
    for (let j = 1; j < matrix[i].length; j++) {
      yes += matrix[i][j]
    }
  }
  return { yes, no: 1 - yes }
}

export function topExactScores(
  matrix: number[][],
  n = 5
): { home: number; away: number; probability: number }[] {
  const flat: { home: number; away: number; probability: number }[] = []
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      flat.push({ home: i, away: j, probability: matrix[i][j] })
    }
  }
  return flat.sort((a, b) => b.probability - a.probability).slice(0, n)
}

/**
 * Team rating 0-100, normalizzazione lineare di (attacco − difesa) sull'intero
 * pool di squadre fittate. Non è un numero assoluto confrontabile fra fit
 * diversi (dipende dalla lega/pool usato) — solo relativo all'interno dello
 * stesso fit, coerente col principio "no dati inventati" del documento di
 * progettazione: è una trasformazione diretta di parametri stimati, non un
 * punteggio arbitrario.
 */
export function teamRatings(model: FittedModel): Map<string, number> {
  const scores = new Map<string, number>()
  for (const [team, params] of model.teams) {
    scores.set(team, params.attack - params.defense)
  }
  const values = Array.from(scores.values())
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const ratings = new Map<string, number>()
  for (const [team, score] of scores) {
    ratings.set(team, Math.round(((score - min) / range) * 100))
  }
  return ratings
}
