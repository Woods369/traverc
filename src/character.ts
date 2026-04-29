// Character data model. Stats live here so they can be tweaked by future
// upgrades / blessings / classes without touching the scene.

import { mulberry32, stringToSeed } from './world'

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
  stats: CharacterStats
}

export const DEFAULT_STATS: CharacterStats = {
  maxHp: 5,
  hp: 5,
  maxMp: 4,
  vision: 2,
  toughness: 0,
}

// Three colours unlocked from the start; the rest unlock by milestones.
export const STARTING_COLORS: ReadonlyArray<{ value: number; name: string }> = [
  { value: 0xffeb3b, name: 'Sun' },
  { value: 0x6ec1e4, name: 'Sky' },
  { value: 0xf06292, name: 'Rose' },
]

export function makeCharacter(name: string, color: number): Character {
  return {
    id: randomId(),
    name: (name.trim() || 'Pilgrim').slice(0, 24),
    color,
    stats: { ...DEFAULT_STATS },
  }
}

function randomId(): string {
  const rng = mulberry32(stringToSeed(`${Date.now()}-${Math.random()}`))
  let s = ''
  for (let i = 0; i < 8; i++) s += Math.floor(rng() * 36).toString(36)
  return s
}
