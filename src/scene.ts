import * as Phaser from 'phaser'
import { defineHex, Grid, rectangle, Orientation } from 'honeycomb-grid'
import {
  HEX_NEIGHBOR_DIRS,
  TILE_COLORS,
  TILE_COST,
  TILE_LABEL,
  generateWorld,
  hazardHpCost,
  isImpassable,
  key,
  shortestPathCost,
  type Encounter,
  type MapCoord,
  type TileType,
} from './world'
import { showRunEnd } from './overlay'
import { STARTING_COLORS, makeCharacter, type Character } from './character'
import { applyRunResult, loadMeta, MILESTONE_COLORS, saveMeta } from './meta'
import { submitRun } from './services/runs'
import { recordVisit } from './services/tiles'
import { isDailySeed, dateFromDailySeed } from './services/daily'

// ----- tunables ---------------------------------------------------------
const HEX_SIZE = 30
const MAP_COLS = 14
const MAP_ROWS = 9
const PADDING = 36
const LOG_FADE_MS = 2400 // how long combat / hazard log lines linger
const STEP_TWEEN_MS = 130 // unit step animation duration

// Default seed for now; will become date-based / server-served in Tier 1.
const DEFAULT_SEED = `traverc-${Math.floor(Math.random() * 1e9)}`
// ------------------------------------------------------------------------

// Pointy-top hexes: width = sqrt(3) * size, height = 2 * size.
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE
const HEX_HEIGHT = 2 * HEX_SIZE

export const GAME_WIDTH = Math.ceil(HEX_WIDTH * MAP_COLS + HEX_WIDTH / 2 + PADDING * 2)
export const GAME_HEIGHT = Math.ceil((HEX_HEIGHT * 0.75) * (MAP_ROWS - 1) + HEX_HEIGHT + PADDING * 2)

const HexTile = defineHex({
  dimensions: HEX_SIZE,
  orientation: Orientation.POINTY,
})
type HexInstance = InstanceType<typeof HexTile>

type Visibility = 'hidden' | 'explored' | 'visible'

interface TileData {
  type: TileType
  visibility: Visibility
  graphic?: Phaser.GameObjects.Graphics
}

// Cube-coordinate hex distance (for view radius and adjacency).
function hexDistance(a: HexInstance, b: HexInstance): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2
}

export class GameScene extends Phaser.Scene {
  private grid!: Grid<HexInstance>
  private tiles = new Map<string, TileData>()
  private hexByKey = new Map<string, HexInstance>()
  private unitGfx!: Phaser.GameObjects.Graphics
  private goalGfx!: Phaser.GameObjects.Graphics
  private unitHex!: HexInstance
  private goalHex!: HexInstance
  private offsetX = 0
  private offsetY = 0
  private statusText!: Phaser.GameObjects.Text
  private hpPipsGfx!: Phaser.GameObjects.Graphics
  private mpPipsGfx!: Phaser.GameObjects.Graphics
  private turn = 1
  private mp = 4
  private hoverGfx!: Phaser.GameObjects.Graphics
  private hoverText!: Phaser.GameObjects.Text
  private hoveredKey: string | null = null
  private seed = DEFAULT_SEED
  // Character + per-run derived stats.
  private character: Character = makeCharacter('Pilgrim', 0xffeb3b)
  private maxHp = 5
  private maxMp = 4
  private viewRadius = 2
  private toughness = 0
  private seedDate: string | null = null
  private hp = 5
  private runOver = false
  private encounters = new Map<string, Encounter>()
  private visitedKeys = new Set<string>()
  // Phase 1 metrics — feed character stats and legacies later.
  private totalMoves = 0
  private beastKills = 0
  private banditKills = 0
  private deathBiome: TileType | null = null
  private logText!: Phaser.GameObjects.Text
  private logTimer?: Phaser.Time.TimerEvent

  constructor() {
    super('game')
  }

  init(data?: { character?: Character; seed?: string; seedDate?: string }): void {
    if (data?.character) {
      this.character = data.character
    }
    if (data?.seed) {
      this.seed = data.seed
    }
    this.seedDate = data?.seedDate ?? dateFromDailySeed(this.seed)
    const s = this.character.stats
    this.maxHp = s.maxHp
    this.maxMp = s.maxMp
    this.viewRadius = s.vision
    this.toughness = s.toughness
    this.hp = s.hp
    this.mp = s.maxMp
  }

