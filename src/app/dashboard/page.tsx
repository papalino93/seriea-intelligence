import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { createClient } from '@/lib/supabase/server'
import {
  recentFormCutoffDate,
  pickTopScorers,
  pickRandomOutsider,
  VALUE_EDGE_THRESHOLD,
  type ScorerSuggestions,
} from '@/lib/constants'
import FavoriteTeamSection from './favorite-team-section'
import ProbabilityBar from '@/components/ProbabilityBar'

export const dynamic = 'force-dynamic'

type SyncLog = { created_at: string; status: string }

type MatchRow = {
  id: number
  kickoff_at: string
  venue: string | null
  status: string
  home_score: number | null
  away_score: number | null
  home_team: { name: string; logo_url: string | null } | null
  away_team: { name: string; logo_url: string | null } | null
}

type OddsRow = { match_id: number; outcome: 'home' | 'draw' | 'away'; value: number; bookmaker_id: number }
type BestOdds = { home: number; draw: number; away: number; bookmakerCount: number }
type PredictionRow = {
  match_id: number
  home_win: number
  draw: number
  away_win: number
  top_scores: { home: number; away: number; probability: number }[] | null
}
type ValueSignalRow = {
  match_id: number
  outcome: 'home' | 'draw' | 'away'
  edge: number
  best_odds: number
  bookmaker_name: string
}
type MatchOfDay = {
  match: MatchRow
  prediction: PredictionRow
  value: ValueSignalRow | null
}

type FavoriteTeamMatch = { id: number; kickoff_at: string; home_team: { name: string } | null; away_team: { name: string } | null }
type FavoriteTeamFormMatch = {
  id: number
  kickoff_at: string
  home_score: number | null
  away_score: number | null
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}
type FavoriteTeamRecommendation = {
  matchId: number
  opponentName: string
  isHome: boolean
  homeScore: number
  awayScore: number
  probability: number
  // undefined = la squadra preferita non segna in questo risultato consigliato.
  scorerSuggestions: ScorerSuggestions | undefined
}

type ManageableScorer = { id: number; name: string; goals: number; excluded: boolean }

