import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { VALUE_EDGE_THRESHOLD } from '@/lib/constants'

export const dynamic = 'force-dynamic'

type Outcome = 'home' | 'draw' | 'away'

type FinishedPrediction = {
  match_id: number
  model_version: string
  home_win: number
  draw: number
  away_win: number
  matches: {
    home_score: number | null
    away_score: number | null
    home_team: { name: string } | null
    away_team: { name: string } | null
  } | null
}

type FinishedValueSignal = {
  match_id: number
  outcome: Outcome
  edge: number
  best_odds: number
  bookmaker_name: string
  matches: { home_score: number | null; away_score: number | null } | null
}

function outcomeOf(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 'home'
  if (homeGoals < awayGoals) return 'away'
  return 'draw'
}

export default async function BacktestPage() {
  const supabase = await createClient()

  const { data: predictionsRaw } = await supabase
    .from('predictions')
    .select(
      `match_id, model_version, home_win, draw, away_win,
       matches!inner(home_score, away_score, status,
         home_team:teams!matches_home_team_id_fkey(name),
         away_team:teams!matches_away_team_id_fkey(name))`
    )
    .eq('matches.status', 'finished')

  const predictions = (predictionsRaw as unknown as FinishedPrediction[] | null) ?? []

  let brierSum = 0
  let logLossSum = 0
  let correctPicks = 0
  let evaluated = 0

  const rows: { home: string; away: string; score: string; homeWin: number; draw: number; awayWin: number; outcome: Outcome; correct: boolean }[] = []

  for (const p of predictions) {
    if (!p.matches || p.matches.home_score == null || p.matches.away_score == null) continue
    const actual = outcomeOf(p.matches.home_score, p.matches.away_score)
    const probs = { home: p.home_win, draw: p.draw, away: p.away_win }
    const oneHot = { home: actual === 'home' ? 1 : 0, draw: actual === 'draw' ? 1 : 0, away: actual === 'away' ? 1 : 0 }

    brierSum += (probs.home - oneHot.home) ** 2 + (probs.draw - oneHot.draw) ** 2 + (probs.away - oneHot.away) ** 2
    logLossSum += -Math.log(Math.max(probs[actual], 1e-10))

    const predicted = (['home', 'draw', 'away'] as const).reduce((best, k) => (probs[k] > probs[best] ? k : best), 'home')
    const correct = predicted === actual
    if (correct) correctPicks++
    evaluated++

    rows.push({
      home: p.matches.home_team?.name ?? '—',
      away: p.matches.away_team?.name ?? '—',
      score: `${p.matches.home_score}-${p.matches.away_score}`,
      homeWin: p.home_win,
      draw: p.draw,
      awayWin: p.away_win,
      outcome: actual,
      correct,
    })
  }

  // ---- ROI simulazione: 1 unità su ogni segnale di value su partite ora concluse ----
  const { data: signalsRaw } = await supabase
    .from('value_signals')
    .select(
      `match_id, outcome, edge, best_odds, bookmaker_name,
       matches!inner(home_score, away_score, status)`
    )
    .eq('matches.status', 'finished')
    .gte('edge', VALUE_EDGE_THRESHOLD)

  const signals = (signalsRaw as unknown as FinishedValueSignal[] | null) ?? []
  let staked = 0
  let returned = 0
  let wins = 0

  for (const s of signals) {
    if (!s.matches || s.matches.home_score == null || s.matches.away_score == null) continue
    const actual = outcomeOf(s.matches.home_score, s.matches.away_score)
    staked += 1
    if (actual === s.outcome) {
      returned += s.best_odds
      wins++
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
          ← dashboard
        </Link>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Backtesting</p>
        <h1 className="mt-2 font-display text-2xl">Modello vs mercato — storico reale</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Solo partite già concluse per cui avevamo già una previsione salvata PRIMA che si
          giocassero — mai calcolato a posteriori con dati che il modello non aveva ancora.
        </p>

        {evaluated === 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-surface p-6 text-sm text-text-secondary">
            Nessuna partita conclusa ha ancora una previsione salvata da confrontare — normale a
            inizio stagione. Torneranno dati qui via via che le giornate si giocano e la dashboard
            viene risincronizzata.
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Partite valutate" value={String(evaluated)} />
              <Stat label="Brier Score" value={(brierSum / evaluated).toFixed(4)} sub="baseline: 0.667" />
              <Stat label="Log Loss" value={(logLossSum / evaluated).toFixed(4)} sub="baseline: 1.099" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <Stat
                label="Accuratezza pick secco"
                value={`${((correctPicks / evaluated) * 100).toFixed(1)}%`}
                sub={`${correctPicks}/${evaluated} esiti più probabili indovinati`}
              />
            </div>

            {staked > 0 && (
              <div className="mt-6">
                <h2 className="font-display text-sm text-text-secondary">
                  Simulazione ROI sui segnali &quot;value&quot; (1 unità a segnale, soglia{' '}
                  {(VALUE_EDGE_THRESHOLD * 100).toFixed(0)} punti)
                </h2>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label="Segnali giocati" value={String(staked)} />
                  <Stat label="Vinti" value={`${wins} (${((wins / staked) * 100).toFixed(0)}%)`} />
                  <Stat
                    label="ROI"
                    value={`${(((returned - staked) / staked) * 100).toFixed(1)}%`}
                    sub={`puntato ${staked}, tornato ${returned.toFixed(2)}`}
                  />
                </div>
                <p className="mt-2 font-mono text-xs text-text-secondary">
                  Simulazione storica su un campione ancora piccolo — non è garanzia di risultati
                  futuri, coerente col principio di responsible gambling del progetto.
                </p>
              </div>
            )}

            <div className="mt-8">
              <h2 className="font-display text-sm text-text-secondary">Dettaglio partite</h2>
              <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                {rows.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 font-mono text-xs">
                    <span>
                      {r.home} {r.score} {r.away}
                    </span>
                    <span className="text-text-secondary">
                      previsto 1:{(r.homeWin * 100).toFixed(0)}% X:{(r.draw * 100).toFixed(0)}% 2:
                      {(r.awayWin * 100).toFixed(0)}%
                    </span>
                    <span className={r.correct ? 'text-accent-pitch' : 'text-accent-danger'}>
                      {r.correct ? 'pick corretto' : 'pick sbagliato'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="font-mono text-xs text-text-secondary">{label}</p>
      <p className="mt-1 font-display text-lg">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-text-secondary">{sub}</p>}
    </div>
  )
}
