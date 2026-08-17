'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveBetSlip, type SelectionInput } from './actions'

export type BookmakerOdds = { home: number | null; draw: number | null; away: number | null }
export type MatchOption = {
  id: number
  homeTeam: string
  awayTeam: string
  kickoffAt: string
  bookmakerOdds: Record<string, BookmakerOdds>
}

type Outcome = 'home' | 'draw' | 'away'
type Selections = Record<number, Outcome>

export default function SchedinaBuilder({ matches }: { matches: MatchOption[] }) {
  const [selections, setSelections] = useState<Selections>({})
  const [stake, setStake] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const router = useRouter()

  function toggle(matchId: number, outcome: Outcome) {
    setSelections((prev) => {
      const next = { ...prev }
      if (next[matchId] === outcome) delete next[matchId]
      else next[matchId] = outcome
      return next
    })
    setStatus('idle')
  }

  const summary = useMemo(() => computeSummary(matches, selections), [matches, selections])

  async function handleSave() {
    if (!summary.playable) return
    setStatus('saving')
    const selectionInputs: SelectionInput[] = summary.playable.legs.map((leg) => ({
      matchId: leg.matchId,
      outcome: leg.outcome,
      odds: leg.odds,
      bookmakerName: summary.playable!.bookmakerName,
    }))
    const res = await saveBetSlip(selectionInputs, stake ? Number(stake) : null)
    if ('error' in res) {
      setStatus('error')
      setErrorMsg(res.error ?? 'errore')
    } else {
      setStatus('saved')
      setSelections({}) // evita di risalvare per sbaglio la stessa schedina cliccando di nuovo
      setStake('')
      router.refresh()
    }
  }

  return (
    <div className="mt-6">
      <div className="grid gap-3">
        {matches.map((m) => (
          <div key={m.id} className="rounded-lg border border-border bg-surface p-4">
            <p className="font-mono text-xs text-text-secondary">
              {new Date(m.kickoffAt).toLocaleString('it-IT', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Rome',
              })}
            </p>
            <p className="mt-1 font-display text-sm">
              {m.homeTeam} vs {m.awayTeam}
            </p>
            <div className="mt-2 flex gap-2">
              {(['home', 'draw', 'away'] as const).map((outcome) => {
                const best = bestOdds(m.bookmakerOdds, outcome)
                const selected = selections[m.id] === outcome
                return (
                  <button
                    key={outcome}
                    onClick={() => toggle(m.id, outcome)}
                    disabled={best == null}
                    className={`flex-1 rounded-md border px-2 py-2 font-mono text-xs transition-colors disabled:opacity-30 ${
                      selected
                        ? 'border-accent-pitch bg-accent-pitch text-bg'
                        : 'border-border text-text-primary hover:bg-surface-hover'
                    }`}
                  >
                    {outcome === 'home' ? '1' : outcome === 'draw' ? 'X' : '2'}
                    {best != null && <span className="ml-1">{best.toFixed(2)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(selections).length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 font-mono text-xs">
            <span className="text-text-secondary">Miglior combinazione teorica</span>
            <span className="text-accent-gold">{summary.theoreticalTotal.toFixed(2)}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-text-secondary">
            somma delle quote migliori per selezione, anche su bookmaker diversi — solo benchmark,
            non giocabile realmente.
          </p>

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-border pt-4 font-mono text-xs">
            <span className="text-text-secondary">Miglior schedina realmente giocabile</span>
            <span className="text-accent-pitch">
              {summary.playable ? `${summary.playable.total.toFixed(2)} (${summary.playable.bookmakerName})` : 'non disponibile'}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-text-secondary">
            {summary.playable
              ? 'stesso bookmaker per tutte le selezioni — quella su cui potresti agire davvero.'
              : 'nessun singolo bookmaker copre tutte le selezioni fatte con quote disponibili.'}
          </p>

          <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
            <label className="font-mono text-xs text-text-secondary" htmlFor="stake">
              Puntata (opzionale)
            </label>
            <input
              id="stake"
              type="number"
              min="0"
              step="0.01"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-24 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-accent-pitch"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!summary.playable || status === 'saving'}
            className="mt-4 rounded-md bg-accent-pitch px-4 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === 'saving' ? 'Salvataggio…' : 'Salva schedina'}
          </button>
          {status === 'saved' && <p className="mt-2 font-mono text-xs text-accent-pitch">Salvata.</p>}
          {status === 'error' && <p className="mt-2 font-mono text-xs text-accent-danger">{errorMsg}</p>}
        </div>
      )}
    </div>
  )
}

function bestOdds(byBookmaker: Record<string, BookmakerOdds>, outcome: Outcome): number | null {
  let best: number | null = null
  for (const odds of Object.values(byBookmaker)) {
    const v = odds[outcome]
    if (v != null && (best == null || v > best)) best = v
  }
  return best
}

function computeSummary(matches: MatchOption[], selections: Selections) {
  const selectedMatches = matches.filter((m) => selections[m.id])

  let theoreticalTotal = 1
  for (const m of selectedMatches) {
    const outcome = selections[m.id]
    const best = bestOdds(m.bookmakerOdds, outcome)
    theoreticalTotal *= best ?? 1
  }

  // Miglior schedina giocabile: un bookmaker che copra TUTTE le selezioni.
  const allBookmakerNames = new Set<string>()
  for (const m of selectedMatches) for (const name of Object.keys(m.bookmakerOdds)) allBookmakerNames.add(name)

  let playable: { bookmakerName: string; total: number; legs: { matchId: number; outcome: Outcome; odds: number }[] } | null = null

  for (const bookmakerName of allBookmakerNames) {
    let total = 1
    let coversAll = true
    const legs: { matchId: number; outcome: Outcome; odds: number }[] = []

    for (const m of selectedMatches) {
      const outcome = selections[m.id]
      const odds = m.bookmakerOdds[bookmakerName]?.[outcome]
      if (odds == null) {
        coversAll = false
        break
      }
      total *= odds
      legs.push({ matchId: m.id, outcome, odds })
    }

    if (coversAll && (!playable || total > playable.total)) {
      playable = { bookmakerName, total, legs }
    }
  }

  return { theoreticalTotal, playable }
}
