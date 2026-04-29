// Persistent character data model. Aggregates accumulate across runs;
// per-run derived stats (HP/MP/etc.) come from `derivedStats(character)`
// which scales them by `character.level` via src/leveling.ts.

import { mulberry32, stringToSeed } from './world'
import { statsForLevel } from './leveling'

export interface CharacterStats {
  maxHp: number
  hp: number
  maxMp: number
  vision: number
  toughness: number
}

export interface Character {
  id: string
  name: string
  color: number // 0xRRGGBB
  level: number
  xp: number
  retired: boolean
  // Lifetime aggregates
  totalRuns: number
  totalWins: number
  totalDeaths: number
  totalMoves: number
  totalTiles: number
  biomeDeaths: Record<string, number>
  encounterKills: { beast: number; bandit: number }
  currentStreak: number
  longestStreak: number
  earnedLegacies: string[]
  // ISO timestamp; useful for sort + display.
  createdAt: string
}

// Per-run starting stats. Scales with the character's level.
export function derivedStats(c: Character): CharacterStats {
  return statsForLevel(c.level)
}

// Three colours unlocked from the start; the rest unlock by milestones.
export const STARTING_COLORS: ReadonlyArray<{ value: number; name: string }> = [
  { value: 0xffeb3b, name: 'Sun' },
  { value: 0x6ec1e4, name: 'Sky' },
  { value: 0xf06292, name: 'Rose' },
]

export function makeCharacter(input: { name: string; color: number }): Character {
  return {
    id: randomId(),
    name: (input.name.trim() || 'Pilgrim').slice(0, 24),
    color: input.color,
    level: 1,
    xp: 0,
    retired: false,
    totalRuns: 0,
    totalWins: 0,
    totalDeaths: 0,
    totalMoves: 0,
    totalTiles: 0,
    biomeDeaths: {},
    encounterKills: { beast: 0, bandit: 0 },
    currentStreak: 0,
    longestStreak: 0,
    earnedLegacies: [],
    createdAt: new Date().toISOString(),
  }
}

// --- localStorage fallback (offline mode) ----------------------------------

const LOCAL_KEY = 'traverc:character:v1'

export function loadLocalCharacter(): Character | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Character>
    if (!parsed || !parsed.id || !parsed.name) return null
    return {
      id: parsed.id,
      name: parsed.name,
      color: Number(parsed.color ?? 0xffeb3b),
      level: Number(parsed.level ?? 1),
      xp: Number(parsed.xp ?? 0),
      retired: Boolean(parsed.retired ?? false),
      totalRuns: Number(parsed.totalRuns ?? 0),
      totalWins: Number(parsed.totalWins ?? 0),
      totalDeaths: Number(parsed.totalDeaths ?? 0),
      totalMoves: Number(parsed.totalMoves ?? 0),
      totalTiles: Number(parsed.totalTiles ?? 0),
      biomeDeaths: { ...(parsed.biomeDeaths ?? {}) },
      encounterKills: {
        beast: Number(parsed.encounterKills?.beast ?? 0),
        bandit: Number(parsed.encounterKills?.bandit ?? 0),
      },
      currentStreak: Number(parsed.currentStreak ?? 0),
      longestStreak: Number(parsed.longestStreak ?? 0),
      earnedLegacies: Array.isArray(parsed.earnedLegacies)
        ? parsed.earnedLegacies.map(String)
        : [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function saveLocalCharacter(c: Character): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(c))
  } catch {
    // localStorage may be full or disabled; non-fatal.
  }
}

export function deleteLocalCharacter(): void {
  try {
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    // ignore
  }
}

// --- helpers ---------------------------------------------------------------

function randomId(): string {
  const rng = mulberry32(stringToSeed(`${Date.now()}-${Math.random()}`))
  let s = ''
  for (let i = 0; i < 12; i++) s += Math.floor(rng() * 36).toString(36)
  return s
}
