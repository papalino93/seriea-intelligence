'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'email' | 'code'
type Status = 'idle' | 'loading' | 'error'

export default function LoginPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const router = useRouter()

  async function handleSendCode(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Niente self-signup: solo utenti già invitati da admin possono ricevere il codice.
      options: { shouldCreateUser: false },
    })
    if (error) {
      setStatus('error')
      return
    }
    setStatus('idle')
    setStep('code')
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) {
      setStatus('error')
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 text-text-primary">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-secondary">
          Serie A Intelligence
        </p>
        <h1 className="mt-2 font-display text-2xl">Accedi</h1>

        {step === 'email' && (
          <form onSubmit={handleSendCode}>
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
              disabled={status === 'loading'}
              className="mt-4 w-full rounded-md bg-accent-pitch px-3 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === 'loading' ? 'Invio codice…' : 'Invia codice di accesso'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode}>
            <p className="mt-1 text-sm text-text-secondary">
              Codice inviato a <span className="text-text-primary">{email}</span>. Inseriscilo qui
              sotto.
            </p>

            <label htmlFor="code" className="mt-6 block font-mono text-xs text-text-secondary">
              Codice ricevuto via email
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-accent-pitch"
              placeholder="00000000"
            />

            <button
              type="submit"
              disabled={status === 'loading'}
              className="mt-4 w-full rounded-md bg-accent-pitch px-3 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === 'loading' ? 'Verifica…' : 'Accedi'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setStatus('idle')
              }}
              className="mt-3 w-full font-mono text-xs text-text-secondary underline"
            >
              usa un&apos;altra email
            </button>
          </form>
        )}

        {status === 'error' && (
          <p className="mt-4 font-mono text-xs text-accent-danger">
            Qualcosa è andato storto. Riprova o contatta l&apos;admin.
          </p>
        )}
      </div>
    </main>
  )
}