  create() {
    this.grid = new Grid(HexTile, rectangle({ width: MAP_COLS, height: MAP_ROWS }))

    // Compute a render offset so the grid sits within the canvas with padding.
    let minX = Infinity
    let minY = Infinity
    this.grid.forEach((hex) => {
      for (const c of hex.corners) {
        if (c.x < minX) minX = c.x
        if (c.y < minY) minY = c.y
      }
    })
    this.offsetX = PADDING - minX
    this.offsetY = PADDING - minY

    // Index hexes by key for O(1) neighbour / coord lookup.
    this.grid.forEach((hex) => this.hexByKey.set(this.key(hex), hex))

    // Generate the world: biomes + start/goal shrine + encounters.
    const world = generateWorld(this.hexByKey.values(), this.seed)
    for (const [k, type] of world.tiles) {
      this.tiles.set(k, { type, visibility: 'hidden' })
    }
    this.encounters = world.encounters

    const startHex = this.hexByKey.get(key(world.start.q, world.start.r))
    const goalHex = this.hexByKey.get(key(world.goal.q, world.goal.r))
    if (!startHex || !goalHex) {
      throw new Error('scene.create: world generator returned coords outside the grid')
    }
    this.unitHex = startHex
    this.goalHex = goalHex
    // Spawn tile is implicitly "visited" (no encounter on it).
    this.visitedKeys.add(this.key(this.unitHex))

    // Initial draw of all tiles.
    this.grid.forEach((hex) => this.drawHex(hex))

    // Goal marker (sits above the shrine tile, below the unit).
    this.goalGfx = this.add.graphics()
    this.goalGfx.setDepth(7)
    this.drawGoal()

    // Unit. The graphics is drawn at (0,0) and the object is positioned at
    // the hex centre so the whole sprite can be tweened smoothly.
    this.unitGfx = this.add.graphics()
    this.unitGfx.setDepth(10)
    this.drawUnit()
    this.unitGfx.setPosition(
      this.unitHex.x + this.offsetX,
      this.unitHex.y + this.offsetY,
    )

    // Status text (must exist before revealAround, which calls updateStatus).
    this.statusText = this.add.text(8, 8, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#d8d6e0',
    })
    this.statusText.setDepth(20)

    // HP / MP pips in the top-right corner.
    this.hpPipsGfx = this.add.graphics()
    this.hpPipsGfx.setDepth(20)
    this.mpPipsGfx = this.add.graphics()
    this.mpPipsGfx.setDepth(20)

