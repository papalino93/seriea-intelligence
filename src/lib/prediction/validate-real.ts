/**
 * Validazione del motore Dixon-Coles su dati REALI di Serie A (ultimi ~10 anni,
 * football-data.org). A differenza di validate.ts (dati sintetici, verifica solo
 * la meccanica del fit), questo script è il vero banco di prova per la Fase 1.5:
 * fit su tutte le stagioni tranne l'ultima, backtest sull'ultima stagione,
 * Brier Score / Log Loss / calibrazione — come da documento di progettazione,
 * sezione 8 e 17.
 *
 * Richiede FOOTBALL_DATA_API_KEY in .env.local (o nell'ambiente). Esecuzione:
 *   node --experimental-strip-types --env-file=.env.local src/lib/prediction/validate-real.ts
 *
 * Non fa parte dell'app Next.js: script diagnostico una tantum.
 */
import { fitModel, scoreMatrix, market1X2, type MatchResult } from './dixon-coles.ts'

const BASE_URL = 'https://api.football-data.org/v4'
const SEASONS = Array.from({ length: 11 }, (_, i) => 2015 + i) // 2015..2025

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

async function fetchSeason(year: number): Promise<MatchResult[] | null> {
  const res = await fetch(`${BASE_URL}/competitions/SA/matches?season=${year}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! },
  })
  if (!res.ok) {
    const body = await res.text()
    console.log(`  stagione ${year}: non accessibile (HTTP ${res.status}) — ${body.slice(0, 150)}`)
    return null
  }
  const json = await res.json()
  const matches = (json.matches as RawMatch[])
    .filter((m) => m.status === 'FINISHED' && m.score.fullTime.home !== null && m.score.fullTime.away !== null)
    .map((m) => ({
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      homeGoals: m.score.fullTime.home!,
      awayGoals: m.score.fullTime.away!,
      date: new Date(m.utcDate),
    }))
  console.log(`  stagione ${year}: ${matches.length} partite concluse`)
  return matches
}

function outcomeOf(homeGoals: number, awayGoals: number): 'home' | 'draw' | 'away' {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

async function main() {
  if (!process.env.FOOTBALL_DATA_API_KEY) {
    console.error('FOOTBALL_DATA_API_KEY mancante nell\'ambiente. Aggiungila a .env.local.')
    process.exit(1)
  }

  console.log(`Scarico Serie A ${SEASONS[0]}-${SEASONS[SEASONS.length - 1]} da football-data.org...\n`)

  const all: MatchResult[] = []
  const accessibleYears: number[] = []
  for (const year of SEASONS) {
    const matches = await fetchSeason(year)
    if (matches && matches.length > 0) {
      all.push(...matches)
      accessibleYears.push(year)
    }
    await sleep(6500) // free tier: 10 richieste/minuto
  }

  if (accessibleYears.length < 2) {
    console.error('\nMeno di 2 stagioni accessibili: non basta per un backtest train/test significativo.')
    process.exit(1)
  }

  console.log(`\nStagioni accessibili sul piano free: ${accessibleYears.join(', ')}`)
  console.log(`Totale partite concluse raccolte: ${all.length}\n`)

  all.sort((a, b) => a.date.getTime() - b.date.getTime())

  const lastYear = accessibleYears[accessibleYears.length - 1]
  const testCutoff = new Date(`${lastYear}-06-01`) // separa l'ultima stagione (che parte ad agosto) dal resto
  const train = all.filter((m) => m.date < testCutoff)
  const test = all.filter((m) => m.date >= testCutoff)

  console.log(`Train: ${train.length} partite (fino a ${testCutoff.toISOString().slice(0, 10)})`)
  console.log(`Test:  ${test.length} partite (stagione ${lastYear}/${lastYear + 1})\n`)

  console.log('Fit del modello sul train set...')
  const asOf = new Date(Math.max(...train.map((m) => m.date.getTime())) + 86400000)
  const fitted = fitModel(train, { asOf })
  console.log(`Squadre nel modello: ${fitted.teams.size}`)
  console.log(`Vantaggio casa stimato: ${fitted.homeAdvantage.toFixed(4)}`)
  console.log(`Rho stimato: ${fitted.rho.toFixed(4)}\n`)

  console.log('Backtest sul test set...\n')
  let brierSum = 0
  let logLossSum = 0
  let evaluated = 0
  let skippedNewTeams = 0
  let correctPicks = 0

  // Calibrazione corretta: per ogni partita, ciascuno dei 3 esiti (home/draw/away)
  // contribuisce una coppia (probabilità predetta, è successo sì/no) al bucket
  // corrispondente — non solo l'esito poi realmente accaduto. Così il bucket
  // "70-80%" confronta la probabilità media predetta con la frequenza REALE con
  // cui quell'esito si è verificato in quel range, su tutte le previsioni fatte.
  const calibBuckets = Array.from({ length: 10 }, () => ({ predictedSum: 0, occurred: 0, count: 0 }))

  for (const m of test) {
    if (!fitted.teams.has(m.homeTeam) || !fitted.teams.has(m.awayTeam)) {
      skippedNewTeams++
      continue
    }
    const matrix = scoreMatrix(fitted, m.homeTeam, m.awayTeam)
    const probs = market1X2(matrix)
    const actual = outcomeOf(m.homeGoals, m.awayGoals)

    const oneHot = { home: actual === 'home' ? 1 : 0, draw: actual === 'draw' ? 1 : 0, away: actual === 'away' ? 1 : 0 }
    brierSum +=
      (probs.home - oneHot.home) ** 2 + (probs.draw - oneHot.draw) ** 2 + (probs.away - oneHot.away) ** 2
    logLossSum += -Math.log(Math.max(probs[actual], 1e-10))

    const predicted = (['home', 'draw', 'away'] as const).reduce((best, k) => (probs[k] > probs[best] ? k : best), 'home')
    if (predicted === actual) correctPicks++

    for (const outcome of ['home', 'draw', 'away'] as const) {
      const p = probs[outcome]
      const bucket = Math.min(9, Math.floor(p * 10))
      calibBuckets[bucket].predictedSum += p
      calibBuckets[bucket].occurred += outcome === actual ? 1 : 0
      calibBuckets[bucket].count += 1
    }

    evaluated++
  }

  console.log(`Partite valutate: ${evaluated} (escluse ${skippedNewTeams} per squadre neopromosse senza storico nel train)\n`)
  console.log(`Brier Score (multi-classe, 1X2): ${(brierSum / evaluated).toFixed(4)}  — atteso: un modello "banale" (probabilità uniformi 33/33/33) dà ~0.667; più basso è meglio`)
  console.log(`Log Loss: ${(logLossSum / evaluated).toFixed(4)}  — atteso: un modello uniforme dà ln(3) ≈ 1.099; più basso è meglio`)
  console.log(`Accuratezza pick secco (predetto = esito più probabile): ${((correctPicks / evaluated) * 100).toFixed(1)}%\n`)

  console.log('--- Calibrazione (curva di affidabilità su tutte e 3 le previsioni per partita) ---')
  console.log('bucket prob.   n. previsioni   prob. media predetta   frequenza reale')
  for (let i = 0; i < calibBuckets.length; i++) {
    const b = calibBuckets[i]
    if (b.count === 0) continue
    const predictedAvg = (b.predictedSum / b.count) * 100
    const actualFreq = (b.occurred / b.count) * 100
    const gap = Math.abs(predictedAvg - actualFreq)
    const flag = gap > 10 ? '  ⚠️ scarto > 10pt' : ''
    console.log(
      `${(i * 10).toString().padStart(2)}-${(i * 10 + 10).toString().padStart(3)}%     ${b.count.toString().padStart(9)}         ${predictedAvg.toFixed(1)}%              ${actualFreq.toFixed(1)}%${flag}`
    )
  }
  console.log(
    '\n(un modello ben calibrato ha "prob. media predetta" ≈ "frequenza reale" in ogni bucket: quando dice "60%" per un esito, quell\'esito deve verificarsi circa 6 volte su 10 nel lungo periodo — coerente col criterio di validazione del documento di progettazione, sezione 8.)'
  )
}

main()
