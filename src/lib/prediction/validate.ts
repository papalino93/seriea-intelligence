/**
 * Validazione del motore Dixon-Coles su un campionato SINTETICO (non Serie A
 * reale — è un fixture di test con forze squadra note a priori, generato qui
 * apposta per verificare che il fit recuperi correttamente l'ordinamento di
 * forza e che le probabilità derivate siano coerenti). Si esegue con:
 *
 *   node --experimental-strip-types src/lib/prediction/validate.ts
 *
 * Non fa parte dell'app Next.js: è uno script diagnostico una tantum,
 * pensato per essere lanciato a mano prima di fidarsi del modulo.
 */
import {
  fitModel,
  scoreMatrix,
  market1X2,
  marketOverUnder,
  marketBTTS,
  topExactScores,
  teamRatings,
  type MatchResult,
} from './dixon-coles.ts'

// PRNG seedato per riproducibilità (Math.random non è seedabile in Node).
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function samplePoisson(lambda: number, rand: () => number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > L)
  return k - 1
}

// Squadre sintetiche con forza vera nota, ordinate dalla più forte alla più debole.
const TRUE_STRENGTH: Record<string, { attack: number; defense: number }> = {
  Forte: { attack: 0.5, defense: -0.4 },
  BuonaA: { attack: 0.3, defense: -0.2 },
  BuonaB: { attack: 0.2, defense: -0.1 },
  Media: { attack: 0.0, defense: 0.0 },
  DebA: { attack: -0.2, defense: 0.2 },
  DebB: { attack: -0.4, defense: 0.3 },
}
const TRUE_HOME_ADV = 0.25
const rand = mulberry32(42)

function generateSeason(): MatchResult[] {
  const teams = Object.keys(TRUE_STRENGTH)
  const matches: MatchResult[] = []
  const startDate = new Date('2025-08-24')

  let dayOffset = 0
  for (let round = 0; round < 10; round++) {
    // Round robin semplificato: ogni squadra gioca una volta a round, accoppiamenti ruotati.
    const shuffled = [...teams].sort(() => rand() - 0.5)
    for (let i = 0; i < shuffled.length; i += 2) {
      const home = shuffled[i]
      const away = shuffled[i + 1]
      if (!home || !away) continue

      const lambda = Math.exp(TRUE_STRENGTH[home].attack + TRUE_STRENGTH[away].defense + TRUE_HOME_ADV)
      const mu = Math.exp(TRUE_STRENGTH[away].attack + TRUE_STRENGTH[home].defense)

      matches.push({
        homeTeam: home,
        awayTeam: away,
        homeGoals: samplePoisson(lambda, rand),
        awayGoals: samplePoisson(mu, rand),
        date: new Date(startDate.getTime() + dayOffset * 86400000),
      })
    }
    dayOffset += 7
  }
  return matches
}

function main() {
  const matches = generateSeason()
  console.log(`Campionato sintetico generato: ${matches.length} partite, ${Object.keys(TRUE_STRENGTH).length} squadre\n`)

  // asOf: l'ultima data di match + 1 giorno, così tutte le partite pesano
  // "come se fossero appena successe" — coerente con l'uso reale (fit il
  // giovedì prima della giornata, sui risultati fino a quel momento).
  const lastDate = new Date(Math.max(...matches.map((m) => m.date.getTime())) + 86400000)
  const fitted = fitModel(matches, { asOf: lastDate })

  console.log('--- Rating recuperati dal modello (0-100, dentro questo fit) ---')
  const ratings = teamRatings(fitted)
  const trueOrder = Object.keys(TRUE_STRENGTH) // già ordinate dalla più forte
  const recoveredOrder = [...ratings.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)

  for (const [team, rating] of [...ratings.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${team.padEnd(8)} rating=${rating}`)
  }

  const orderMatches = JSON.stringify(trueOrder) === JSON.stringify(recoveredOrder)
  console.log(`\nOrdine di forza vero:      ${trueOrder.join(' > ')}`)
  console.log(`Ordine di forza recuperato: ${recoveredOrder.join(' > ')}`)
  console.log(orderMatches ? '✅ Ordine ESATTAMENTE recuperato' : 'ℹ️  Ordine non identico (atteso con dataset piccolo/rumoroso — verifica sotto se è comunque ragionevole)')

  console.log('\n--- Sanity check: Forte (casa) vs DebB (trasferta) ---')
  const matrix = scoreMatrix(fitted, 'Forte', 'DebB')
  const sum = matrix.flat().reduce((a, b) => a + b, 0)
  console.log(`Somma probabilità matrice: ${sum.toFixed(4)} (atteso: ~1.0000)`)

  const oneXTwo = market1X2(matrix)
  console.log(`1X2 → 1: ${(oneXTwo.home * 100).toFixed(1)}%  X: ${(oneXTwo.draw * 100).toFixed(1)}%  2: ${(oneXTwo.away * 100).toFixed(1)}%`)
  console.log(`Somma 1X2: ${(oneXTwo.home + oneXTwo.draw + oneXTwo.away).toFixed(4)} (atteso: ~1.0000)`)
  console.log(oneXTwo.home > oneXTwo.away ? '✅ Il modello favorisce correttamente la squadra più forte' : '❌ ATTESO home > away, fit da rivedere')

  const overUnder = marketOverUnder(matrix, 2.5)
  console.log(`Over/Under 2.5 → Over: ${(overUnder.over * 100).toFixed(1)}%  Under: ${(overUnder.under * 100).toFixed(1)}%`)

  const btts = marketBTTS(matrix)
  console.log(`GG/NG → GG: ${(btts.yes * 100).toFixed(1)}%  NG: ${(btts.no * 100).toFixed(1)}%`)

  console.log('\nTop 5 risultati esatti più probabili:')
  for (const s of topExactScores(matrix, 5)) {
    console.log(`  ${s.home}-${s.away}  ${(s.probability * 100).toFixed(1)}%`)
  }

  console.log('\n--- Sanity check: partita equilibrata, BuonaA (casa) vs BuonaB (trasferta) ---')
  const evenMatrix = scoreMatrix(fitted, 'BuonaA', 'BuonaB')
  const evenOneXTwo = market1X2(evenMatrix)
  console.log(`1X2 → 1: ${(evenOneXTwo.home * 100).toFixed(1)}%  X: ${(evenOneXTwo.draw * 100).toFixed(1)}%  2: ${(evenOneXTwo.away * 100).toFixed(1)}%`)
  console.log(`Vantaggio casa presente e ragionevole: ${evenOneXTwo.home > evenOneXTwo.away ? '✅ sì' : '❌ no — controlla home advantage'}`)

  console.log(`\nParametro rho stimato: ${fitted.rho.toFixed(4)} (atteso: piccolo, tipicamente tra -0.15 e 0.05)`)
  console.log(`Vantaggio casa stimato: ${fitted.homeAdvantage.toFixed(4)} (atteso: positivo, vicino a 0.2-0.3 dato il valore vero usato per generare i dati: ${TRUE_HOME_ADV})`)
}

main()