    // Combat / hazard log line, anchored bottom-left of the canvas.
    this.logText = this.add.text(8, GAME_HEIGHT - 22, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffd1d1',
      stroke: '#000000',
      strokeThickness: 2,
    })
    this.logText.setDepth(20)
    this.logText.setAlpha(0)

    // Hover overlay.
    this.hoverGfx = this.add.graphics()
    this.hoverGfx.setDepth(8)
    this.hoverText = this.add.text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    })
    this.hoverText.setOrigin(0.5)
    this.hoverText.setDepth(11)
    this.hoverText.setVisible(false)

    // Reveal starting area.
    this.revealAround(this.unitHex)

    // Input.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const hex = this.grid.pointToHex(
        { x: pointer.x - this.offsetX, y: pointer.y - this.offsetY },
        { allowOutside: false },
      )
      if (hex) this.tryMoveTo(hex)
    })

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const hex = this.grid.pointToHex(
        { x: pointer.x - this.offsetX, y: pointer.y - this.offsetY },
        { allowOutside: false },
      )
      this.updateHover(hex ?? null)
    })

    this.input.on('pointerout', () => this.updateHover(null))

    this.input.keyboard?.on('keydown-SPACE', () => this.endTurn())
    this.input.keyboard?.on('keydown-ENTER', () => this.endTurn())
  }

  // -----------------------------------------------------------------------

  private key(hex: { q: number; r: number }): string {
    return key(hex.q, hex.r)
  }

  private drawHex(hex: HexInstance): void {
    const tile = this.tiles.get(this.key(hex))
    if (!tile) return
    if (tile.graphic) tile.graphic.destroy()

    const g = this.add.graphics()
    const corners = hex.corners.map((c) => ({
      x: c.x + this.offsetX,
      y: c.y + this.offsetY,
    }))

    if (tile.visibility === 'hidden') {
      g.fillStyle(0x05060a, 1)
      g.lineStyle(1, 0x10131c, 1)
    } else {
      const baseColor = TILE_COLORS[tile.type]
      const alpha = tile.visibility === 'visible' ? 1 : 0.4
      g.fillStyle(baseColor, alpha)
      g.lineStyle(1, 0x000000, tile.visibility === 'visible' ? 0.35 : 0.2)
    }

    g.beginPath()
    g.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < corners.length; i++) {
      g.lineTo(corners[i].x, corners[i].y)
    }
    g.closePath()
    g.fillPath()
    g.strokePath()

    tile.graphic = g
  }

  private drawUnit(): void {
    this.unitGfx.clear()
    const r = HEX_SIZE * 0.45
    this.unitGfx.fillStyle(this.character.color, 1)
    this.unitGfx.lineStyle(2, 0x111111, 1)
    this.unitGfx.fillCircle(0, 0, r)
    this.unitGfx.strokeCircle(0, 0, r)
  }

  private animateUnitTo(hex: HexInstance): void {
    const tx = hex.x + this.offsetX
    const ty = hex.y + this.offsetY
    this.tweens.add({
      targets: this.unitGfx,
      x: tx,
      y: ty,
      duration: STEP_TWEEN_MS,
      ease: 'Cubic.Out',
    })
  }

  // Subtle starburst on the shrine so the goal is identifiable when it's in view.
  private drawGoal(): void {
    this.goalGfx.clear()
    const tile = this.tiles.get(this.key(this.goalHex))
    if (!tile || tile.visibility === 'hidden') return // hide the goal until first revealed

    const cx = this.goalHex.x + this.offsetX
    const cy = this.goalHex.y + this.offsetY
    const outer = HEX_SIZE * 0.5
    const inner = HEX_SIZE * 0.18

    this.goalGfx.fillStyle(0xfff3b0, tile.visibility === 'visible' ? 1 : 0.5)
    this.goalGfx.lineStyle(2, 0x8a6c2c, 1)
    this.goalGfx.beginPath()
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4 - Math.PI / 2
      const radius = i % 2 === 0 ? outer : inner
      const px = cx + Math.cos(angle) * radius
      const py = cy + Math.sin(angle) * radius
      if (i === 0) this.goalGfx.moveTo(px, py)
      else this.goalGfx.lineTo(px, py)
    }
    this.goalGfx.closePath()
    this.goalGfx.fillPath()
    this.goalGfx.strokePath()
  }

  private revealAround(center: HexInstance): void {
    // Demote currently visible tiles to explored.
    this.grid.forEach((hex) => {
      const t = this.tiles.get(this.key(hex))
      if (t && t.visibility === 'visible') t.visibility = 'explored'
    })
    // Promote tiles within view radius to visible.
    this.grid.forEach((hex) => {
      if (hexDistance(center, hex) <= this.viewRadius) {
        const t = this.tiles.get(this.key(hex))
        if (t) t.visibility = 'visible'
      }
    })
    this.grid.forEach((hex) => this.drawHex(hex))
    this.drawGoal()
    this.updateStatus()
  }

  private tryMoveTo(target: HexInstance): void {
    if (this.runOver) return
    if (target.q === this.unitHex.q && target.r === this.unitHex.r) return

    // One step per click; cost depends on the destination tile.
    if (hexDistance(this.unitHex, target) !== 1) return

    const tile = this.tiles.get(this.key(target))
    if (!tile) return
    if (isImpassable(tile.type)) return

    const cost = TILE_COST[tile.type]
    if (this.mp < cost) return

    this.unitHex = target
    this.mp -= cost
    this.totalMoves += 1
    this.animateUnitTo(target)
    this.revealAround(this.unitHex)
    this.refreshHover()

    // Apply tile entry effects after the move resolves.
    this.onEnterTile(this.key(target), tile.type)
  }

  private endTurn(): void {
    if (this.runOver) return
    this.turn += 1
    this.mp = this.maxMp
    this.updateStatus()
    this.refreshHover()
  }

  // ---- tile entry effects (hazards, shrine, encounters) ----------------

  private onEnterTile(tileKey: string, type: TileType): void {
    const isFirstVisit = !this.visitedKeys.has(tileKey)
    this.visitedKeys.add(tileKey)

    // Aggregate visit counts on the daily seed (powers the heatmap later).
    if (isFirstVisit && this.seedDate && isDailySeed(this.seed)) {
      void recordVisit(this.seedDate, this.unitHex.q, this.unitHex.r)
    }

    // Shrine: heal + win. Wins regardless of mercy rules / encounters.
    if (type === 'shrine') {
      this.hp = this.maxHp
      this.flashLog('You reach the shrine.', '#fff3b0')
      this.updateStatus()
      this.endRun('win')
      return
    }

    // Hazard damage (always applies).
    const dmg = hazardHpCost(type)
    if (dmg > 0) {
      this.hp = Math.max(0, this.hp - dmg)
      this.flashLog(`The ${TILE_LABEL[type]} drains you. \u22121 HP`, '#ffd1d1')
      this.updateStatus()
      if (this.hp <= 0) {
        this.deathBiome = type
        this.endRun('death')
        return
      }
    }

    // Random encounter (only on first visit; mercy when HP === 1).
    if (!isFirstVisit) return
    if (this.hp <= 1) return
    const enc = this.encounters.get(tileKey)
    if (!enc) return

    const damage = Math.max(0, enc.power - this.toughness)
    this.hp = Math.max(0, this.hp - damage)
    const damagePart = damage > 0 ? `\u2212${damage} HP` : 'no damage'
    const verb = enc.kind === 'beast' ? 'attacks' : 'ambushes'
    this.flashLog(`${enc.name} ${verb}! ${damagePart}`,
      enc.kind === 'beast' ? '#ffb38a' : '#ffd1d1')
    // Encounter resolved either way — count it.
    if (enc.kind === 'beast') this.beastKills += 1
    else this.banditKills += 1
    this.updateStatus()
    if (this.hp <= 0) {
      this.deathBiome = type
      this.endRun('death')
    }
  }

  private endRun(outcome: 'win' | 'death'): void {
    if (this.runOver) return
    this.runOver = true

    // Stop further interaction.
    this.input.removeAllListeners()
    this.input.keyboard?.removeAllListeners()

    let revealed = 0
    let total = 0
    this.tiles.forEach((t) => {
      total++
      if (t.visibility !== 'hidden') revealed++
    })

    // Update meta-progression and capture any new colour unlocks.
    const oldMeta = loadMeta()
    const update = applyRunResult(oldMeta, {
      outcome,
      tilesExplored: revealed,
      characterName: this.character.name,
    })
    saveMeta(update.meta)

    const newlyUnlockedColorNames = update.newlyUnlockedColors.map((value) => {
      const fromStarter = STARTING_COLORS.find((c) => c.value === value)
      if (fromStarter) return fromStarter.name
      const fromMilestone = MILESTONE_COLORS.find((m) => m.color === value)
      return fromMilestone?.name ?? 'Unknown'
    })

    showRunEnd({
      outcome,
      turns: this.turn,
      tilesExplored: revealed,
      totalTiles: total,
      totalMoves: this.totalMoves,
      beastKills: this.beastKills,
      banditKills: this.banditKills,
      deathBiome: this.deathBiome,
      newlyUnlockedColorNames,
    })

    // Submit to leaderboard if this run was on the shared daily seed.
    if (this.seedDate && isDailySeed(this.seed)) {
      void submitRun({
        seedDate: this.seedDate,
        outcome,
        turns: this.turn,
        tilesExplored: revealed,
        totalMoves: this.totalMoves,
        beastKills: this.beastKills,
        banditKills: this.banditKills,
        deathBiome: this.deathBiome,
        characterColor: this.character.color,
        characterName: this.character.name,
      })
    }
  }

  private flashLog(text: string, color: string): void {
    this.logText.setText(text)
    this.logText.setColor(color)
    this.logText.setAlpha(1)
    if (this.logTimer) this.logTimer.remove(false)
    this.logTimer = this.time.delayedCall(LOG_FADE_MS, () => {
      this.tweens.add({
        targets: this.logText,
        alpha: 0,
        duration: 400,
      })
    })
  }

  // ---- hover / pathfinding ---------------------------------------------

  private updateHover(hex: HexInstance | null): void {
    const newKey = hex ? this.key(hex) : null
    if (newKey === this.hoveredKey) return
    this.hoveredKey = newKey
    this.refreshHover()
  }

  private refreshHover(): void {
    this.hoverGfx.clear()

    if (!this.hoveredKey) {
      this.hoverText.setVisible(false)
      return
    }

    const hex = this.hexByKey.get(this.hoveredKey)
    const tile = this.tiles.get(this.hoveredKey)
    if (!hex || !tile) {
      this.hoverText.setVisible(false)
      return
    }

    if (tile.visibility === 'hidden') {
      this.hoverText.setVisible(false)
      return
    }

    if (hex.q === this.unitHex.q && hex.r === this.unitHex.r) {
      this.hoverText.setVisible(false)
      return
    }

    const corners = hex.corners.map((c) => ({
      x: c.x + this.offsetX,
      y: c.y + this.offsetY,
    }))
    this.hoverGfx.lineStyle(2, 0xffffff, 0.9)
    this.hoverGfx.beginPath()
    this.hoverGfx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < corners.length; i++) {
      this.hoverGfx.lineTo(corners[i].x, corners[i].y)
    }
    this.hoverGfx.closePath()
    this.hoverGfx.strokePath()

    const cx = hex.x + this.offsetX
    const cy = hex.y + this.offsetY
    this.hoverText.setPosition(cx, cy)

    if (isImpassable(tile.type)) {
      this.hoverText.setText('\u2715')
      this.hoverText.setColor('#ff5252')
      this.hoverText.setVisible(true)
      return
    }

    // Path cost is total MP, not step count.
    const tilesByType = this.tilesByTypeMap()
    const from: MapCoord = { q: this.unitHex.q, r: this.unitHex.r }
    const to: MapCoord = { q: hex.q, r: hex.r }
    const mpCost = shortestPathCost(tilesByType, from, to)
    if (mpCost === null) {
      this.hoverText.setText('\u2715')
      this.hoverText.setColor('#ff5252')
      this.hoverText.setVisible(true)
      return
    }

    const turns = this.turnsForMpCost(mpCost)
    this.hoverText.setText(String(turns))
    this.hoverText.setColor(turns === 1 ? '#7cff7c' : '#ffffff')
    this.hoverText.setVisible(true)
  }

  // Project our visibility-aware tile map down to a plain TileType map for
  // the world helpers, which don't care about visibility.
  private tilesByTypeMap(): Map<string, TileType> {
    const m = new Map<string, TileType>()
    for (const [k, t] of this.tiles) m.set(k, t.type)
    return m
  }

  // Total turns (including current) needed to spend `mpCost` MP, accounting
  // for remaining MP this turn.
  private turnsForMpCost(mpCost: number): number {
    if (mpCost <= 0) return 0
    if (mpCost <= this.mp) return 1
    return 1 + Math.ceil((mpCost - this.mp) / this.maxMp)
  }

  // ---- HUD --------------------------------------------------------------

  private updateStatus(): void {
    let revealed = 0
    let total = 0
    this.tiles.forEach((t) => {
      total++
      if (t.visibility !== 'hidden') revealed++
    })
    const pct = Math.round((revealed / total) * 100)
    const mpHint = !this.runOver && this.mp === 0 ? '  (SPACE / ENTER to end turn)' : ''
    const seedTag = this.seed.startsWith('daily-') ? '  \u2022  DAILY' : ''
    this.statusText.setText(
      `${this.character.name}${seedTag}  \u2022  turn ${this.turn}  \u2022  explored ${revealed}/${total} (${pct}%)${mpHint}`,
    )
    this.drawPips()
  }

  private drawPips(): void {
    const margin = 10
    const pipR = 5
    const gap = 5

    // ---- HP (red filled circles, top row) ----
    this.hpPipsGfx.clear()
    const hpTotalWidth = this.maxHp * (pipR * 2) + (this.maxHp - 1) * gap
    const hpStartX = GAME_WIDTH - margin - hpTotalWidth + pipR
    const hpY = 14
    for (let i = 0; i < this.maxHp; i++) {
      const x = hpStartX + i * (pipR * 2 + gap)
      const filled = i < this.hp
      this.hpPipsGfx.fillStyle(filled ? 0xff5252 : 0x36181c, 1)
      this.hpPipsGfx.fillCircle(x, hpY, pipR)
      this.hpPipsGfx.lineStyle(1, 0x000000, 0.7)
      this.hpPipsGfx.strokeCircle(x, hpY, pipR)
    }

    // ---- MP (yellow diamonds, bottom row) ----
    this.mpPipsGfx.clear()
    const mpTotalWidth = this.maxMp * (pipR * 2) + (this.maxMp - 1) * gap
    const mpStartX = GAME_WIDTH - margin - mpTotalWidth + pipR
    const mpY = 28
    for (let i = 0; i < this.maxMp; i++) {
      const x = mpStartX + i * (pipR * 2 + gap)
      const filled = i < this.mp
      this.mpPipsGfx.fillStyle(filled ? 0xffeb3b : 0x2c2a16, 1)
      this.mpPipsGfx.lineStyle(1, 0x000000, 0.7)
      this.mpPipsGfx.beginPath()
      this.mpPipsGfx.moveTo(x, mpY - pipR)
      this.mpPipsGfx.lineTo(x + pipR, mpY)
      this.mpPipsGfx.lineTo(x, mpY + pipR)
      this.mpPipsGfx.lineTo(x - pipR, mpY)
      this.mpPipsGfx.closePath()
      this.mpPipsGfx.fillPath()
      this.mpPipsGfx.strokePath()
    }
  }
}

// Re-export so other modules can stay encapsulated from honeycomb internals.
export { HEX_NEIGHBOR_DIRS }
