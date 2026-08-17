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

  const [headToHead, homeForm, awayForm] = await Promise.all([
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
