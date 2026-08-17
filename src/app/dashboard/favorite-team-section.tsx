'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { setFavoriteTeam } from './favorite-team-actions'

type Team = { id: number; name: string }
type FavoriteTeamMatch = { id: number; kickoff_at: string; home_team: { name: string } | null; away_team: { name: string } | null }
type FavoriteTeamFormMatch = {
  id: number
  kickoff_at: string
  home_score: number | null
  away_score: number | null
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}
type FavoriteTeamData = {
  name: string
  logoUrl: string | null
  rating: number | null
  upcoming: FavoriteTeamMatch[]
  recentForm: FavoriteTeamFormMatch[]
  teamId: number
}

export default function FavoriteTeamSection({
  allTeams,
  favoriteTeam,
}: {
  allTeams: Team[]
  favoriteTeam: FavoriteTeamData | null
}) {
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSaving(true)
    const value = e.target.value ? Number(e.target.value) : null
    await setFavoriteTeam(value)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">La tua squadra</p>
        <select
          value={favoriteTeam?.teamId ?? ''}
          onChange={handleChange}
          disabled={saving}
          className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-accent-pitch"
        >
          <option value="">— scegli —</option>
          {allTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {favoriteTeam && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {favoriteTeam.logoUrl && <img src={favoriteTeam.logoUrl} alt="" className="h-10 w-10" />}
            <div>
              <p className="font-display text-lg">{favoriteTeam.name}</p>
              {favoriteTeam.rating != null && (
                <p className="font-mono text-xs text-text-secondary">rating modello: {favoriteTeam.rating}/100</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="font-mono text-xs text-text-secondary">Prossime partite</p>
              <div className="mt-2 space-y-1">
                {favoriteTeam.upcoming.length === 0 && (
                  <p className="font-mono text-xs text-text-secondary">nessuna in programma</p>
                )}
                {favoriteTeam.upcoming.map((m) => (
                  <Link
                    key={m.id}
                    href={`/dashboard/match/${m.id}`}
                    className="block font-mono text-xs underline hover:text-accent-pitch"
                  >
                    {new Date(m.kickoff_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })} ·{' '}
                    {m.home_team?.name} - {m.away_team?.name}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-xs text-text-secondary">Ultimi risultati</p>
              <div className="mt-2 space-y-1">
                {favoriteTeam.recentForm.length === 0 && (
                  <p className="font-mono text-xs text-text-secondary">nessuno storico ancora</p>
                )}
                {favoriteTeam.recentForm.map((m) => (
                  <p key={m.id} className="font-mono text-xs">
                    {m.home_team?.name} {m.home_score}-{m.away_score} {m.away_team?.name}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