type FavoriteTeamData = {
  name: string
  logoUrl: string | null
  rating: number | null
  upcoming: FavoriteTeamMatch[]
  recentForm: FavoriteTeamFormMatch[]
  teamId: number
  nextMatchRecommendation: FavoriteTeamRecommendation | null
  manageableScorers: ManageableScorer[]
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>
}) {
  const supabase = await createClient()
  const { round: roundParam } = await searchParams

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role, favorite_team_id').eq('id', user.id).single()
    : { data: null }

  // Stagione corrente: serve per risolvere un numero di giornata (?round=N)
  // in un round_id specifico, e per sapere i confini min/max per prev/next.
  const { data: currentSeason } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_current', true)
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: seasonRounds } = currentSeason
    ? await supabase
        .from('rounds')
        .select('id, round_number')
        .eq('season_id', currentSeason.id)
        .order('round_number', { ascending: true })
    : { data: [] as { id: number; round_number: number }[] }

  let roundId: number | undefined
  let roundNumber: number | string = '—'

  if (roundParam && seasonRounds?.length) {
    const requested = seasonRounds.find((r) => r.round_number === Number(roundParam))
    if (requested) {
      roundId = requested.id
      roundNumber = requested.round_number
    }
  }

  if (roundId == null) {
    const { data: nextMatch } = await supabase
      .from('matches')
      .select('round_id, rounds(round_number)')
      .gte('kickoff_at', new Date().toISOString())
      .order('kickoff_at', { ascending: true })
      .limit(1)
      .single()
    roundId = (nextMatch as { round_id: number } | null)?.round_id
    roundNumber = (nextMatch as { rounds: { round_number: number } | null } | null)?.rounds?.round_number ?? '—'
  }

  const minRound = seasonRounds?.[0]?.round_number
  const maxRound = seasonRounds?.[seasonRounds.length - 1]?.round_number
  const prevRound = typeof roundNumber === 'number' && minRound != null && roundNumber > minRound ? roundNumber - 1 : null
  const nextRound = typeof roundNumber === 'number' && maxRound != null && roundNumber < maxRound ? roundNumber + 1 : null

  const { data: matches } = roundId
    ? await supabase
        .from('matches')
        .select(
          `id, kickoff_at, venue, status, home_score, away_score,
           home_team:teams!matches_home_team_id_fkey(name, logo_url),
           away_team:teams!matches_away_team_id_fkey(name, logo_url)`
        )
        .eq('round_id', roundId)
        .order('kickoff_at', { ascending: true })
    : { data: [] as MatchRow[] }

  const matchIds = (matches as unknown as MatchRow[] | null)?.map((m) => m.id) ?? []
  const { data: oddsData } = matchIds.length
    ? await supabase.from('odds').select('match_id, outcome, value, bookmaker_id').eq('is_current', true).in('match_id', matchIds)
    : { data: [] as OddsRow[] }

  const bestOddsByMatch = new Map<number, BestOdds>()
  for (const o of (oddsData as OddsRow[] | null) ?? []) {
    const existing = bestOddsByMatch.get(o.match_id) ?? { home: 0, draw: 0, away: 0, bookmakerCount: 0 }
    existing[o.outcome] = Math.max(existing[o.outcome], o.value)
    bestOddsByMatch.set(o.match_id, existing)
  }
  // conteggio bookmaker distinti per partita (indipendente dall'esito)
  const bookmakerSetByMatch = new Map<number, Set<number>>()
  for (const o of (oddsData as OddsRow[] | null) ?? []) {
    const set = bookmakerSetByMatch.get(o.match_id) ?? new Set<number>()
    set.add(o.bookmaker_id)
    bookmakerSetByMatch.set(o.match_id, set)
  }
  for (const [matchId, best] of bestOddsByMatch) {
    best.bookmakerCount = bookmakerSetByMatch.get(matchId)?.size ?? 0
  }

  const { data: predictionsData } = matchIds.length
    ? await supabase.from('predictions').select('match_id, home_win, draw, away_win, top_scores').in('match_id', matchIds)
    : { data: [] as PredictionRow[] }
  const predictionByMatch = new Map((predictionsData as PredictionRow[] | null)?.map((p) => [p.match_id, p]))

  const { data: valueSignalsData } = matchIds.length
    ? await supabase
        .from('value_signals')
        .select('match_id, outcome, edge, best_odds, bookmaker_name')
        .in('match_id', matchIds)
        .gte('edge', VALUE_EDGE_THRESHOLD)
        .order('edge', { ascending: false })
    : { data: [] as ValueSignalRow[] }
  // Partita del giorno: quella con il segnale di value più forte se ce n'è
  // uno (edge più alto tra le partite della giornata), altrimenti quella con
  // la stima di probabilità più alta del modello — mai una scelta arbitraria
  // o un dato inventato, solo il numero già calcolato più "forte" tra quelli reali.
  let matchOfDay: MatchOfDay | null = null
  const matchesList = (matches as unknown as MatchRow[] | null) ?? []
  const bestValueSignal = (valueSignalsData as ValueSignalRow[] | null)?.[0]
  if (bestValueSignal) {
    const m = matchesList.find((mm) => mm.id === bestValueSignal.match_id)
    const p = predictionByMatch.get(bestValueSignal.match_id)
    if (m && p) matchOfDay = { match: m, prediction: p, value: bestValueSignal }
  }
  if (!matchOfDay) {
    let best: { m: MatchRow; p: PredictionRow; conf: number } | null = null
    for (const m of matchesList) {
      const p = predictionByMatch.get(m.id)
      if (!p) continue
      const conf = Math.max(p.home_win, p.draw, p.away_win)
      if (!best || conf > best.conf) best = { m, p, conf }
    }
    if (best) matchOfDay = { match: best.m, prediction: best.p, value: null }
  }

  const { data: lastSync } = await supabase
    .from('sync_logs')
    .select('created_at, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: roundSummary } = roundId
    ? await supabase.from('round_summaries').select('summary_text, generated_at').eq('round_id', roundId).maybeSingle()
    : { data: null }

  const { data: allTeams } = await supabase.from('teams').select('id, name').order('name', { ascending: true })

  let favoriteTeamData: FavoriteTeamData | null = null
  if (profile?.favorite_team_id) {
    const teamId = profile.favorite_team_id
    const [{ data: team }, { data: rating }, { data: upcoming }, { data: recentForm }] = await Promise.all([
      supabase.from('teams').select('name, logo_url').eq('id', teamId).single(),
      supabase.from('team_ratings').select('rating').eq('team_id', teamId).order('computed_at', { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from('matches')
        .select(
          `id, kickoff_at,
           home_team:teams!matches_home_team_id_fkey(name),
           away_team:teams!matches_away_team_id_fkey(name)`
        )
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .gte('kickoff_at', new Date().toISOString())
        .order('kickoff_at', { ascending: true })
        .limit(3),
      supabase
        .from('matches')
        .select(
          `id, kickoff_at, home_score, away_score,
           home_team:teams!matches_home_team_id_fkey(id, name),
           away_team:teams!matches_away_team_id_fkey(id, name)`
        )
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq('status', 'finished')
        .gte('kickoff_at', recentFormCutoffDate().toISOString())
        .order('kickoff_at', { ascending: false })
        .limit(5),
    ])

    let nextMatchRecommendation: FavoriteTeamRecommendation | null = null
    const nextMatch = (upcoming as unknown as FavoriteTeamMatch[] | null)?.[0]
    if (nextMatch) {
      const [{ data: matchSides }, { data: prediction }, { data: topScorer }, { data: squad }] = await Promise.all([
        supabase.from('matches').select('home_team_id, away_team_id').eq('id', nextMatch.id).single(),
        supabase
          .from('predictions')
          .select('top_scores')
          .eq('match_id', nextMatch.id)
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('player_scorers')
          .select('name, goals, current_season_matches')
          .eq('team_id', teamId)
          .eq('excluded', false)
          .order('goals', { ascending: false })
          .limit(8),
        supabase.from('players').select('name').eq('team_id', teamId),
      ])
      const topScore = (prediction?.top_scores as { home: number; away: number; probability: number }[] | undefined)?.[0]
      if (matchSides && topScore) {
        const isHome = matchSides.home_team_id === teamId
        const teamGoals = isHome ? topScore.home : topScore.away
        const top = pickTopScorers(topScorer ?? [])
        nextMatchRecommendation = {
          matchId: nextMatch.id,
          opponentName: (isHome ? nextMatch.away_team?.name : nextMatch.home_team?.name) ?? '—',
          isHome,
          homeScore: topScore.home,
          awayScore: topScore.away,
          probability: topScore.probability,
          scorerSuggestions: teamGoals > 0 ? { top, underdog: pickRandomOutsider(squad ?? [], top) } : undefined,
        }
      }
    }

    const { data: manageableScorers } = await supabase
      .from('player_scorers')
      .select('id, name, goals, excluded')
      .eq('team_id', teamId)
      .order('goals', { ascending: false })
      .limit(8)

    if (team) {
      favoriteTeamData = {
        name: team.name,
        logoUrl: team.logo_url,
        rating: rating?.rating ?? null,
        upcoming: (upcoming as unknown as FavoriteTeamMatch[]) ?? [],
        recentForm: (recentForm as unknown as FavoriteTeamFormMatch[]) ?? [],
        teamId,
        nextMatchRecommendation,
        manageableScorers: (manageableScorers as ManageableScorer[] | null) ?? [],
      }
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
              Serie A · {roundParam ? 'Giornata selezionata' : 'Prossima giornata'}
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="scoreboard-digit">{roundNumber}</span>
              <span className="font-display text-2xl text-text-secondary">Giornata</span>
            </div>
            <div className="mt-1 flex gap-3 font-mono text-xs">
              {prevRound != null ? (
                <Link href={`/dashboard?round=${prevRound}`} className="text-text-secondary underline">
                  ← giornata {prevRound}
                </Link>
              ) : (
                <span className="text-text-secondary/40">← giornata {typeof roundNumber === 'number' ? roundNumber - 1 : ''}</span>
              )}
              {nextRound != null && (
                <Link href={`/dashboard?round=${nextRound}`} className="text-text-secondary underline">
                  giornata {nextRound} →
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SyncBadge lastSync={lastSync as SyncLog | null} />
            <Link href="/dashboard/schedina" className="font-mono text-xs text-text-secondary underline">
              schedina virtuale
            </Link>
            <Link href="/dashboard/backtest" className="font-mono text-xs text-text-secondary underline">
              backtesting
            </Link>
            <Link href="/dashboard/ratings" className="font-mono text-xs text-text-secondary underline">
              power ranking
            </Link>
            {profile?.role === 'admin' && (
              <Link href="/dashboard/admin" className="font-mono text-xs text-text-secondary underline">
                pannello admin
              </Link>
            )}
          </div>
        </header>

        {matchOfDay && <MatchOfDaySection data={matchOfDay} />}

        <FavoriteTeamSection allTeams={allTeams ?? []} favoriteTeam={favoriteTeamData} isAdmin={profile?.role === 'admin'} />

        {roundSummary?.summary_text && (
          <div className="mb-6 rounded-lg border border-border bg-surface p-5">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
              Commento della giornata
            </p>
            <div className="mt-3 text-sm leading-relaxed text-text-primary">
              <ReactMarkdown
                components={{
                  h1: (p) => <h3 className="mt-4 mb-2 font-display text-lg first:mt-0" {...p} />,
                  h2: (p) => <h3 className="mt-4 mb-2 font-display text-lg first:mt-0" {...p} />,
                  h3: (p) => <h4 className="mt-4 mb-2 font-display text-base first:mt-0" {...p} />,
                  p: (p) => <p className="mb-3" {...p} />,
                  // font-mono, non il bold di default del tag <strong>: i numeri (percentuali,
                  // quote, risultati) sono sempre in grassetto nel testo IA, e altrove nell'app
                  // (ProbBlock, OddsPill, ecc.) i numeri sono sempre in IBM Plex Mono — qui
                  // finivano nel font body normale (Inter), stonando col resto. Font-medium
                  // invece di lasciare il bold di default: IBM Plex Mono qui è caricato solo nei
                  // pesi 400/500, un 700 verrebbe simulato dal browser (bold finto, meno nitido).
                  strong: (p) => <strong className="font-mono font-medium text-accent-gold" {...p} />,
                  em: (p) => <em className="text-text-secondary not-italic" {...p} />,
                  ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
                  li: (p) => <li {...p} />,
                  hr: () => <hr className="my-4 border-border" />,
                }}
              >
                {roundSummary.summary_text}
              </ReactMarkdown>
            </div>
            <p className="mt-4 font-mono text-[10px] text-text-secondary">
              Generato da un modello linguistico a partire dai numeri già calcolati dal nostro
              motore statistico — {new Date(roundSummary.generated_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}
            </p>
          </div>
        )}

        {!matches?.length && (
          <p className="rounded-lg border border-border bg-surface p-6 text-sm text-text-secondary">
            Nessuna partita trovata. Se è la prima volta che apri la dashboard, un admin deve
            eseguire una sincronizzazione dal pannello admin.
          </p>
        )}

        <div className="grid gap-3">
          {(matches as unknown as MatchRow[] | null)?.map((m) => (
            <MatchCard
              key={m.id}
              match={m}
              odds={bestOddsByMatch.get(m.id) ?? null}
              prediction={predictionByMatch.get(m.id) ?? null}
            />
          ))}
        </div>

        {(bestOddsByMatch.size > 0 || predictionByMatch.size > 0) && (
          <p className="mt-6 font-mono text-xs text-text-secondary">
            Quote: migliori tra i bookmaker europei disponibili — nessuna garanzia di copertura sui
            bookmaker italiani (Snai, Sisal ecc.). Previsioni: probabilità stimate da un modello
            statistico (Dixon-Coles) sui risultati storici, non un pronostico garantito. Solo a
            scopo informativo, non è consiglio di gioco.
          </p>
        )}
      </div>
    </main>
  )
}

const HERO_OUTCOME_LABEL: Record<ValueSignalRow['outcome'], string> = {
  home: '1 (casa)',
  draw: 'X (pareggio)',
  away: '2 (trasferta)',
}

/**
 * Partita del giorno: la più "interessante" tra quelle già calcolate — value
 * più forte se c'è, altrimenti la stima di probabilità più alta del modello.
 * Nessun testo generato: solo numeri già calcolati altrove, messi in
 * evidenza — coerente col resto dell'app (mai un dato o un giudizio inventato).
 */
function MatchOfDaySection({ data }: { data: MatchOfDay }) {
  const { match: m, prediction: p, value: v } = data
  const kickoff = new Date(m.kickoff_at)
  const day = kickoff.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Rome',
  })
  const time = kickoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
  const topScore = p.top_scores?.[0]

  return (
    <Link
      href={`/dashboard/match/${m.id}`}
      className="mb-6 block rounded-lg border border-accent-gold/40 bg-surface p-5 transition-colors hover:bg-surface-hover"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent-gold">
          ★ Partita del giorno {v ? '· possibile value' : '· stima più netta'}
        </span>
        <span className="font-mono text-xs text-text-secondary">
          {day} · {time}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <TeamRow name={m.home_team?.name} logo={m.home_team?.logo_url} score={null} />
        <span className="px-3 font-mono text-xs text-text-secondary">vs</span>
        <TeamRow name={m.away_team?.name} logo={m.away_team?.logo_url} score={null} align="right" />
      </div>
      <div className="mt-4 flex items-center justify-around font-mono text-sm">
        <ProbPill label="1" value={p.home_win} />
        <ProbPill label="X" value={p.draw} />
        <ProbPill label="2" value={p.away_win} />
      </div>
      <div className="mt-2">
        <ProbabilityBar home={p.home_win} draw={p.draw} away={p.away_win} />
      </div>
      {(topScore || v) && (
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 font-mono text-xs sm:grid-cols-3">
          {topScore && (
            <div>
              <p className="text-text-secondary">risultato esatto consigliato</p>
              <p className="mt-1 text-text-primary">
                {topScore.home}-{topScore.away}{' '}
                <span className="text-accent-gold">{(topScore.probability * 100).toFixed(1)}%</span>
              </p>
            </div>
          )}
          {v && (
            <>
              <div>
                <p className="text-text-secondary">possibile value</p>
                <p className="mt-1 text-accent-gold">
                  {HERO_OUTCOME_LABEL[v.outcome]} · +{(v.edge * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-text-secondary">quota migliore</p>
                <p className="mt-1 text-text-primary">
                  {v.best_odds.toFixed(2)} <span className="text-text-secondary">({v.bookmaker_name})</span>
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </Link>
  )
}

function SyncBadge({ lastSync }: { lastSync: SyncLog | null }) {
  if (!lastSync) {
    return (
      <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-text-secondary">
        dati non ancora sincronizzati
      </span>
    )
  }
  const isOk = lastSync.status === 'success'
  const time = new Date(lastSync.created_at).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  })
  return (
    <span
      className={`rounded-full border px-3 py-1 font-mono text-xs ${
        isOk ? 'border-accent-pitch/40 text-accent-pitch' : 'border-accent-danger/40 text-accent-danger'
      }`}
    >
      {isOk ? 'aggiornato' : 'errore sync'} · {time}
    </span>
  )
}

function MatchCard({
  match,
  odds,
  prediction,
}: {
  match: MatchRow
  odds: BestOdds | null
  prediction: PredictionRow | null
}) {
  const kickoff = new Date(match.kickoff_at)
  const day = kickoff.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Rome',
  })
  const time = kickoff.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  })

  return (
    <Link
      href={`/dashboard/match/${match.id}`}
      className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
    >
      <div className="mb-3 flex items-center justify-between font-mono text-xs text-text-secondary">
        <span>
          {day} · {time}
        </span>
        {match.venue && <span>{match.venue}</span>}
      </div>
      <div className="flex items-center justify-between">
        <TeamRow name={match.home_team?.name} logo={match.home_team?.logo_url} score={match.home_score} />
        <span className="px-3 font-mono text-xs text-text-secondary">vs</span>
        <TeamRow
          name={match.away_team?.name}
          logo={match.away_team?.logo_url}
          score={match.away_score}
          align="right"
        />
      </div>
      {prediction && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-text-secondary">stima</span>
            <ProbPill label="1" value={prediction.home_win} />
            <ProbPill label="X" value={prediction.draw} />
            <ProbPill label="2" value={prediction.away_win} />
          </div>
          <div className="mt-2">
            <ProbabilityBar home={prediction.home_win} draw={prediction.draw} away={prediction.away_win} />
          </div>
        </div>
      )}
      {odds ? (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 font-mono text-xs">
          <OddsPill label="1" value={odds.home} />
          <OddsPill label="X" value={odds.draw} />
          <OddsPill label="2" value={odds.away} />
          <span className="text-text-secondary">{odds.bookmakerCount} bookmaker</span>
        </div>
      ) : (
        <p className="mt-3 border-t border-border pt-3 font-mono text-xs text-text-secondary">
          quote non disponibili
        </p>
      )}
    </Link>
  )
}

function ProbPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded border border-border px-2 py-0.5 text-text-primary">
      {label} <span className="text-accent-pitch">{(value * 100).toFixed(0)}%</span>
    </span>
  )
}

function OddsPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded border border-border px-2 py-0.5 text-text-primary">
      {label} <span className="text-accent-gold">{value.toFixed(2)}</span>
    </span>
  )
}

function TeamRow({
  name,
  logo,
  score,
  align = 'left',
}: {
  name?: string
  logo?: string | null
  score?: number | null
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" className="h-6 w-6 shrink-0" />}
      <span className="min-w-0 truncate font-display text-sm">{name ?? 'Squadra sconosciuta'}</span>
      {score != null && <span className="shrink-0 font-mono text-sm text-text-secondary">{score}</span>}
    </div>
  )
}
