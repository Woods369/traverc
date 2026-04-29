// Meta-progression: persistent state that survives runs. Stored in
// localStorage so we don't need a backend yet.

import { STARTING_COLORS } from './character'

export interface MetaState {
  unlockedColors: number[]
  totalRuns: number
  totalWins: number
  totalTilesExplored: number
  longestStreak: number
  currentStreak: number
  lastName?: string
}

interface MilestoneColor {
  color: number
  name: string
  winsRequired: number
}

// Unlock thresholds. Order matters only for display.
export const MILESTONE_COLORS: ReadonlyArray<MilestoneColor> = [
  { color: 0x9ccc65, name: 'Moss', winsRequired: 1 },
  { color: 0xffb74d, name: 'Ember', winsRequired: 3 },
  { color: 0xb39ddb, name: 'Lavender', winsRequired: 5 },
  { color: 0xff7575, name: 'Cinder', winsRequired: 8 },
  { color: 0x4dd0e1, name: 'Tide', winsRequired: 12 },
]

const STORAGE_KEY = 'traverc:meta:v1'

const STARTER_COLORS = STARTING_COLORS.map((c) => c.value)

const DEFAULT_META: MetaState = {
  unlockedColors: [...STARTER_COLORS],
  totalRuns: 0,
  totalWins: 0,
  totalTilesExplored: 0,
  longestStreak: 0,
  currentStreak: 0,
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return cloneDefault()
    const parsed = JSON.parse(raw) as Partial<MetaState>
    return {
      ...DEFAULT_META,
      ...parsed,
      // Always guarantee the starter palette is available.
      unlockedColors: Array.from(
        new Set([...STARTER_COLORS, ...(parsed.unlockedColors ?? [])]),
      ),
    }
  } catch {
    return cloneDefault()
  }
}

export function saveMeta(meta: MetaState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  } catch {
    // localStorage may be full or disabled; non-fatal.
  }
}

export interface RunResult {
  outcome: 'win' | 'death'
  tilesExplored: number
  characterName: string
}

export interface MetaUpdate {
  meta: MetaState
  newlyUnlockedColors: number[]
}

export function applyRunResult(meta: MetaState, result: RunResult): MetaUpdate {
  const next: MetaState = {
    ...meta,
    unlockedColors: [...meta.unlockedColors],
  }
  next.totalRuns += 1
  next.totalTilesExplored += result.tilesExplored
  next.lastName = result.characterName

  if (result.outcome === 'win') {
    next.totalWins += 1
    next.currentStreak += 1
    next.longestStreak = Math.max(next.longestStreak, next.currentStreak)
  } else {
    next.currentStreak = 0
  }

  const newlyUnlockedColors: number[] = []
  for (const m of MILESTONE_COLORS) {
    if (next.totalWins >= m.winsRequired && !next.unlockedColors.includes(m.color)) {
      next.unlockedColors.push(m.color)
      newlyUnlockedColors.push(m.color)
    }
  }

  return { meta: next, newlyUnlockedColors }
}

function cloneDefault(): MetaState {
  return { ...DEFAULT_META, unlockedColors: [...STARTER_COLORS] }
}
