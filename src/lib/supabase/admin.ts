import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Usa la service role key: bypassa le RLS. SOLO in Route Handler server-side
// (mai importato in un Client Component, mai esposto al browser).
// Usato da /api/sync dopo aver verificato l'autorizzazione con altri mezzi.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
