// Tiny helper around the run-end HTML overlay. Decoupled from the scene so
// other UI (start screens, leaderboards, etc.) can live alongside it later.

export type RunOutcome = 'win' | 'death'

export interface RunEndPayload {
  outcome: RunOutcome
  turns: number
  tilesExplored: number
  totalTiles: number
  totalMoves: number
  beastKills: number
  banditKills: number
  deathBiome?: string | null
  newlyUnlockedColorNames?: string[]
  newlyEarnedLegacyTitles?: string[]
  xpAwarded: number
  newLevel: number
  leveledUp: boolean
}

const BIOME_DEATH_FLAVOR: Record<string, string> = {
  swamp: 'the swamp claimed you',
  forest: 'the forest closed in',
  hills: 'the hills broke you',
  plains: 'the road was unkind',
  sand: 'the dunes took you',
  mountain: 'the mountains buried you',
  water: 'the water took you',
  shrine: 'the shrine fell silent',
}

function buildFlavorLine(p: RunEndPayload): string {
  const parts: string[] = []
  parts.push(`${p.totalMoves} step${p.totalMoves === 1 ? '' : 's'}`)
  if (p.beastKills > 0) {
    parts.push(`${p.beastKills} beast${p.beastKills === 1 ? '' : 's'} felled`)
  }
  if (p.banditKills > 0) {
    parts.push(`${p.banditKills} bandit${p.banditKills === 1 ? '' : 's'} felled`)
  }
  if (p.outcome === 'death' && p.deathBiome && BIOME_DEATH_FLAVOR[p.deathBiome]) {
    parts.push(BIOME_DEATH_FLAVOR[p.deathBiome])
  }
  return parts.join(' \u00b7 ')
}

export function showRunEnd(payload: RunEndPayload): void {
  const overlay = document.getElementById('runEndOverlay') as HTMLElement | null
  const title = document.getElementById('runEndTitle') as HTMLElement | null
  const stats = document.getElementById('runEndStats') as HTMLElement | null
  const subtitle = document.getElementById('runEndSubtitle') as HTMLElement | null
  const button = document.getElementById('runEndButton') as HTMLButtonElement | null
  if (!overlay || !title || !stats || !subtitle || !button) return

  if (payload.outcome === 'win') {
    title.textContent = 'Pilgrimage complete'
    subtitle.textContent = 'The shrine welcomes you home.'
  } else {
    title.textContent = 'You have fallen'
    subtitle.textContent = 'The path remembers you.'
  }
  title.dataset.outcome = payload.outcome

  const pct = Math.round((payload.tilesExplored / payload.totalTiles) * 100)
  stats.textContent =
    `${payload.turns} turn${payload.turns === 1 ? '' : 's'} \u00b7 ` +
    `${payload.tilesExplored}/${payload.totalTiles} tiles explored (${pct}%)`

  const flavorEl = document.getElementById('runEndFlavor') as HTMLElement | null
  if (flavorEl) {
    flavorEl.textContent = buildFlavorLine(payload)
  }

  const xpEl = document.getElementById('runEndXp') as HTMLElement | null
  if (xpEl) {
    xpEl.textContent = `+${payload.xpAwarded} XP`
  }

  const levelEl = document.getElementById('runEndLevel') as HTMLElement | null
  if (levelEl) {
    if (payload.leveledUp) {
      levelEl.textContent = `Level ${payload.newLevel} reached!`
      levelEl.hidden = false
    } else {
      levelEl.textContent = ''
      levelEl.hidden = true
    }
  }

  const unlocks = document.getElementById('runEndUnlocks') as HTMLElement | null
  if (unlocks) {
    const names = payload.newlyUnlockedColorNames ?? []
    if (names.length > 0) {
      unlocks.textContent =
        `New robe${names.length === 1 ? '' : 's'} unlocked: ${names.join(', ')}.`
    } else {
      unlocks.textContent = ''
    }
  }

  const legacyEl = document.getElementById('runEndLegacies') as HTMLElement | null
  if (legacyEl) {
    const titles = payload.newlyEarnedLegacyTitles ?? []
    if (titles.length > 0) {
      legacyEl.innerHTML = titles
        .map((t) => `<span class="runEndLegacy">Legacy: ${escapeHtml(t)}</span>`)
        .join('')
      legacyEl.hidden = false
    } else {
      legacyEl.innerHTML = ''
      legacyEl.hidden = true
    }
  }

  button.onclick = () => {
    // Simplest reliable reset: full page reload. New run, new seed,
    // start screen reappears with fresh meta-progress.
    window.location.reload()
  }

  overlay.hidden = false
}

export function hideRunEnd(): void {
  const overlay = document.getElementById('runEndOverlay') as HTMLElement | null
  if (overlay) overlay.hidden = true
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
