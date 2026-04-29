import { createNoise2D } from 'simplex-noise'

// ---- types -----------------------------------------------------------------

export type TileType =
  | 'plains'
  | 'sand'
  | 'forest'
  | 'hills'
  | 'swamp'
  | 'water'
  | 'mountain'
  | 'shrine'

export interface MapCoord {
  q: number
  r: number
}

export interface Encounter {
  name: string
  power: number // raw damage before toughness mitigation
  kind: 'beast' | 'bandit'
}

export interface GeneratedWorld {
  tiles: Map<string, TileType>
  start: MapCoord
  goal: MapCoord
  encounters: Map<string, Encounter>
}

// Anything with a non-finite cost is impassable.
export const TILE_COST: Record<TileType, number> = {
  plains: 1,
  sand: 1,
  forest: 2,
  hills: 2,
  swamp: 2,
  shrine: 1,
  water: Number.POSITIVE_INFINITY,
  mountain: Number.POSITIVE_INFINITY,
}

export const TILE_COLORS: Record<TileType, number> = {
  plains: 0x7fb069,
  sand: 0xe6c98a,
  forest: 0x2f6b3b,
  hills: 0xa68a64,
  swamp: 0x4a5b3a,
  water: 0x2f78bf,
  mountain: 0x6d6e75,
  shrine: 0xfff3b0,
}

// HP damage taken when entering a hazardous tile. Tiles not listed here
// cost no HP. The shrine heals separately (handled by scene logic).
export const HAZARD_HP_COST: Partial<Record<TileType, number>> = {
  swamp: 1,
}

export function hazardHpCost(t: TileType): number {
  return HAZARD_HP_COST[t] ?? 0
}

// Human-readable label for HUD / log lines.
export const TILE_LABEL: Record<TileType, string> = {
  plains: 'plains',
  sand: 'sand',
  forest: 'forest',
  hills: 'hills',
  swamp: 'swamp',
  water: 'water',
  mountain: 'mountain',
  shrine: 'shrine',
}

export function isImpassable(t: TileType): boolean {
  return !Number.isFinite(TILE_COST[t])
}

export function key(q: number, r: number): string {
  return `${q},${r}`
}

// Pointy/flat-top axial neighbour offsets — same six directions either way.
export const HEX_NEIGHBOR_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
]

// ---- PRNG ------------------------------------------------------------------

// mulberry32: small, fast, deterministic 32-bit PRNG. Good enough for terrain
// and gameplay rolls; not cryptographic.
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = t
    r = Math.imul(r ^ (r >>> 15), r | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a hash for turning string seeds into 32-bit numbers.
export function stringToSeed(s: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---- biome assignment ------------------------------------------------------

interface BiomeInputHex {
  q: number
  r: number
  x: number
  y: number
}

function biomeFromNoise(elev: number, moist: number): TileType {
  if (elev < 0.32) return 'water'
  if (elev > 0.8) return 'mountain'
  if (elev > 0.66) return 'hills'
  // Wet flatlands just above sea level become swamp (a passable hazard).
  if (elev < 0.42 && moist > 0.55) return 'swamp'
  if (moist > 0.62) return 'forest'
  if (moist < 0.32) return 'sand'
  return 'plains'
}

// Sample two simplex-noise channels (elevation + moisture) at each hex's
// pixel centre and assign a biome. Using pixel coords keeps the result
// tied to the visible layout regardless of axial-vs-offset choices.
export function assignBiomes(
  hexes: Iterable<BiomeInputHex>,
  seed: string,
): Map<string, TileType> {
  const rng = mulberry32(stringToSeed(seed))
  const elevNoise = createNoise2D(rng)
  const moistNoise = createNoise2D(rng)

  // Frequencies are tuned for HEX_SIZE ~26 to give 2-3 noticeable landmasses
  // on an 18x12 map.
  const elevFreq = 0.03
  const moistFreq = 0.045

  const tiles = new Map<string, TileType>()
  for (const hex of hexes) {
    const elev = (elevNoise(hex.x * elevFreq, hex.y * elevFreq) + 1) / 2
    const moist = (moistNoise(hex.x * moistFreq, hex.y * moistFreq) + 1) / 2
    tiles.set(key(hex.q, hex.r), biomeFromNoise(elev, moist))
  }
  return tiles
}

// ---- start / goal selection ------------------------------------------------

// Find the largest connected passable region, then pick a top-left-ish spawn
// in it and the most-distant tile (by Dijkstra cost) as the goal shrine.
export function chooseStartAndGoal(
  tiles: Map<string, TileType>,
): { start: MapCoord; goal: MapCoord } | null {
  // 1. Largest connected component of passable tiles.
  const seen = new Set<string>()
  let best: string[] = []
  for (const [k, t] of tiles) {
    if (seen.has(k) || isImpassable(t)) continue
    const region: string[] = []
    const stack: string[] = [k]
    seen.add(k)
    while (stack.length > 0) {
      const cur = stack.pop()!
      region.push(cur)
      const [cqs, crs] = cur.split(',')
      const cq = +cqs
      const cr = +crs
      for (const [dq, dr] of HEX_NEIGHBOR_DIRS) {
        const nk = key(cq + dq, cr + dr)
        if (seen.has(nk)) continue
        const nt = tiles.get(nk)
        if (!nt || isImpassable(nt)) continue
        seen.add(nk)
        stack.push(nk)
      }
    }
    if (region.length > best.length) best = region
  }
  if (best.length === 0) return null

  // 2. Spawn = top-left-most tile in the region (smallest r, then smallest q).
  best.sort((a, b) => {
    const [aq, ar] = a.split(',').map(Number)
    const [bq, br] = b.split(',').map(Number)
    if (ar !== br) return ar - br
    return aq - bq
  })
  const startKey = best[0]
  const [startQ, startR] = startKey.split(',').map(Number)
  const start: MapCoord = { q: startQ, r: startR }

  // 3. Dijkstra from spawn over passable tiles, pick the farthest.
  const dist = new Map<string, number>([[startKey, 0]])
  // Naive priority queue: tiny grids make this fine.
  const pq: Array<{ k: string; q: number; r: number; d: number }> = [
    { k: startKey, q: startQ, r: startR, d: 0 },
  ]
  let goalKey = startKey
  let goalDist = 0

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d)
    const cur = pq.shift()!
    if ((dist.get(cur.k) ?? Infinity) < cur.d) continue
    if (cur.d > goalDist) {
      goalDist = cur.d
      goalKey = cur.k
    }
    for (const [dq, dr] of HEX_NEIGHBOR_DIRS) {
      const nq = cur.q + dq
      const nr = cur.r + dr
      const nk = key(nq, nr)
      const nt = tiles.get(nk)
      if (!nt || isImpassable(nt)) continue
      const nd = cur.d + TILE_COST[nt]
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd)
        pq.push({ k: nk, q: nq, r: nr, d: nd })
      }
    }
  }

  const [goalQ, goalR] = goalKey.split(',').map(Number)
  return { start, goal: { q: goalQ, r: goalR } }
}

