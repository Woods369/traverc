// Legacies (achievements). The registry is loaded from JSON so non-coders
// can add entries without touching TS. Each entry's win condition is a
// declarative predicate evaluated after every run.
//
// To author legacies, edit `src/legacies/entries.json`.
// See `src/legacies/entries.example.json` for the schema + worked examples.

import entries from './legacies/entries.json'
import type { Character } from './character'

export interface LegacyContext {
  // Snapshot of the character with this run's outcome already applied.
  updated: Character
  // Per-run information.
  outcome: 'win' | 'death'
  turns: number
  totalMoves: number
  beastKills: number
  banditKills: number
  deathBiome: string | null
  tilesExplored: number
  totalTiles: number
  hpAtEnd: number
  maxHp: number
}

export type LegacyPredicate =
  | { kind: 'totalWins'; gte: number }
  | { kind: 'totalRuns'; gte: number }
  | { kind: 'totalDeaths'; gte: number }
  | { kind: 'totalTiles'; gte: number }
  | { kind: 'totalMoves'; gte: number }
  | { kind: 'longestStreak'; gte: number }
  | { kind: 'beastKills'; gte: number }
  | { kind: 'banditKills'; gte: number }
  | { kind: 'biomeDeaths'; biome: string; gte: number }
  | { kind: 'level'; gte: number }
  | { kind: 'thisRunWin' }
  | { kind: 'thisRunDeath' }
  | { kind: 'thisRunWinAtFullHp' }
  | { kind: 'thisRunWinAtHp1' }
  | { kind: 'thisRunFullExploration' }
  | { kind: 'thisRunMaxTurns'; lte: number }
  | { kind: 'all'; preds: LegacyPredicate[] }
  | { kind: 'any'; preds: LegacyPredicate[] }

export interface Legacy {
  id: string
  title: string
  flavor: string // shown when earned
  hint: string // shown when locked
  predicate: LegacyPredicate
}

// Validate + coerce loaded JSON. Bad entries are skipped with a warning so
// the rest of the registry keeps working.
function loadRegistry(): Legacy[] {
  const raw = entries as unknown
  if (!Array.isArray(raw)) {
    console.warn('[traverc/legacies] entries.json is not an array; ignoring')
    return []
  }
  const seen = new Set<string>()
  const out: Legacy[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    const title = typeof r.title === 'string' ? r.title : null
    const flavor = typeof r.flavor === 'string' ? r.flavor : null
    const hint = typeof r.hint === 'string' ? r.hint : null
    const pred = r.predicate as LegacyPredicate | undefined
    if (!id || !title || !flavor || !hint || !pred) {
      console.warn('[traverc/legacies] skipping invalid entry:', r)
      continue
    }
    if (seen.has(id)) {
      console.warn(`[traverc/legacies] duplicate id "${id}" skipped`)
      continue
    }
    seen.add(id)
    out.push({ id, title, flavor, hint, predicate: pred })
  }
  return out
}

export const LEGACIES: ReadonlyArray<Legacy> = loadRegistry()

export function evaluatePredicate(p: LegacyPredicate, ctx: LegacyContext): boolean {
  const c = ctx.updated
  switch (p.kind) {
    case 'totalWins':
      return c.totalWins >= p.gte
    case 'totalRuns':
      return c.totalRuns >= p.gte
    case 'totalDeaths':
      return c.totalDeaths >= p.gte
    case 'totalTiles':
      return c.totalTiles >= p.gte
    case 'totalMoves':
      return c.totalMoves >= p.gte
    case 'longestStreak':
      return c.longestStreak >= p.gte
    case 'beastKills':
      return c.encounterKills.beast >= p.gte
    case 'banditKills':
      return c.encounterKills.bandit >= p.gte
    case 'biomeDeaths':
      return (c.biomeDeaths[p.biome] ?? 0) >= p.gte
    case 'level':
      return c.level >= p.gte
    case 'thisRunWin':
      return ctx.outcome === 'win'
    case 'thisRunDeath':
      return ctx.outcome === 'death'
    case 'thisRunWinAtFullHp':
      return ctx.outcome === 'win' && ctx.hpAtEnd >= ctx.maxHp
    case 'thisRunWinAtHp1':
      return ctx.outcome === 'win' && ctx.hpAtEnd === 1
    case 'thisRunFullExploration':
      return ctx.outcome === 'win' && ctx.tilesExplored >= ctx.totalTiles
    case 'thisRunMaxTurns':
      return ctx.outcome === 'win' && ctx.turns <= p.lte
    case 'all':
      return p.preds.every((sub) => evaluatePredicate(sub, ctx))
    case 'any':
      return p.preds.some((sub) => evaluatePredicate(sub, ctx))
  }
}

// Find legacies whose predicate is now satisfied that aren't already earned.
export function evaluateNewlyEarned(ctx: LegacyContext): Legacy[] {
  const earned = new Set(ctx.updated.earnedLegacies)
  const newly: Legacy[] = []
  for (const legacy of LEGACIES) {
    if (earned.has(legacy.id)) continue
    if (evaluatePredicate(legacy.predicate, ctx)) newly.push(legacy)
  }
  return newly
}

export function findLegacy(id: string): Legacy | undefined {
  return LEGACIES.find((l) => l.id === id)
}
