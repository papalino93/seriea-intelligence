'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-text-primary">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
          Serie A Intelligence
        </p>
        <h1 className="mt-2 font-display text-2xl">Accedi</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Accesso riservato. Se non hai ancora ricevuto un invito, chiedilo all&apos;admin.
        </p>

        <label htmlFor="email" className="mt-6 block font-mono text-xs text-text-secondary">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent-pitch"
          placeholder="tu@esempio.it"
        />

        <button
          type="submit"
          disabled={status === 'sending'}
          className="mt-4 w-full rounded-md bg-accent-pitch px-3 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === 'sending' ? 'Invio link…' : 'Invia link di accesso'}
        </button>

        {status === 'sent' && (
          <p className="mt-4 font-mono text-xs text-accent-pitch">
            Controlla la tua email per il link di accesso.
          </p>
        )}
        {status === 'error' && (
          <p className="mt-4 font-mono text-xs text-accent-danger">
            Qualcosa è andato storto. Riprova o contatta l&apos;admin.
          </p>
        )}
      </form>
    </main>
  )
}
