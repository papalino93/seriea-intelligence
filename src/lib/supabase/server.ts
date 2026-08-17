import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Usato in Server Component e Route Handler. Legge la sessione dai cookie,
// rispetta le RLS come se fosse l'utente loggato — MAI la service role qui.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Chiamato da un Server Component senza possibilità di scrivere cookie:
            // va bene, ci pensa il middleware a rinfrescare la sessione.
          }
        },
      },
    }
  )
}
