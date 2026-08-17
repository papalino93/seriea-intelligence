import { createBrowserClient } from '@supabase/ssr'

// Usato nei Client Component ('use client'). Chiave anon: rispetta sempre le RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
