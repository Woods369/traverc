import { getSupabase } from './supabase'
import { getCachedPlayer } from './auth'

export interface SubmitRunInput {
  seedDate: string // YYYY-MM-DD
  outcome: 'win' | 'death'
  turns: number
  tilesExplored: number
  totalMoves: number
  beastKills: number
  banditKills: number
  deathBiome?: string | null
  characterId?: string | null
  characterColor: number
  characterName: string
}

export async function submitRun(input: SubmitRunInput): Promise<void> {
  const sb = getSupabase()
  const player = getCachedPlayer()
  if (!sb || !player) return
  const { error } = await sb.from('runs').insert({
    player_id: player.id,
    character_id: input.characterId ?? null,
    seed_date: input.seedDate,
    finished_at: new Date().toISOString(),
    outcome: input.outcome,
    turns: input.turns,
    tiles_explored: input.tilesExplored,
    total_moves: input.totalMoves,
    beast_kills: input.beastKills,
    bandit_kills: input.banditKills,
    death_biome: input.deathBiome ?? null,
    character_color: input.characterColor,
    character_name: input.characterName,
  })
  if (error) {
    console.warn('[traverc/runs] submit failed:', error)
  }
}

export interface LeaderboardEntry {
  characterName: string
  displayName: string
  characterColor: number
  turns: number
  tilesExplored: number
  finishedAt: string
}

// Top wins for a given seed_date (defaults to today on the server side via the
// `leaderboard_today` view). For other dates we query `runs` directly.
export async function getLeaderboard(seedDate: string, limit = 25): Promise<LeaderboardEntry[]> {
  const sb = getSupabase()
  if (!sb) return []
  // Use the today-restricted view if it matches, otherwise hit the table.
  const todayIso = new Date().toISOString().slice(0, 10)
  const useView = seedDate === todayIso
  const builder = useView
    ? sb
        .from('leaderboard_today')
        .select('character_name, display_name, character_color, turns, tiles_explored, finished_at')
        .limit(limit)
    : sb
        .from('runs')
        .select('character_name, character_color, turns, tiles_explored, finished_at, players ( display_name )')
        .eq('seed_date', seedDate)
        .eq('outcome', 'win')
        .order('turns', { ascending: true })
        .order('tiles_explored', { ascending: false })
        .order('finished_at', { ascending: true })
        .limit(limit)

  const { data, error } = await builder
  if (error || !data) {
    if (error) console.warn('[traverc/runs] leaderboard fetch failed:', error)
    return []
  }
  // Normalise both shapes into LeaderboardEntry.
  return (data as Array<Record<string, unknown>>).map((row) => {
    const players = row.players as { display_name?: string } | undefined
    return {
      characterName: String(row.character_name ?? ''),
      displayName: String(row.display_name ?? players?.display_name ?? ''),
      characterColor: Number(row.character_color ?? 0),
      turns: Number(row.turns ?? 0),
      tilesExplored: Number(row.tiles_explored ?? 0),
      finishedAt: String(row.finished_at ?? ''),
    }
  })
}
