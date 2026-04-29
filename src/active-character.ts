// Backend-aware character API. Falls back to localStorage when Supabase is
// not configured or backend calls fail, so the offline experience matches.

import {
  loadLocalCharacter,
  saveLocalCharacter,
  makeCharacter,
  type Character,
} from './character'
import { levelForXp } from './leveling'
import { isBackendConfigured } from './services/supabase'
import {
  getActiveBackendCharacter,
  createBackendCharacter,
  applyRunOutcomeBackend,
  claimLegaciesBackend,
  listCharacters,
} from './services/characters'

export interface RunOutcomePayload {
  outcome: 'win' | 'death'
  totalMoves: number
  tilesExplored: number
  deathBiome: string | null
  beastKills: number
  banditKills: number
  xpAward: number
}

export async function getActiveCharacter(): Promise<Character | null> {
  if (isBackendConfigured()) {
    const backend = await getActiveBackendCharacter()
    if (backend) return backend
  }
  return loadLocalCharacter()
}

export async function createActiveCharacter(input: {
  name: string
  color: number
}): Promise<Character | null> {
  if (isBackendConfigured()) {
    const created = await createBackendCharacter(input)
    if (created) return created
    // If the backend was reachable but creation failed, return null so the
    // caller can surface the error rather than silently writing to local.
    return null
  }
  const local = makeCharacter(input)
  saveLocalCharacter(local)
  return local
}

// Apply a run's outcome to the persistent character. Backend goes through
// the RPC for atomic updates; offline we mutate the localStorage copy.
// Returns the updated character so callers can render fresh aggregates.
export async function applyRunToActive(
  character: Character,
  run: RunOutcomePayload,
): Promise<Character> {
  if (isBackendConfigured()) {
    await applyRunOutcomeBackend({
      characterId: character.id,
      outcome: run.outcome,
      totalMoves: run.totalMoves,
      tilesExplored: run.tilesExplored,
      deathBiome: run.deathBiome,
      beastKills: run.beastKills,
      banditKills: run.banditKills,
      xpAward: run.xpAward,
    })
    // Refetch so the UI shows server-of-record values (handles concurrent
    // updates and the streak math in the RPC).
    const list = await listCharacters()
    const refreshed = list.find((c) => c.id === character.id)
    if (refreshed) return refreshed
    // Fall through to local apply as a last-resort projection.
  }
  const next = applyRunLocally(character, run)
  saveLocalCharacter(next)
  return next
}

// Append newly-earned legacy ids to the persistent character.
// Returns the updated character.
export async function claimLegacies(
  character: Character,
  legacyIds: string[],
): Promise<Character> {
  if (legacyIds.length === 0) return character
  if (isBackendConfigured()) {
    await claimLegaciesBackend({ characterId: character.id, legacyIds })
    const list = await listCharacters()
    const refreshed = list.find((c) => c.id === character.id)
    if (refreshed) return refreshed
  }
  const seen = new Set(character.earnedLegacies)
  const next: Character = {
    ...character,
    earnedLegacies: [...character.earnedLegacies],
  }
  for (const id of legacyIds) {
    if (!seen.has(id)) {
      next.earnedLegacies.push(id)
      seen.add(id)
    }
  }
  saveLocalCharacter(next)
  return next
}

function applyRunLocally(c: Character, run: RunOutcomePayload): Character {
  const next: Character = {
    ...c,
    biomeDeaths: { ...c.biomeDeaths },
    encounterKills: { ...c.encounterKills },
    earnedLegacies: [...c.earnedLegacies],
  }
  next.totalRuns += 1
  next.totalMoves += run.totalMoves
  next.totalTiles += run.tilesExplored
  next.encounterKills.beast += run.beastKills
  next.encounterKills.bandit += run.banditKills
  next.xp = c.xp + Math.max(0, run.xpAward)
  next.level = levelForXp(next.xp)

  if (run.outcome === 'win') {
    next.totalWins += 1
    next.currentStreak += 1
    next.longestStreak = Math.max(next.longestStreak, next.currentStreak)
  } else {
    next.totalDeaths += 1
    next.currentStreak = 0
    if (run.deathBiome) {
      next.biomeDeaths[run.deathBiome] = (next.biomeDeaths[run.deathBiome] ?? 0) + 1
    }
  }
  return next
}
