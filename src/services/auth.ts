import { getSupabase } from './supabase'

// We cache the player record per page-load to avoid round-trips.
let cachedPlayer: PlayerRecord | null = null

export interface PlayerRecord {
  id: string
  authUserId: string
  displayName: string
  totalRuns: number
  totalWins: number
  currentStreak: number
  longestStreak: number
}

// Ensure the user has an anonymous Supabase session and a corresponding row
// in `players`. Returns null if Supabase isn't configured.
export async function ensurePlayer(initialName: string): Promise<PlayerRecord | null> {
  if (cachedPlayer) return cachedPlayer
  const sb = getSupabase()
  if (!sb) return null

  // 1. Anonymous sign-in if there's no session.
  const { data: sessionData } = await sb.auth.getSession()
  let authUserId = sessionData.session?.user.id
  if (!authUserId) {
    const { data, error } = await sb.auth.signInAnonymously()
    if (error || !data.user) {
      console.warn('[traverc/auth] anonymous sign-in failed:', error)
      return null
    }
    authUserId = data.user.id
  }

  // 2. Look up existing player row for this auth user.
  const { data: existing, error: lookupErr } = await sb
    .from('players')
    .select('id, auth_user_id, display_name, total_runs, total_wins, current_streak, longest_streak')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (lookupErr) {
    console.warn('[traverc/auth] player lookup failed:', lookupErr)
    return null
  }

  if (existing) {
    cachedPlayer = mapPlayer(existing)
    return cachedPlayer
  }

  // 3. Insert if missing.
  const safeName = initialName.trim().slice(0, 24) || 'Pilgrim'
  const { data: inserted, error: insertErr } = await sb
    .from('players')
    .insert({ auth_user_id: authUserId, display_name: safeName })
    .select('id, auth_user_id, display_name, total_runs, total_wins, current_streak, longest_streak')
    .single()

  if (insertErr || !inserted) {
    console.warn('[traverc/auth] player insert failed:', insertErr)
    return null
  }

  cachedPlayer = mapPlayer(inserted)
  return cachedPlayer
}

export async function updateDisplayName(name: string): Promise<void> {
  const sb = getSupabase()
  if (!sb || !cachedPlayer) return
  const safe = name.trim().slice(0, 24) || 'Pilgrim'
  const { error } = await sb
    .from('players')
    .update({ display_name: safe })
    .eq('id', cachedPlayer.id)
  if (error) {
    console.warn('[traverc/auth] display name update failed:', error)
    return
  }
  cachedPlayer = { ...cachedPlayer, displayName: safe }
}

// Optional magic-link upgrade. Anonymous user is preserved; this links an
// email so the player can sign back in across devices.
export async function upgradeToEmail(email: string): Promise<{ ok: boolean; message: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, message: 'Backend not configured.' }
  const { error } = await sb.auth.updateUser({ email })
  if (error) return { ok: false, message: error.message }
  return { ok: true, message: 'Check your inbox for a confirmation link.' }
}

export function getCachedPlayer(): PlayerRecord | null {
  return cachedPlayer
}

interface DbPlayer {
  id: string
  auth_user_id: string
  display_name: string
  total_runs: number
  total_wins: number
  current_streak: number
  longest_streak: number
}

function mapPlayer(p: DbPlayer): PlayerRecord {
  return {
    id: p.id,
    authUserId: p.auth_user_id,
    displayName: p.display_name,
    totalRuns: p.total_runs,
    totalWins: p.total_wins,
    currentStreak: p.current_streak,
    longestStreak: p.longest_streak,
  }
}
