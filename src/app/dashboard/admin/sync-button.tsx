'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Variant = 'calendar' | 'odds'

const CONFIG: Record<Variant, { endpoint: string; label: string; loadingLabel: string; formatSuccess: (json: Record<string, unknown>) => string }> = {
  calendar: {
    endpoint: '/api/sync',
    label: 'Aggiorna calendario',
    loadingLabel: 'Sincronizzazione…',
    formatSuccess: (j) => `${j.matches} partite sincronizzate`,
  },
  odds: {
    endpoint: '/api/sync-odds',
    label: 'Aggiorna quote',
    loadingLabel: 'Sincronizzazione…',
    formatSuccess: (j) => `${j.matched} partite con quote aggiornate (${j.unmatchedEvents} eventi non abbinati)`,
  },
}

export default function SyncButton({ variant }: { variant: Variant }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const { endpoint, label, loadingLabel, formatSuccess } = CONFIG[variant]

  async function handleSync() {
    setStatus('loading')
    try {
      // Nessun secret in questa chiamata: la route verifica la sessione
      // dell'utente loggato (cookie same-origin) e controlla che il ruolo sia admin.
      const res = await fetch(endpoint, { method: 'POST' })
      const json = await res.json()
      setStatus(res.ok ? 'done' : 'error')
      setMessage(res.ok ? formatSuccess(json) : (json.error as string) ?? 'errore')
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Errore di rete')
    }
  }

  return (
    <div>
      <button
        onClick={handleSync}
        disabled={status === 'loading'}
        className="mt-4 mr-3 rounded-md bg-accent-pitch px-4 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'loading' ? loadingLabel : label}
      </button>
      {message && (
        <p
          className={`mt-2 font-mono text-xs ${
            status === 'error' ? 'text-accent-danger' : 'text-accent-pitch'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
