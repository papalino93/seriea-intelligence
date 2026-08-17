import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import SchedinaBuilder, { type MatchOption, type BookmakerOdds } from './schedina-builder'

export const dynamic = 'force-dynamic'

type OddsJoinRow = {
  match_id: number
  outcome: 'home' | 'draw' | 'away'
  value: number
  bookmakers: { name: string } | null
}

type PastSlip = {
  id: number
  stake: number | null
  created_at: string
  bet_slip_selections: {
    outcome: string
    odds_at_selection: number
    bookmaker_name: string
    matches: { home_team: { name: string } | null; away_team: { name: string } | null } | null
  }[]
}

export default async function SchedinaPage() {
  const supabase = await createClient()

  const { data: nextMatch } = await supabase
    .from('matches')
    .select('round_id')
    .gte('kickoff_at', new Date().toISOString())
    .order('kickoff_at', { ascending: true })
    .limit(1)
    .single()

  const roundId = (nextMatch as { round_id: number } | null)?.round_id

  const { data: matches } = roundId
    ? await supabase
        .from('matches')
        .select(
          `id, kickoff_at,
           home_team:teams!matches_home_team_id_fkey(name),
           away_team:teams!matches_away_team_id_fkey(name)`
        )
        .eq('round_id', roundId)
        .order('kickoff_at', { ascending: true })
    : { data: [] }

  const matchIds = (matches ?? []).map((m) => m.id)

  const { data: oddsRaw } = matchIds.length
    ? await supabase
        .from('odds')
        .select('match_id, outcome, value, bookmakers(name)')
        .eq('is_current', true)
        .in('match_id', matchIds)
    : { data: [] as OddsJoinRow[] }

  // Riorganizza in match_id -> bookmaker_name -> { home, draw, away }
  const oddsByMatch: Record<number, Record<string, BookmakerOdds>> = {}
  for (const o of (oddsRaw as unknown as OddsJoinRow[] | null) ?? []) {
    const bkName = o.bookmakers?.name
    if (!bkName) continue
    oddsByMatch[o.match_id] ??= {}
    oddsByMatch[o.match_id][bkName] ??= { home: null, draw: null, away: null }
    oddsByMatch[o.match_id][bkName][o.outcome] = o.value
  }

  const matchOptions: MatchOption[] = (matches ?? []).map((m) => ({
    id: m.id,
    homeTeam: (m as unknown as { home_team: { name: string } | null }).home_team?.name ?? '—',
    awayTeam: (m as unknown as { away_team: { name: string } | null }).away_team?.name ?? '—',
    kickoffAt: m.kickoff_at,
    bookmakerOdds: oddsByMatch[m.id] ?? {},
  }))

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: pastSlips } = user
    ? await supabase
        .from('bet_slips')
        .select(
          `id, stake, created_at,
           bet_slip_selections(outcome, odds_at_selection, bookmaker_name,
             matches(home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)))`
        )
        .order('created_at', { ascending: false })
        .limit(10)
    : { data: [] as PastSlip[] }

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
          ← dashboard
        </Link>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Schedina virtuale</p>
        <h1 className="mt-2 font-display text-2xl">Costruisci la tua schedina</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Solo a scopo di analisi e tracking personale — nessuna puntata reale viene gestita da
          questa app.
        </p>

        {matchOptions.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-surface p-6 text-sm text-text-secondary">
            Nessuna partita disponibile per la prossima giornata.
          </p>
        ) : (
          <SchedinaBuilder matches={matchOptions} />
        )}

        <PastSlips slips={(pastSlips as unknown as PastSlip[] | null) ?? []} />
      </div>
    </main>
  )
}

function PastSlips({ slips }: { slips: PastSlip[] }) {
  if (slips.length === 0) return null
  return (
    <div className="mt-10">
      <h2 className="font-display text-sm text-text-secondary">Le tue ultime schedine</h2>
      <div className="mt-3 space-y-3">
        {slips.map((slip) => (
          <div key={slip.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between font-mono text-xs text-text-secondary">
              <span>{new Date(slip.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</span>
              {slip.stake != null && <span>puntata: {slip.stake}</span>}
            </div>
            <div className="mt-2 space-y-1">
              {slip.bet_slip_selections.map((s, i) => (
                <p key={i} className="font-mono text-xs">
                  {s.matches?.home_team?.name ?? '—'} vs {s.matches?.away_team?.name ?? '—'} ·{' '}
                  {s.outcome === 'home' ? '1' : s.outcome === 'draw' ? 'X' : '2'} @{' '}
                  <span className="text-accent-gold">{s.odds_at_selection.toFixed(2)}</span> ({s.bookmaker_name})
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
