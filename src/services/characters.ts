import { getSupabase } from './supabase'
import { getCachedPlayer } from './auth'
import type { Character } from '../character'

interface DbCharacter {
  id: string
  name: string
  color: number
  level: number
  xp: number
  retired: boolean
  total_runs: number
  total_wins: number
  total_deaths: number
  total_moves: number
  total_tiles: number
  biome_deaths: Record<string, number> | null
  encounter_kills: Record<string, number> | null
  current_streak: number
  longest_streak: number
  earned_legacies: string[] | null
  created_at: string
}

const SELECT_COLUMNS =
  'id, name, color, level, xp, retired, total_runs, total_wins, total_deaths, ' +
  'total_moves, total_tiles, biome_deaths, encounter_kills, current_streak, ' +
  'longest_streak, earned_legacies, created_at'

function fromDb(row: DbCharacter): Character {
  const enc = row.encounter_kills ?? {}
  return {
    id: row.id,
    name: row.name,
    color: Number(row.color),
    level: row.level,
    xp: row.xp,
    retired: Boolean(row.retired),
    totalRuns: row.total_runs,
    totalWins: row.total_wins,
    totalDeaths: row.total_deaths,
    totalMoves: row.total_moves,
    totalTiles: row.total_tiles,
    biomeDeaths: { ...(row.biome_deaths ?? {}) },
    encounterKills: {
      beast: Number(enc.beast ?? 0),
      bandit: Number(enc.bandit ?? 0),
    },
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    earnedLegacies: Array.isArray(row.earned_legacies) ? row.earned_legacies.map(String) : [],
    createdAt: row.created_at,
  }
}

export async function listCharacters(): Promise<Character[]> {
  const sb = getSupabase()
  const player = getCachedPlayer()
  if (!sb || !player) return []
  const { data, error } = await sb
    .from('characters')
    .select(SELECT_COLUMNS)
    .eq('player_id', player.id)
    .order('created_at', { ascending: true })
  if (error || !data) {
    if (error) console.warn('[traverc/characters] list failed:', error)
    return []
  }
  return (data as unknown as DbCharacter[]).map(fromDb)
}

export async function getActiveBackendCharacter(): Promise<Character | null> {
  const list = await listCharacters()
  return list.find((c) => !c.retired) ?? null
}

export async function createBackendCharacter(input: {
  name: string
  color: number
}): Promise<Character | null> {
  const sb = getSupabase()
  const player = getCachedPlayer()
  if (!sb || !player) return null
  const safeName = input.name.trim().slice(0, 24) || 'Pilgrim'
  const { data, error } = await sb
    .from('characters')
    .insert({
      player_id: player.id,
      name: safeName,
      color: input.color,
    })
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) {
    if (error) console.warn('[traverc/characters] create failed:', error)
    return null
  }
  return fromDb(data as unknown as DbCharacter)
}

export async function applyRunOutcomeBackend(input: {
  characterId: string
  outcome: 'win' | 'death'
  totalMoves: number
  tilesExplored: number
  deathBiome: string | null
  beastKills: number
  banditKills: number
}): Promise<void> {
  const sb = getSupabase()
  if (!sb) return
  const { error } = await sb.rpc('apply_run_outcome', {
    p_character_id: input.characterId,
    p_outcome: input.outcome,
    p_total_moves: input.totalMoves,
    p_tiles_explored: input.tilesExplored,
    p_death_biome: input.deathBiome,
    p_beast_kills: input.beastKills,
    p_bandit_kills: input.banditKills,
  })
  if (error) {
    console.warn('[traverc/characters] applyRunOutcome failed:', error)
  }
}
