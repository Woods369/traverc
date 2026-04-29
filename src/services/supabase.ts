import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// We construct the client lazily so the rest of the app can run without any
// backend configured (Tier 0 mode). All service methods check this before
// hitting the network and gracefully fall back.

let client: SupabaseClient | null = null
let initialized = false

export function getSupabase(): SupabaseClient | null {
  if (initialized) return client
  initialized = true

  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    return null
  }
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}

export function isBackendConfigured(): boolean {
  return getSupabase() !== null
}
