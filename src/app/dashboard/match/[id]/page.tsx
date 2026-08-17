import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  VALUE_EDGE_THRESHOLD,
  recentFormCutoffDate,
  pickTopScorers,
  pickRandomOutsider,
  type ScorerSuggestions,
} from '@/lib/constants'

export const dynamic = 'force-dynamic'

type Team = { id: number; name: string; logo_url: string | null }

type MatchDetail = {
  id: number
  kickoff_at: string
  venue: string | null
  status: string
  home_score: number | null
  away_score: number | null
  home_score_ht: number | null
  away_score_ht: number | null
  referee_name: string | null
  home_team: Team | null
  away_team: Team | null
}

type Prediction = {
  home_win: number
  draw: number
  away_win: number
  over_2_5: number
  under_2_5: number
  btts_yes: number
  btts_no: number
  top_scores: { home: number; away: number; probability: number }[]
  model_version: string
}

type ValueSignal = {
  outcome: 'home' | 'draw' | 'away'
  model_probability: number
  implied_probability: number
  best_odds: number
  bookmaker_name: string
  edge: number
  ev: number
}

type OddsHistoryRow = { outcome: 'home' | 'draw' | 'away'; value: number; created_at: string }

type Scorer = { name: string; goals: number; played_matches: number; current_season_matches: number }

type FormMatch = {
  id: number
  kickoff_at: string
  home_score: number | null
  away_score: number | null
  home_team: { name: string } | null
  away_team: { name: string } | null
}

const MATCH_SELECT = `id, kickoff_at, venue, status, home_score, away_score, home_score_ht, away_score_ht, referee_name,
  home_team:teams!matches_home_team_id_fkey(id, name, logo_url),
  away_team:teams!matches_away_team_id_fkey(id, name, logo_url)`

