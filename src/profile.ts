// Renders the profile state of the start screen: character header, XP bar,
// lifetime + combat stats, and the legacies grid (earned + locked).

import type { Character } from './character'
import { LEVEL_CAP, LEVEL_THRESHOLDS } from './leveling'
import { LEGACIES } from './legacies'
import { STARTING_COLORS } from './character'
import { MILESTONE_COLORS } from './meta'

function hex(value: number): string {
  return '#' + value.toString(16).padStart(6, '0')
}

function colorName(value: number): string {
  const fromStarter = STARTING_COLORS.find((c) => c.value === value)
  if (fromStarter) return fromStarter.name
  const fromMilestone = MILESTONE_COLORS.find((m) => m.color === value)
  return fromMilestone?.name ?? 'Unknown'
}

function biomeLabel(biome: string): string {
  return biome.charAt(0).toUpperCase() + biome.slice(1)
}

function deadliestBiome(c: Character): { biome: string; deaths: number } | null {
  let best: { biome: string; deaths: number } | null = null
  for (const [biome, deaths] of Object.entries(c.biomeDeaths)) {
    if (!best || deaths > best.deaths) best = { biome, deaths }
  }
  return best
}

function setGrid(el: HTMLElement, rows: Array<[label: string, value: string]>): void {
  el.replaceChildren()
  for (const [label, value] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    el.appendChild(dt)
    el.appendChild(dd)
  }
}

export function renderProfile(c: Character): void {
  const swatch = document.getElementById('profileSwatch') as HTMLElement | null
  const name = document.getElementById('profileName') as HTMLElement | null
  const meta = document.getElementById('profileMeta') as HTMLElement | null
  const xpText = document.getElementById('profileXpText') as HTMLElement | null
  const xpRemaining = document.getElementById('profileXpRemaining') as HTMLElement | null
  const xpFill = document.getElementById('profileXpFill') as HTMLElement | null
  const lifetimeEl = document.getElementById('profileLifetime') as HTMLElement | null
  const combatEl = document.getElementById('profileCombat') as HTMLElement | null
  const heading = document.getElementById('profileLegaciesHeading') as HTMLElement | null
  const list = document.getElementById('profileLegacies') as HTMLUListElement | null
  const empty = document.getElementById('profileLegaciesEmpty') as HTMLElement | null
  if (
    !swatch ||
    !name ||
    !meta ||
    !xpText ||
    !xpRemaining ||
    !xpFill ||
    !lifetimeEl ||
    !combatEl ||
    !heading ||
    !list ||
    !empty
  ) {
    return
  }

  // Header
  swatch.style.backgroundColor = hex(c.color)
  name.textContent = c.name
  meta.textContent = `Level ${c.level} \u00b7 ${colorName(c.color)} robe`

  // XP bar
  if (c.level >= LEVEL_CAP) {
    xpText.textContent = `${c.xp} XP \u00b7 max level`
    xpRemaining.textContent = ''
    xpFill.style.width = '100%'
  } else {
    const floor = LEVEL_THRESHOLDS[c.level - 1]
    const ceiling = LEVEL_THRESHOLDS[c.level]
    const into = c.xp - floor
    const span = Math.max(1, ceiling - floor)
    const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)))
    xpText.textContent = `${c.xp} / ${ceiling} XP`
    xpRemaining.textContent = `${ceiling - c.xp} to L${c.level + 1}`
    xpFill.style.width = `${pct}%`
  }

  // Lifetime grid
  const winRate =
    c.totalRuns > 0 ? `${Math.round((c.totalWins / c.totalRuns) * 100)}%` : '\u2014'
  setGrid(lifetimeEl, [
    ['Runs', String(c.totalRuns)],
    ['Wins', String(c.totalWins)],
    ['Deaths', String(c.totalDeaths)],
    ['Win rate', winRate],
    ['Tiles explored', String(c.totalTiles)],
    ['Steps', String(c.totalMoves)],
    ['Streak', String(c.currentStreak)],
    ['Best streak', String(c.longestStreak)],
  ])

  // Combat grid
  const deadliest = deadliestBiome(c)
  setGrid(combatEl, [
    ['Beasts felled', String(c.encounterKills.beast)],
    ['Bandits felled', String(c.encounterKills.bandit)],
    [
      'Deadliest biome',
      deadliest
        ? `${biomeLabel(deadliest.biome)} (${deadliest.deaths})`
        : '\u2014',
    ],
  ])

  // Legacies grid
  list.replaceChildren()
  if (LEGACIES.length === 0) {
    heading.textContent = 'Legacies'
    empty.hidden = false
    return
  }
  empty.hidden = true
  const earnedSet = new Set(c.earnedLegacies)
  const earnedCount = LEGACIES.filter((l) => earnedSet.has(l.id)).length
  heading.textContent = `Legacies (${earnedCount} / ${LEGACIES.length})`

  for (const legacy of LEGACIES) {
    const isEarned = earnedSet.has(legacy.id)
    const li = document.createElement('li')
    li.className = `legacyCard ${isEarned ? 'earned' : 'locked'}`
    const title = document.createElement('p')
    title.className = 'legacyCard__title'
    title.textContent = isEarned ? legacy.title : '???'
    const body = document.createElement('p')
    body.className = 'legacyCard__body'
    body.textContent = isEarned ? legacy.flavor : legacy.hint
    li.appendChild(title)
    li.appendChild(body)
    list.appendChild(li)
  }
}
