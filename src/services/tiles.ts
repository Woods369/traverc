import { getSupabase } from './supabase'
import { getCachedPlayer } from './auth'

export interface TileNote {
  id: string
  q: number
  r: number
  body: string
  displayName: string
  hearts: number
  createdAt: string
}

export interface TileVisitCount {
  q: number
  r: number
  count: number
}

// Tile notes ----------------------------------------------------------------

export async function getNotes(seedDate: string): Promise<TileNote[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from('tile_notes')
    .select('id, q, r, body, hearts, created_at, players ( display_name )')
    .eq('seed_date', seedDate)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error || !data) {
    if (error) console.warn('[traverc/tiles] getNotes failed:', error)
    return []
  }
  return (data as Array<Record<string, unknown>>).map((row) => {
    const players = row.players as { display_name?: string } | undefined
    return {
      id: String(row.id ?? ''),
      q: Number(row.q ?? 0),
      r: Number(row.r ?? 0),
      body: String(row.body ?? ''),
      hearts: Number(row.hearts ?? 0),
      createdAt: String(row.created_at ?? ''),
      displayName: String(players?.display_name ?? 'Anonymous'),
    }
  })
}

export async function postNote(input: {
  seedDate: string
  q: number
  r: number
  body: string
}): Promise<TileNote | null> {
  const sb = getSupabase()
  const player = getCachedPlayer()
  if (!sb || !player) return null
  const trimmed = input.body.trim().slice(0, 140)
  if (!trimmed) return null
  const { data, error } = await sb
    .from('tile_notes')
    .insert({
      seed_date: input.seedDate,
      q: input.q,
      r: input.r,
      player_id: player.id,
      body: trimmed,
    })
    .select('id, q, r, body, hearts, created_at')
    .single()
  if (error || !data) {
    if (error) console.warn('[traverc/tiles] postNote failed:', error)
    return null
  }
  return {
    id: String(data.id),
    q: Number(data.q),
    r: Number(data.r),
    body: String(data.body),
    hearts: Number(data.hearts ?? 0),
    createdAt: String(data.created_at),
    displayName: player.displayName,
  }
}

// Tile visit counts (heatmap) -----------------------------------------------

export async function recordVisit(seedDate: string, q: number, r: number): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const { error } = await sb.rpc('increment_tile_visit', {
    p_seed_date: seedDate,
    p_q: q,
    p_r: r,
  })
  if (error) {
    console.warn('[traverc/tiles] recordVisit failed:', error)
  }
}

export async function getVisitCounts(seedDate: string): Promise<TileVisitCount[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from('tile_visits')
    .select('q, r, count')
    .eq('seed_date', seedDate)
  if (error || !data) {
    if (error) console.warn('[traverc/tiles] getVisitCounts failed:', error)
    return []
  }
  return data.map((row) => ({
    q: Number(row.q ?? 0),
    r: Number(row.r ?? 0),
    count: Number(row.count ?? 0),
  }))
}