const FORM_SELECT = `id, kickoff_at, home_score, away_score,
  home_team:teams!matches_home_team_id_fkey(name),
  away_team:teams!matches_away_team_id_fkey(name)`

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: match } = await supabase.from('matches').select(MATCH_SELECT).eq('id', id).single()
  if (!match) notFound()

  const m = match as unknown as MatchDetail
  const homeId = m.home_team?.id
  const awayId = m.away_team?.id

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('favorite_team_id').eq('id', user.id).single()
    : { data: null }
  const favoriteTeamId = viewerProfile?.favorite_team_id ?? null

  const { data: prediction } = await supabase
    .from('predictions')
    .select('home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, top_scores, model_version')
    .eq('match_id', id)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: oddsHistoryRaw } = await supabase
    .from('odds')
    .select('outcome, value, created_at')
    .eq('match_id', id)
    .order('created_at', { ascending: true })

  const { data: valueSignals } = await supabase
    .from('value_signals')
    .select('outcome, model_probability, implied_probability, best_odds, bookmaker_name, edge, ev')
    .eq('match_id', id)

  const formCutoff = recentFormCutoffDate().toISOString()

  const [headToHead, homeForm, awayForm, homeScorers, awayScorers, homeSquad, awaySquad] = await Promise.all([
    homeId && awayId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .or(
            `and(home_team_id.eq.${homeId},away_team_id.eq.${awayId}),and(home_team_id.eq.${awayId},away_team_id.eq.${homeId})`
          )
          .eq('status', 'finished')
          .gte('kickoff_at', formCutoff)
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    homeId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .eq('home_team_id', homeId)
          .eq('status', 'finished')
          .gte('kickoff_at', formCutoff)
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    awayId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .eq('away_team_id', awayId)
          .eq('status', 'finished')
          .gte('kickoff_at', formCutoff)
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    homeId
      ? supabase
          .from('player_scorers')
          .select('name, goals, played_matches, current_season_matches')
          .eq('team_id', homeId)
          .eq('excluded', false)
          .order('goals', { ascending: false })
          .limit(8)
      : { data: [] as Scorer[] },
    awayId
      ? supabase
          .from('player_scorers')
          .select('name, goals, played_matches, current_season_matches')
          .eq('team_id', awayId)
          .eq('excluded', false)
          .order('goals', { ascending: false })
          .limit(8)
      : { data: [] as Scorer[] },
    homeId
      ? supabase.from('players').select('name').eq('team_id', homeId)
      : { data: [] as { name: string }[] },
    awayId
      ? supabase.from('players').select('name').eq('team_id', awayId)
      : { data: [] as { name: string }[] },
  ])

  const kickoff = new Date(m.kickoff_at)
  const dateLabel = kickoff.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'Europe/Rome',
  })
  const timeLabel = kickoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
          ← dashboard
        </Link>

        <div className="mt-4 rounded-lg border border-border bg-surface p-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
            {dateLabel} · {timeLabel}
          </p>
          <div className="mt-4 flex items-center justify-between">
            <TeamHeader team={m.home_team} score={m.home_score} align="left" />
            <span className="px-3 font-mono text-xs text-text-secondary">vs</span>
            <TeamHeader team={m.away_team} score={m.away_score} align="right" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-secondary">
            {m.venue && <span>{m.venue}</span>}
            {m.referee_name && <span>arbitro: {m.referee_name}</span>}
            {m.status === 'finished' && m.home_score_ht != null && m.away_score_ht != null && (
              <span>
                1° tempo: {m.home_score_ht}-{m.away_score_ht}
              </span>
            )}
          </div>
        </div>

        <OddsHistorySection rows={(oddsHistoryRaw as OddsHistoryRow[] | null) ?? []} />

        {valueSignals && valueSignals.length > 0 && (
          <ValueSection signals={valueSignals as unknown as ValueSignal[]} />
        )}

        {prediction ? (
          <>
            <PredictionSection prediction={prediction as unknown as Prediction} />
            <RecommendedScoreSection
              prediction={prediction as unknown as Prediction}
              homeTeamId={homeId ?? null}
              awayTeamId={awayId ?? null}
              homeTeamName={m.home_team?.name ?? 'squadra casa'}
              awayTeamName={m.away_team?.name ?? 'squadra trasferta'}
              homeScorers={(homeScorers.data as Scorer[] | null) ?? []}
              awayScorers={(awayScorers.data as Scorer[] | null) ?? []}
              homeSquad={(homeSquad.data as { name: string }[] | null) ?? []}
              awaySquad={(awaySquad.data as { name: string }[] | null) ?? []}
              favoriteTeamId={favoriteTeamId}
            />
          </>
        ) : (
          m.status === 'scheduled' && (
            <p className="mt-8 font-mono text-xs text-text-secondary">
              Previsione non disponibile — o le squadre non hanno ancora storico a sufficienza, o il
              modello non è ancora stato calcolato per questa partita.
            </p>
          )
        )}

        <ScorersSection
          homeTeamName={m.home_team?.name ?? 'squadra casa'}
          awayTeamName={m.away_team?.name ?? 'squadra trasferta'}
          homeScorers={(homeScorers.data as Scorer[] | null) ?? []}
          awayScorers={(awayScorers.data as Scorer[] | null) ?? []}
        />

        <Section title="Precedenti">
          <MatchList
            matches={(headToHead.data as FormMatch[] | null) ?? []}
            empty="Nessun precedente in questa stagione o nella precedente."
          />
        </Section>

        <Section title={`Ultime partite in casa — ${m.home_team?.name ?? 'squadra casa'}`}>
          <MatchList
            matches={(homeForm.data as FormMatch[] | null) ?? []}
            empty="Ancora nessuna partita giocata in questa stagione o nella precedente."
          />
        </Section>

        <Section title={`Ultime partite in trasferta — ${m.away_team?.name ?? 'squadra trasferta'}`}>
          <MatchList
            matches={(awayForm.data as FormMatch[] | null) ?? []}
            empty="Ancora nessuna partita giocata in questa stagione o nella precedente."
          />
        </Section>

        <p className="mt-8 font-mono text-xs text-text-secondary">
          Statistiche calcolate sui dati disponibili nel nostro database (accumulati dai sync
          precedenti) — se una sezione è vuota, significa che non abbiamo ancora abbastanza storico,
          non che il dato non esista.
        </p>
      </div>
    </main>
  )
}

