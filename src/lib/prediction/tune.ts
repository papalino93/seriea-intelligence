/**
 * Grid search degli iperparametri di fitModel (timeDecay, l2) via cross-validation
 * a 2 fold sulle 3 stagioni reali disponibili sul piano free di football-data.org:
 *   Fold A: train 2023/24        → test 2024/25
 *   Fold B: train 2023/24+2024/25 → test 2025/26
 * Metrica di selezione: Brier Score medio sui due fold (più basso è meglio).
 *
 * Richiede FOOTBALL_DATA_API_KEY in .env.local. Esecuzione:
 *   node --experimental-strip-types --env-file=.env.local src/lib/prediction/tune.ts
 */
import { fitModel, scoreMatrix, market1X2, type MatchResult, type FitOptions } from './dixon-coles.ts'

const BASE_URL = 'https://api.football-data.org/v4'

interface RawMatch {
  utcDate: string
  status: string
  homeTeam: { name: string }
  awayTeam: { name: string }
  score: { fullTime: { home: number | null; away: number | null } }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchSeason(year: number): Promise<MatchResult[]> {
  const res = await fetch(`${BASE_URL}/competitions/SA/matches?season=${year}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! },
  })
  if (!res.ok) throw new Error(`stagione ${year} non accessibile: HTTP ${res.status}`)
  const json = await res.json()
  return (json.matches as RawMatch[])
    .filter((m) => m.status === 'FINISHED' && m.score.fullTime.home !== null && m.score.fullTime.away !== null)
    .map((m) => ({
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      homeGoals: m.score.fullTime.home!,
      awayGoals: m.score.fullTime.away!,
      date: new Date(m.utcDate),
    }))
}

function outcomeOf(homeGoals: number, awayGoals: number): 'home' | 'draw' | 'away' {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

function brierAndLogLoss(train: MatchResult[], test: MatchResult[], options: FitOptions) {
  const asOf = new Date(Math.max(...train.map((m) => m.date.getTime())) + 86400000)
  const fitted = fitModel(train, { ...options, asOf })

  let brierSum = 0
  let logLossSum = 0
  let n = 0
  for (const m of test) {
    if (!fitted.teams.has(m.homeTeam) || !fitted.teams.has(m.awayTeam)) continue
    const probs = market1X2(scoreMatrix(fitted, m.homeTeam, m.awayTeam))
    const actual = outcomeOf(m.homeGoals, m.awayGoals)
    const oneHot = { home: actual === 'home' ? 1 : 0, draw: actual === 'draw' ? 1 : 0, away: actual === 'away' ? 1 : 0 }
    brierSum += (probs.home - oneHot.home) ** 2 + (probs.draw - oneHot.draw) ** 2 + (probs.away - oneHot.away) ** 2
    logLossSum += -Math.log(Math.max(probs[actual], 1e-10))
    n++
  }
  return { brier: brierSum / n, logLoss: logLossSum / n, n }
}

async function main() {
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    console.error('FOOTBALL_DATA_API_KEY mancante.')
    process.exit(1)
  }

  console.log('Scarico stagioni 2023, 2024, 2025...\n')
  const s2023 = await fetchSeason(2023)
  await sleep(6500)
  const s2024 = await fetchSeason(2024)
  await sleep(6500)
  const s2025 = await fetchSeason(2025)
  console.log(`2023: ${s2023.length} partite, 2024: ${s2024.length} partite, 2025: ${s2025.length} partite\n`)

  const folds = [
    { name: 'A (train 23/24 → test 24/25)', train: s2023, test: s2024 },
    { name: 'B (train 23/24+24/25 → test 25/26)', train: [...s2023, ...s2024], test: s2025 },
  ]

  const timeDecayGrid = [0.0009, 0.0018, 0.0036]
  const l2Grid = [0.0005, 0.001, 0.002]

  console.log('timeDecay   l2       Brier (A)   Brier (B)   Brier medio   LogLoss medio')
  let best: { timeDecay: number; l2: number; avgBrier: number; avgLogLoss: number } | null = null

  for (const timeDecay of timeDecayGrid) {
    for (const l2 of l2Grid) {
      const results = folds.map((f) => brierAndLogLoss(f.train, f.test, { timeDecay, l2 }))
      const avgBrier = results.reduce((s, r) => s + r.brier, 0) / results.length
      const avgLogLoss = results.reduce((s, r) => s + r.logLoss, 0) / results.length

      console.log(
        `${timeDecay.toFixed(4)}     ${l2.toFixed(4)}   ${results[0].brier.toFixed(4)}      ${results[1].brier.toFixed(4)}      ${avgBrier.toFixed(4)}         ${avgLogLoss.toFixed(4)}`
      )

      if (!best || avgBrier < best.avgBrier) {
        best = { timeDecay, l2, avgBrier, avgLogLoss }
      }
    }
  }

  console.log(`\nMiglior combinazione: timeDecay=${best!.timeDecay}, l2=${best!.l2}`)
  console.log(`Brier medio: ${best!.avgBrier.toFixed(4)}, Log Loss medio: ${best!.avgLogLoss.toFixed(4)}`)
  console.log(`(default attuale in dixon-coles.ts: timeDecay=0.0018, l2=0.001)`)
}

main()
