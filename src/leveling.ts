// XP, levels, and per-level stat bumps. JS source of truth for the client;
// the backend RPC mirrors the level thresholds via a CASE expression so
// xp -> level always agrees regardless of where it's computed.

import type { CharacterStats } from './character'

export const LEVEL_CAP = 10

// Total XP required to reach each level (index = level - 1).
// Curve: 50 * N * (N-1) for level N.
//   L1: 0   L2: 100   L3: 300   L4: 600   L5: 1000
//   L6: 1500   L7: 2100   L8: 2800   L9: 3600   L10: 4500
export const LEVEL_THRESHOLDS: ReadonlyArray<number> = [
  0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500,
]

export function levelForXp(xp: number): number {
  for (let lvl = LEVEL_CAP; lvl >= 1; lvl--) {
    if (xp >= LEVEL_THRESHOLDS[lvl - 1]) return lvl
  }
  return 1
}

// Returns how many XP are needed to reach the next level, or null at cap.
export function xpToNextLevel(xp: number): number | null {
  const lvl = levelForXp(xp)
  if (lvl >= LEVEL_CAP) return null
  return LEVEL_THRESHOLDS[lvl] - xp
}

// Per-level baseline stats. Each level from L2 onward bumps one stat,
// rotating through maxHp -> vision -> toughness -> maxMp.
//   L1: 5/4/2/0   L2: +1 maxHp   L3: +1 vision   L4: +1 toughness   L5: +1 maxMp
//   L6: +1 maxHp   L7: +1 vision   L8: +1 toughness   L9: +1 maxMp
//   L10: +1 maxHp
export function statsForLevel(level: number): CharacterStats {
  const lvl = Math.max(1, Math.min(LEVEL_CAP, level))
  let maxHp = 5
  let maxMp = 4
  let vision = 2
  let toughness = 0
  for (let l = 2; l <= lvl; l++) {
    const i = (l - 2) % 4
    if (i === 0) maxHp += 1
    else if (i === 1) vision += 1
    else if (i === 2) toughness += 1
    else maxMp += 1
  }
  return { maxHp, hp: maxHp, maxMp, vision, toughness }
}

// XP awarded for a run. Wins reward speed + exploration + a "pristine"
// bonus for finishing at full HP. Deaths get a small consolation so the
// progression bar moves even on bad runs.
export function awardXp(opts: {
  outcome: 'win' | 'death'
  turns: number
  tilesExplored: number
  totalTiles: number
  hpAtEnd: number
  maxHp: number
}): number {
  if (opts.outcome === 'win') {
    const parTurns = Math.max(1, Math.ceil(opts.totalTiles / 4))
    const speedBonus = Math.max(0, parTurns - opts.turns) * 5
    const pristine = opts.hpAtEnd >= opts.maxHp ? 25 : 0
    return 50 + speedBonus + opts.tilesExplored + pristine
  }
  return 10 + Math.floor(opts.tilesExplored / 4)
}
