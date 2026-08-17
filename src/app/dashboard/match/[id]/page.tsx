import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

// Sotto questa soglia il segnale non viene evidenziato come "value": il
// documento di progettazione (sezione 9) chiede di assorbire il rumore
// statistico del modello, non segnalare ogni minima differenza come opportunità.
const VALUE_EDGE_THRESHOLD = 0.03

type Scorer = { name: string; goals: number; played_matches: number }

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

  const { data: prediction } = await supabase
    .from('predictions')
    .select('home_win, draw, away_win, over_2_5, under_2_5, btts_yes, btts_no, top_scores, model_version')
    .eq('match_id', id)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: valueSignals } = await supabase
    .from('value_signals')
    .select('outcome, model_probability, implied_probability, best_odds, bookmaker_name, edge, ev')
    .eq('match_id', id)

  const [headToHead, homeForm, awayForm, homeScorers, awayScorers] = await Promise.all([
    homeId && awayId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .or(
            `and(home_team_id.eq.${homeId},away_team_id.eq.${awayId}),and(home_team_id.eq.${awayId},away_team_id.eq.${homeId})`
          )
          .eq('status', 'finished')
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    homeId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .eq('home_team_id', homeId)
          .eq('status', 'finished')
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    awayId
      ? supabase
          .from('matches')
          .select(FORM_SELECT)
          .eq('away_team_id', awayId)
          .eq('status', 'finished')
          .order('kickoff_at', { ascending: false })
          .limit(5)
      : { data: [] as FormMatch[] },
    homeId
      ? supabase
          .from('player_scorers')
          .select('name, goals, played_matches')
          .eq('team_id', homeId)
          .order('goals', { ascending: false })
          .limit(5)
      : { data: [] as Scorer[] },
    awayId
      ? supabase
          .from('player_scorers')
          .select('name, goals, played_matches')
          .eq('team_id', awayId)
          .order('goals', { ascending: false })
          .limit(5)
      : { data: [] as Scorer[] },
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

        {valueSignals && valueSignals.length > 0 && (
          <ValueSection signals={valueSignals as unknown as ValueSignal[]} />
        )}

        {prediction ? (
          <PredictionSection prediction={prediction as unknown as Prediction} />
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
          <MatchList matches={(headToHead.data as FormMatch[] | null) ?? []} empty="Nessun precedente trovato." />
        </Section>

        <Section title={`Ultime partite in casa — ${m.home_team?.name ?? 'squadra casa'}`}>
          <MatchList matches={(homeForm.data as FormMatch[] | null) ?? []} empty="Dati non disponibili." />
        </Section>

        <Section title={`Ultime partite in trasferta — ${m.away_team?.name ?? 'squadra trasferta'}`}>
          <MatchList matches={(awayForm.data as FormMatch[] | null) ?? []} empty="Dati non disponibili." />
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
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-text-secondary">{teamName}</p>
        <p className="font-mono text-[10px] text-text-secondary">gol · presenze · prob.</p>
      </div>
      {scorers.length === 0 ? (
        <p className="mt-2 font-mono text-xs text-text-secondary">Dati non disponibili.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {scorers.map((s) => {
            const rate = s.played_matches > 0 ? s.goals / s.played_matches : 0
            const scoreProbability = 1 - Math.exp(-rate)
            return (
              <div key={s.name} className="flex items-center justify-between font-mono text-xs">
                <span>{s.name}</span>
                <span className="text-text-secondary">
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
    <div className={`flex flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {team?.logo_url && <img src={team.logo_url} alt="" className="h-8 w-8" />}
      <div>
        <p className="font-display text-base">{team?.name ?? 'Squadra sconosciuta'}</p>
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
