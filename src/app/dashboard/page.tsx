import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: profile } = await supabase.auth.getUser().then(async ({ data }) => {
    if (!data.user) return { data: null }
    return supabase.from('profiles').select('role').eq('id', data.user.id).single()
  })

  const { data: nextMatch } = await supabase
    .from('matches')
    .select('round_id, rounds(round_number)')
    .gte('kickoff_at', new Date().toISOString())
    .order('kickoff_at', { ascending: true })
    .limit(1)
    .single()

  const roundId = (nextMatch as { round_id: number } | null)?.round_id

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

  const { data: lastSync } = await supabase
    .from('sync_logs')
    .select('created_at, status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const roundNumber =
    (nextMatch as { rounds: { round_number: number } | null } | null)?.rounds?.round_number ?? '—'

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
              Serie A · Prossima giornata
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="scoreboard-digit">{roundNumber}</span>
              <span className="font-display text-2xl text-text-secondary">Giornata</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SyncBadge lastSync={lastSync as SyncLog | null} />
            {profile?.role === 'admin' && (
              <Link href="/dashboard/admin" className="font-mono text-xs text-text-secondary underline">
                pannello admin
              </Link>
            )}
          </div>
        </header>

        {!matches?.length && (
          <p className="rounded-lg border border-border bg-surface p-6 text-sm text-text-secondary">
            Nessuna partita trovata. Se è la prima volta che apri la dashboard, un admin deve
            eseguire una sincronizzazione dal pannello admin.
          </p>
        )}

        <div className="grid gap-3">
          {(matches as unknown as MatchRow[] | null)?.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
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

function MatchCard({ match }: { match: MatchRow }) {
  const kickoff = new Date(match.kickoff_at)
  const day = kickoff.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })
  const time = kickoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-hover">
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
    </div>
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
