'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleSync() {
    setStatus('loading')
    try {
      // Nessun secret in questa chiamata: /api/sync verifica la sessione
      // dell'utente loggato (cookie same-origin) e controlla che il ruolo
      // sia admin — vedi src/app/api/sync/route.ts.
      const res = await fetch('/api/sync', { method: 'POST' })
      const json = await res.json()
      setStatus(res.ok ? 'done' : 'error')
      setMessage(res.ok ? `${json.matches} partite sincronizzate` : json.error ?? 'errore')
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
        className="mt-4 rounded-md bg-accent-pitch px-4 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === 'loading' ? 'Sincronizzazione…' : 'Aggiorna calendario'}
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
