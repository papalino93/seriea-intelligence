import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type RatingRow = {
  team_id: number
  rating: number
  attack: number
  defense: number
  computed_at: string
  teams: { name: string; logo_url: string | null } | null
}

export default async function RatingsPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('team_ratings')
    .select('team_id, rating, attack, defense, computed_at, teams(name, logo_url)')
    .order('computed_at', { ascending: false })

  // Solo l'ultimo rating per squadra (la tabella storicizza ogni ricalcolo).
  const latestByTeam = new Map<number, RatingRow>()
  for (const row of (data as unknown as RatingRow[] | null) ?? []) {
    if (!latestByTeam.has(row.team_id)) latestByTeam.set(row.team_id, row)
  }
  const ranked = Array.from(latestByTeam.values()).sort((a, b) => b.rating - a.rating)

  return (
    <main className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/dashboard" className="font-mono text-xs text-text-secondary underline">
          ← dashboard
        </Link>
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">Power Ranking</p>
        <h1 className="mt-2 font-display text-2xl">Forza squadre secondo il modello</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Rating 0-100, normalizzazione diretta dei parametri di attacco/difesa stimati dal modello
          Dixon-Coles — non un numero arbitrario, solo relativo a questo pool di squadre.
        </p>

        {ranked.length === 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-surface p-6 text-sm text-text-secondary">
            Nessun rating calcolato ancora — va rifittato il modello dal pannello admin (&quot;Ricalcola
            previsioni&quot;, che calcola anche i rating come sottoprodotto).
          </p>
        ) : (
          <div className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
            {ranked.map((r, i) => (
              <div key={r.team_id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 font-mono text-xs text-text-secondary">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.teams?.logo_url && <img src={r.teams.logo_url} alt="" className="h-6 w-6" />}
                <span className="flex-1 font-display text-sm">{r.teams?.name ?? '—'}</span>
                <span className="font-mono text-xs text-text-secondary">
                  att. {r.attack.toFixed(2)} · dif. {r.defense.toFixed(2)}
                </span>
                <span className="w-10 text-right font-mono text-sm text-accent-pitch">{r.rating}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 font-mono text-xs text-text-secondary">
          att. = parametro di attacco stimato (più alto = attacco più prolifico) · dif. = parametro di
          difesa (più basso = difesa più solida).
        </p>
      </div>
    </main>
  )
}