const OUTCOME_COLOR: Record<OddsHistoryRow['outcome'], string> = {
  home: '#3FA66B', // accent-pitch
  draw: '#C9A24B', // accent-gold
  away: '#C1584B', // accent-danger
}
const OUTCOME_SHORT: Record<OddsHistoryRow['outcome'], string> = { home: '1', draw: 'X', away: '2' }

/**
 * Andamento quote nel tempo (documento di progettazione: "storico variazioni
 * quota" / grafico andamento). Per ogni outcome, prende la quota MIGLIORE tra
 * i bookmaker a ogni timestamp di sync distinto — SVG inline, niente libreria
 * di grafici aggiuntiva per un solo sparkline a 3 linee.
 */
function OddsHistorySection({ rows }: { rows: OddsHistoryRow[] }) {
  if (rows.length < 2) return null // serve almeno 2 punti per un "andamento"

  // Per (timestamp, outcome) prendiamo la quota migliore tra i bookmaker.
  // Niente chiavi stringa concatenate: i timestamp ISO contengono ":" e
  // spaccherebbero uno split(':') nei posti sbagliati (bug reale trovato in
  // produzione — "outcome" finiva per essere un frammento d'orario tipo "29").
  const byOutcome: Record<OddsHistoryRow['outcome'], { t: number; v: number }[]> = { home: [], draw: [], away: [] }
  const bestByTimestamp = new Map<number, Partial<Record<OddsHistoryRow['outcome'], number>>>()
  for (const r of rows) {
    const t = new Date(r.created_at).getTime()
    const entry = bestByTimestamp.get(t) ?? {}
    entry[r.outcome] = Math.max(entry[r.outcome] ?? 0, r.value)
    bestByTimestamp.set(t, entry)
  }
  for (const [t, byOut] of bestByTimestamp) {
    for (const outcome of ['home', 'draw', 'away'] as const) {
      const v = byOut[outcome]
      if (v != null) byOutcome[outcome].push({ t, v })
    }
  }
  for (const outcome of Object.keys(byOutcome) as OddsHistoryRow['outcome'][]) {
    byOutcome[outcome].sort((a, b) => a.t - b.t)
  }

  const allValues = rows.map((r) => r.value)
  const allTimes = rows.map((r) => new Date(r.created_at).getTime())
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const minT = Math.min(...allTimes)
  const maxT = Math.max(...allTimes)
  const width = 320
  const height = 120
  const pad = 8

  function toXY(point: { t: number; v: number }) {
    const x = pad + ((point.t - minT) / Math.max(maxT - minT, 1)) * (width - 2 * pad)
    const y = height - pad - ((point.v - minV) / Math.max(maxV - minV, 1)) * (height - 2 * pad)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">Andamento quote (migliore per esito)</h2>
      <div className="mt-3 rounded-lg border border-border bg-surface p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 160 }}>
          {(['home', 'draw', 'away'] as const).map((outcome) =>
            byOutcome[outcome].length >= 2 ? (
              <polyline
                key={outcome}
                points={byOutcome[outcome].map(toXY).join(' ')}
                fill="none"
                stroke={OUTCOME_COLOR[outcome]}
                strokeWidth={2}
              />
            ) : null
          )}
        </svg>
        <div className="mt-2 flex gap-4 font-mono text-xs">
          {(['home', 'draw', 'away'] as const).map((outcome) => (
            <span key={outcome} style={{ color: OUTCOME_COLOR[outcome] }}>
              ● {OUTCOME_SHORT[outcome]}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        Ogni punto è la quota migliore disponibile tra i bookmaker monitorati al momento di ogni
        sincronizzazione — non in tempo reale, solo agli orari in cui abbiamo aggiornato i dati.
      </p>
    </div>
  )
}

function ScorersSection({
  homeTeamName,
  awayTeamName,
  homeScorers,
  awayScorers,
}: {
  homeTeamName: string
  awayTeamName: string
  homeScorers: Scorer[]
  awayScorers: Scorer[]
}) {
  if (homeScorers.length === 0 && awayScorers.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">Marcatori probabili</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ScorerList teamName={homeTeamName} scorers={homeScorers} />
        <ScorerList teamName={awayTeamName} scorers={awayScorers} />
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        Stima indicativa: gol/partita giocata sulle ultime stagioni (non gol/90&apos;, non abbiamo i
        minuti giocati) convertito in probabilità con un semplice modello di Poisson, senza
        aggiustamento per la difesa avversaria — meno preciso delle previsioni di squadra, va preso
        come indicazione di massima.
      </p>
    </div>
  )
}

function ScorerList({ teamName, scorers }: { teamName: string; scorers: Scorer[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs text-text-secondary">{teamName}</p>
        <p className="shrink-0 font-mono text-[10px] text-text-secondary">gol · presenze · prob.</p>
      </div>
      {scorers.length === 0 ? (
        <p className="mt-2 font-mono text-xs text-text-secondary">Dati non disponibili.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {scorers.map((s) => {
            const rate = s.played_matches > 0 ? s.goals / s.played_matches : 0
            const scoreProbability = 1 - Math.exp(-rate)
            return (
              <div key={s.name} className="flex items-center justify-between gap-2 font-mono text-xs">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-right text-text-secondary">
                  {s.goals} gol · {s.played_matches} pres. ·{' '}
                  <span className="text-accent-gold">{(scoreProbability * 100).toFixed(0)}% prob. gol</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const OUTCOME_LABEL: Record<ValueSignal['outcome'], string> = { home: '1 (casa)', draw: 'X (pareggio)', away: '2 (trasferta)' }

function ValueSection({ signals }: { signals: ValueSignal[] }) {
  const aboveThreshold = signals.filter((s) => s.edge >= VALUE_EDGE_THRESHOLD)
  if (aboveThreshold.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">Possibile value</h2>
      <div className="mt-3 space-y-2">
        {aboveThreshold.map((s) => (
          <div key={s.outcome} className="rounded-lg border border-accent-gold/40 bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-accent-gold/60 px-2 py-0.5 font-mono text-xs text-accent-gold">
                POSSIBILE VALUE
              </span>
              <span className="font-mono text-xs text-text-secondary">{OUTCOME_LABEL[s.outcome]}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 font-mono text-xs sm:grid-cols-3">
              <div>
                <p className="text-text-secondary">stima modello</p>
                <p className="mt-1 text-text-primary">{(s.model_probability * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-text-secondary">stima mercato</p>
                <p className="mt-1 text-text-primary">{(s.implied_probability * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-text-secondary">quota migliore</p>
                <p className="mt-1 text-accent-gold">
                  {s.best_odds.toFixed(2)} <span className="text-text-secondary">({s.bookmaker_name})</span>
                </p>
              </div>
            </div>
            <KellyReference modelProbability={s.model_probability} decimalOdds={s.best_odds} />
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        &quot;Possibile value&quot; significa solo che il nostro modello stima una probabilità più
        alta di quella implicita dalle quote — non è una vincita sicura, il modello può sbagliare.
        Soglia minima {(VALUE_EDGE_THRESHOLD * 100).toFixed(0)} punti percentuali per ridurre i falsi
        positivi da rumore statistico.
      </p>
    </div>
  )
}

/**
 * Riferimento matematico (frazione di Kelly), non un consiglio di puntata:
 * quanto suggerirebbe di puntare una formula classica di gestione del
 * bankroll SE la probabilità del modello fosse esattamente corretta — cosa
 * che non possiamo garantire. Mostriamo Kelly pieno e 1/4 Kelly (pratica
 * comune per ridurre la varianza) fianco a fianco, mai un numero prescrittivo isolato.
 */
function KellyReference({ modelProbability, decimalOdds }: { modelProbability: number; decimalOdds: number }) {
  const b = decimalOdds - 1
  const q = 1 - modelProbability
  const kellyFraction = modelProbability - q / b
  if (kellyFraction <= 0 || !Number.isFinite(kellyFraction)) return null

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between font-mono text-xs">
        <span className="text-text-secondary">riferimento matematico (Kelly)</span>
        <span>
          pieno <span className="text-text-primary">{(kellyFraction * 100).toFixed(1)}%</span> · 1/4 Kelly{' '}
          <span className="text-accent-pitch">{((kellyFraction / 4) * 100).toFixed(1)}%</span> del capitale dedicato
        </span>
      </div>
      <p className="mt-1 font-mono text-[10px] text-text-secondary">
        Non è un consiglio su quanto puntare — è la frazione che la formula di Kelly indicherebbe SE
        la stima del modello fosse esatta, cosa mai garantita. 1/4 Kelly è una convenzione comune per
        ridurre la varianza rispetto a Kelly pieno, che è spesso considerato troppo aggressivo nella
        pratica.
      </p>
    </div>
  )
}

function PredictionSection({ prediction: p }: { prediction: Prediction }) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">
        Previsione modello <span className="text-text-secondary/60">({p.model_version})</span>
      </h2>
      <div className="mt-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-around font-mono text-sm">
          <ProbBlock label="1" value={p.home_win} />
          <ProbBlock label="X" value={p.draw} />
          <ProbBlock label="2" value={p.away_win} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-text-secondary">Over 2.5</span>
            <span>{(p.over_2_5 * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Under 2.5</span>
            <span>{(p.under_2_5 * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Gol/Gol (GG)</span>
            <span>{(p.btts_yes * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">No Gol (NG)</span>
            <span>{(p.btts_no * 100).toFixed(0)}%</span>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <p className="font-mono text-xs text-text-secondary">Risultati esatti più probabili</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.top_scores.map((s, i) => (
              <span key={i} className="rounded border border-border px-2 py-1 font-mono text-xs">
                {s.home}-{s.away} <span className="text-accent-gold">{(s.probability * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        Probabilità stimate da un modello statistico (Dixon-Coles) sui risultati storici reali, non
        un pronostico garantito — vedi documento di progettazione.
      </p>
    </div>
  )
}

/**
 * Risultato esatto consigliato, sempre visibile in pagina (non solo dentro
 * il commento AI). Il marcatore condizionato viene mostrato SOLO per la
 * squadra preferita di chi guarda la pagina — per le altre ci fermiamo al
 * risultato esatto. Motivo: non abbiamo una fonte dati per infortuni/
 * squalifiche, quindi un nome di marcatore può risultare sbagliato (es. un
 * giocatore già ceduto); per la squadra preferita un admin può correggerlo a
 * mano escludendo il giocatore, per le altre no — meglio non esporre un dato
 * che potremmo sbagliare.
 */
function RecommendedScoreSection({
  prediction: p,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  homeScorers,
  awayScorers,
  homeSquad,
  awaySquad,
  favoriteTeamId,
}: {
  prediction: Prediction
  homeTeamId: number | null
  awayTeamId: number | null
  homeTeamName: string
  awayTeamName: string
  homeScorers: Scorer[]
  awayScorers: Scorer[]
  homeSquad: { name: string }[]
  awaySquad: { name: string }[]
  favoriteTeamId: number | null
}) {
  const topScore = p.top_scores?.[0]
  if (!topScore) return null

  const showHomeScorer = favoriteTeamId != null && favoriteTeamId === homeTeamId && topScore.home > 0
  const showAwayScorer = favoriteTeamId != null && favoriteTeamId === awayTeamId && topScore.away > 0
  const homeTop = pickTopScorers(homeScorers)
  const awayTop = pickTopScorers(awayScorers)
  const homeSuggestions: ScorerSuggestions = { top: homeTop, underdog: pickRandomOutsider(homeSquad, homeTop) }
  const awaySuggestions: ScorerSuggestions = { top: awayTop, underdog: pickRandomOutsider(awaySquad, awayTop) }

  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">Consigliato per questa partita</h2>
      <div className="mt-3 rounded-lg border border-accent-pitch/40 bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="rounded-full border border-accent-pitch/60 px-2 py-0.5 font-mono text-xs text-accent-pitch">
            RISULTATO ESATTO CONSIGLIATO
          </span>
          <span className="font-display text-lg">
            {topScore.home}-{topScore.away}{' '}
            <span className="font-mono text-xs text-accent-gold">{(topScore.probability * 100).toFixed(1)}%</span>
          </span>
        </div>
        {(showHomeScorer || showAwayScorer) && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 font-mono text-xs sm:grid-cols-2">
            {showHomeScorer && <ScorerSuggestionRow teamName={homeTeamName} suggestions={homeSuggestions} />}
            {showAwayScorer && <ScorerSuggestionRow teamName={awayTeamName} suggestions={awaySuggestions} />}
          </div>
        )}
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        {favoriteTeamId != null
          ? 'Marcatori mostrati solo per la tua squadra preferita, e solo se il risultato consigliato prevede un suo gol — papabili + un outsider, tutti da dati reali, non un pronostico garantito.'
          : 'Imposta una squadra preferita in dashboard per vedere anche i marcatori consigliati quando gioca lei.'}
      </p>
    </div>
  )
}

function ScorerSuggestionRow({ teamName, suggestions }: { teamName: string; suggestions: ScorerSuggestions }) {
  return (
    <div>
      <p className="text-text-secondary">{teamName}</p>
      {suggestions.top.length === 0 ? (
        <p className="mt-0.5 text-text-primary">dato non disponibile</p>
      ) : (
        <p className="mt-0.5 text-text-primary">papabili: {suggestions.top.join(', ')}</p>
      )}
      {suggestions.underdog && <p className="mt-0.5 text-accent-gold">outsider: {suggestions.underdog}</p>}
    </div>
  )
}

function ProbBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-text-secondary">{label}</p>
      <p className="mt-1 text-lg text-accent-pitch">{(value * 100).toFixed(0)}%</p>
    </div>
  )
}

function TeamHeader({ team, score, align }: { team: Team | null; score: number | null; align: 'left' | 'right' }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {team?.logo_url && <img src={team.logo_url} alt="" className="h-8 w-8 shrink-0" />}
      <div className="min-w-0">
        <p className="truncate font-display text-base">{team?.name ?? 'Squadra sconosciuta'}</p>
        {score != null && <p className="font-mono text-lg text-accent-pitch">{score}</p>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="font-display text-sm text-text-secondary">{title}</h2>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">{children}</div>
    </div>
  )
}

function MatchList({ matches, empty }: { matches: FormMatch[]; empty: string }) {
  if (!matches.length) {
    return <p className="px-4 py-3 font-mono text-xs text-text-secondary">{empty}</p>
  }
  return (
    <>
      {matches.map((m) => {
        const date = new Date(m.kickoff_at).toLocaleDateString('it-IT', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          timeZone: 'Europe/Rome',
        })
        return (
          <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-3 font-mono text-xs">
            <span className="text-text-secondary">{date}</span>
            <span>
              {m.home_team?.name ?? '—'} {m.home_score}-{m.away_score} {m.away_team?.name ?? '—'}
            </span>
          </div>
        )
      })}
    </>
  )
}
