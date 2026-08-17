'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { inviteUser, updateUserRole, deleteUser } from './actions'

type Profile = { id: string; email: string; role: string; created_at: string }

export default function UsersManager({ users, currentUserId }: { users: Profile[]; currentUserId: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const router = useRouter()

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const res = await inviteUser(email)
    if ('error' in res && res.error) {
      setStatus('error')
      setMessage(res.error)
    } else {
      setStatus('idle')
      setMessage(`Invito inviato a ${email}`)
      setEmail('')
      router.refresh()
    }
  }

  async function handleRoleChange(userId: string, role: 'admin' | 'user') {
    await updateUserRole(userId, role)
    router.refresh()
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Eliminare ${email}? Utile se l'invito è andato perso — potrai reinvitarlo subito dopo.`)) return
    const res = await deleteUser(userId)
    if ('error' in res && res.error) {
      setMessage(res.error)
      setStatus('error')
    } else {
      router.refresh()
    }
  }

  return (
    <div className="mt-6">
      <form onSubmit={handleInvite} className="rounded-lg border border-border bg-surface p-4">
        <label htmlFor="email" className="font-mono text-xs text-text-secondary">
          Invita nuovo utente
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@esempio.it"
            className="flex-1 rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent-pitch"
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="rounded-md bg-accent-pitch px-4 py-2 font-display text-sm text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status === 'loading' ? 'Invio…' : 'Invita'}
          </button>
        </div>
        {message && (
          <p className={`mt-2 font-mono text-xs ${status === 'error' ? 'text-accent-danger' : 'text-accent-pitch'}`}>
            {message}
          </p>
        )}
      </form>

      <div className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="break-all font-mono text-sm">{u.email}</p>
              <p className="font-mono text-[10px] text-text-secondary">
                dal {new Date(u.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}
                {u.id === currentUserId && ' · tu'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={u.role}
                disabled={u.id === currentUserId}
                onChange={(e) => handleRoleChange(u.id, e.target.value as 'admin' | 'user')}
                className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-accent-pitch disabled:opacity-50"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              {u.id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => handleDelete(u.id, u.email)}
                  className="rounded-md border border-accent-danger/40 px-2 py-1 font-mono text-xs text-accent-danger hover:bg-accent-danger/10"
                >
                  elimina
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-xs text-text-secondary">
        Non puoi cambiare il tuo stesso ruolo da qui (per evitare di toglierti l&apos;accesso admin per
        errore).
      </p>
    </div>
  )
}
