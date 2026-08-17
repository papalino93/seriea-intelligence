import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { createClient } from '@/lib/supabase/server'
import FavoriteTeamSection from './favorite-team-section'

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
type PredictionRow = { match_id: number; home_win: number; draw: number; away_win: number }

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
  // string = marcatore consigliato, null = segna ma non abbiamo dati marcatori,
  // undefined = la squadra preferita non segna in questo risultato consigliato.
  scorerSuggestion: string | null | undefined
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
    ? await supabase.from('predictions').select('match_id, home_win, draw, away_win').in('match_id', matchIds)
    : { data: [] as PredictionRow[] }
  const predictionByMatch = new Map((predictionsData as PredictionRow[] | null)?.map((p) => [p.match_id, p]))

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
        .order('kickoff_at', { ascending: false })
        .limit(5),
    ])

    let nextMatchRecommendation: FavoriteTeamRecommendation | null = null
    const nextMatch = (upcoming as unknown as FavoriteTeamMatch[] | null)?.[0]
    if (nextMatch) {
      const [{ data: matchSides }, { data: prediction }, { data: topScorer }] = await Promise.all([
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
          .select('name')
          .eq('team_id', teamId)
          .eq('excluded', false)
          .order('goals', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      const topScore = (prediction?.top_scores as { home: number; away: number; probability: number }[] | undefined)?.[0]
      if (matchSides && topScore) {
        const isHome = matchSides.home_team_id === teamId
        const teamGoals = isHome ? topScore.home : topScore.away
        nextMatchRecommendation = {
          matchId: nextMatch.id,
          opponentName: (isHome ? nextMatch.away_team?.name : nextMatch.home_team?.name) ?? '—',
          isHome,
          homeScore: topScore.home,
          awayScore: topScore.away,
          probability: topScore.probability,
          scorerSuggestion: teamGoals > 0 ? (topScorer?.name ?? null) : undefined,
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
                  strong: (p) => <strong className="text-accent-gold" {...p} />,
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
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 font-mono text-xs">
          <span className="text-text-secondary">stima</span>
          <ProbPill label="1" value={prediction.home_win} />
          <ProbPill label="X" value={prediction.draw} />
          <ProbPill label="2" value={prediction.away_win} />
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
    <div className={`flex flex-1 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && <img src={logo} alt="" className="h-6 w-6" />}
      <span className="font-display text-sm">{name ?? 'Squadra sconosciuta'}</span>
      {score != null && <span className="font-mono text-sm text-text-secondary">{score}</span>}
    </div>
  )
}