// ---- encounter generation --------------------------------------------------

const BEASTS: ReadonlyArray<Encounter> = [
  { name: 'A lone wolf', power: 1, kind: 'beast' },
  { name: 'Wolves', power: 2, kind: 'beast' },
  { name: 'A bear', power: 2, kind: 'beast' },
  { name: 'A wild boar', power: 1, kind: 'beast' },
]

const BANDITS: ReadonlyArray<Encounter> = [
  { name: 'Bandits', power: 1, kind: 'bandit' },
  { name: 'Highway robbers', power: 2, kind: 'bandit' },
  { name: 'A road brigand', power: 1, kind: 'bandit' },
]

function pick<T>(arr: ReadonlyArray<T>, rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

function rollEncounter(type: TileType, rng: () => number): Encounter | null {
  const roll = rng()
  switch (type) {
    case 'forest':
      return roll < 0.3 ? pick(BEASTS, rng) : null
    case 'hills':
      return roll < 0.25 ? pick(BEASTS, rng) : null
    case 'plains':
      return roll < 0.15 ? pick(BANDITS, rng) : null
    case 'sand':
      return roll < 0.15 ? pick(BANDITS, rng) : null
    default:
      return null
  }
}

// Convenience wrapper: generate biomes for a grid, pick start/goal, mark the
// goal tile as a shrine, roll encounters, and return the world.
export function generateWorld(
  hexes: Iterable<BiomeInputHex>,
  seed: string,
): GeneratedWorld {
  const tiles = assignBiomes(hexes, seed)
  const sg = chooseStartAndGoal(tiles)
  if (!sg) {
    // Defensive fallback: turn every tile into plains. Should be unreachable
    // for non-degenerate maps but lets the game keep running.
    for (const k of tiles.keys()) tiles.set(k, 'plains')
    const first = tiles.keys().next().value as string | undefined
    if (!first) {
      throw new Error('generateWorld: empty hex set')
    }
    const [fq, fr] = first.split(',').map(Number)
    return {
      tiles,
      start: { q: fq, r: fr },
      goal: { q: fq, r: fr },
      encounters: new Map(),
    }
  }
  tiles.set(key(sg.goal.q, sg.goal.r), 'shrine')

  // Pre-roll encounters with a derived seed so they're deterministic per
  // map but independent of biome generation.
  const encRng = mulberry32(stringToSeed(seed + ':encounters'))
  const encounters = new Map<string, Encounter>()
  const startKey = key(sg.start.q, sg.start.r)
  const goalKey = key(sg.goal.q, sg.goal.r)
  // Iterate in deterministic order so the rng sequence is stable.
  const sortedKeys = Array.from(tiles.keys()).sort()
  for (const k of sortedKeys) {
    if (k === startKey || k === goalKey) continue
    const t = tiles.get(k)
    if (!t) continue
    const enc = rollEncounter(t, encRng)
    if (enc) encounters.set(k, enc)
  }

  return { tiles, start: sg.start, goal: sg.goal, encounters }
}

// ---- gameplay pathfinding --------------------------------------------------

// Dijkstra returning total MP cost from `from` to `to`, or null if
// unreachable. Cost of entering a tile = TILE_COST[tile.type]. The starting
// tile contributes 0.
export function shortestPathCost(
  tiles: Map<string, TileType>,
  from: MapCoord,
  to: MapCoord,
): number | null {
  const fromKey = key(from.q, from.r)
  const toKey = key(to.q, to.r)
  if (fromKey === toKey) return 0

  const dist = new Map<string, number>([[fromKey, 0]])
  const pq: Array<{ k: string; q: number; r: number; d: number }> = [
    { k: fromKey, q: from.q, r: from.r, d: 0 },
  ]

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d)
    const cur = pq.shift()!
    if (cur.k === toKey) return cur.d
    if ((dist.get(cur.k) ?? Infinity) < cur.d) continue
    for (const [dq, dr] of HEX_NEIGHBOR_DIRS) {
      const nq = cur.q + dq
      const nr = cur.r + dr
      const nk = key(nq, nr)
      const nt = tiles.get(nk)
      if (!nt) continue
      if (isImpassable(nt)) continue
      const nd = cur.d + TILE_COST[nt]
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd)
        pq.push({ k: nk, q: nq, r: nr, d: nd })
      }
    }
  }
  return null
}
