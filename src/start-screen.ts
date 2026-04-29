// Pre-run "choose your traveller" screen. Reads meta-progression for unlocks
// and lifetime stats; emits a Character via onBegin when the player starts.

import { STARTING_COLORS, makeCharacter, type Character } from './character'
import { MILESTONE_COLORS, loadMeta } from './meta'
import { isProfane } from './profanity'
import { getDailySeed } from './services/daily'
import { getLeaderboard, type LeaderboardEntry } from './services/runs'
import { isBackendConfigured } from './services/supabase'

export interface BeginPayload {
  character: Character
  seed: string
  seedDate?: string
}

export interface StartScreenOpts {
  onBegin: (payload: BeginPayload) => void
}

// Local-date based daily seed. Same calendar day = same seed everywhere
// the player's clock agrees on the date. Tier 1 will replace this with a
// server-issued seed for true cross-player sharing.
function todayDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function prettyDate(): string {
  const d = new Date()
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

interface ColorEntry {
  value: number
  name: string
}

export function initStartScreen(opts: StartScreenOpts): void {
  const root = document.getElementById('startScreen') as HTMLElement | null
  const nameInput = document.getElementById('startName') as HTMLInputElement | null
  const colorGrid = document.getElementById('startColors') as HTMLElement | null
  const beginBtn = document.getElementById('startBegin') as HTMLButtonElement | null
  const statsEl = document.getElementById('startStats') as HTMLElement | null
  const lockedHint = document.getElementById('startLockedHint') as HTMLElement | null
  const dailyToggle = document.getElementById('startDaily') as HTMLInputElement | null
  const dailyDateEl = document.getElementById('startDailyDate') as HTMLElement | null
  const nameError = document.getElementById('startNameError') as HTMLElement | null
  const leaderboardPanel = document.getElementById('leaderboardPanel') as HTMLElement | null
  const leaderboardList = document.getElementById('leaderboardList') as HTMLOListElement | null
  const leaderboardEmpty = document.getElementById('leaderboardEmpty') as HTMLElement | null

  if (!root || !nameInput || !colorGrid || !beginBtn || !statsEl) return

  if (dailyDateEl) dailyDateEl.textContent = prettyDate()

  const showNameError = (msg: string | null): void => {
    if (!nameError) return
    if (msg) {
      nameError.textContent = msg
      nameError.hidden = false
    } else {
      nameError.textContent = ''
      nameError.hidden = true
    }
  }

  const renderLeaderboard = (entries: LeaderboardEntry[]): void => {
    if (!leaderboardList || !leaderboardEmpty) return
    leaderboardList.replaceChildren()
    if (entries.length === 0) {
      leaderboardEmpty.hidden = false
      return
    }
    leaderboardEmpty.hidden = true
    for (const e of entries) {
      const li = document.createElement('li')
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.style.backgroundColor = '#' + e.characterColor.toString(16).padStart(6, '0')
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = e.characterName || e.displayName || 'Pilgrim'
      const turns = document.createElement('span')
      turns.className = 'turns'
      turns.textContent = `${e.turns} turn${e.turns === 1 ? '' : 's'}`
      li.appendChild(swatch)
      li.appendChild(name)
      li.appendChild(turns)
      leaderboardList.appendChild(li)
    }
  }

  const refreshLeaderboard = async (): Promise<void> => {
    if (!leaderboardPanel || !isBackendConfigured()) return
    leaderboardPanel.hidden = false
    const entries = await getLeaderboard(todayDateString())
    renderLeaderboard(entries)
  }

  if (dailyToggle) {
    dailyToggle.addEventListener('change', () => {
      if (dailyToggle.checked) {
        void refreshLeaderboard()
      } else if (leaderboardPanel) {
        leaderboardPanel.hidden = true
      }
    })
  }

  const meta = loadMeta()

  // Pre-fill the name field with the last-used name.
  if (meta.lastName) nameInput.value = meta.lastName

  // Lifetime stats blurb.
  if (meta.totalRuns === 0) {
    statsEl.textContent = 'No journeys yet. Step lightly.'
  } else {
    const winRate = Math.round((meta.totalWins / meta.totalRuns) * 100)
    statsEl.textContent =
      `${meta.totalWins} win${meta.totalWins === 1 ? '' : 's'} \u00b7 ` +
      `${meta.totalRuns} run${meta.totalRuns === 1 ? '' : 's'} (${winRate}%) \u00b7 ` +
      `streak ${meta.currentStreak} (best ${meta.longestStreak})`
  }

  // Build the full palette: starters + milestone colours.
  const palette: ColorEntry[] = STARTING_COLORS.map((c) => ({ ...c }))
  for (const m of MILESTONE_COLORS) {
    if (!palette.some((c) => c.value === m.color)) {
      palette.push({ value: m.color, name: m.name })
    }
  }

  let selectedColor = meta.unlockedColors[0] ?? palette[0].value
  const swatches: HTMLElement[] = []

  colorGrid.replaceChildren()
  for (const c of palette) {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'colorSwatch'
    swatch.style.backgroundColor = '#' + c.value.toString(16).padStart(6, '0')

    const unlocked = meta.unlockedColors.includes(c.value)
    if (!unlocked) {
      swatch.disabled = true
      swatch.classList.add('locked')
      const milestone = MILESTONE_COLORS.find((m) => m.color === c.value)
      const wins = milestone?.winsRequired ?? 0
      swatch.title = `${c.name} \u2014 unlocks at ${wins} win${wins === 1 ? '' : 's'}`
      swatch.setAttribute('aria-label', `${c.name} (locked)`)
    } else {
      swatch.title = c.name
      swatch.setAttribute('aria-label', c.name)
      swatch.addEventListener('click', () => {
        selectedColor = c.value
        for (const s of swatches) s.classList.remove('selected')
        swatch.classList.add('selected')
      })
    }
    if (unlocked && c.value === selectedColor) swatch.classList.add('selected')
    colorGrid.appendChild(swatch)
    swatches.push(swatch)
  }

  // Select-the-first-swatch fallback (in case selectedColor isn't actually
  // in the palette for some reason).
  if (!swatches.some((s) => s.classList.contains('selected'))) {
    const firstUnlocked = swatches.find((s) => !s.classList.contains('locked'))
    if (firstUnlocked) firstUnlocked.classList.add('selected')
  }

  if (lockedHint) {
    const lockedCount = palette.filter((c) => !meta.unlockedColors.includes(c.value)).length
    lockedHint.textContent =
      lockedCount > 0
        ? `${lockedCount} robe${lockedCount === 1 ? '' : 's'} locked \u2014 earn them by completing pilgrimages.`
        : ''
  }

  const begin = async (): Promise<void> => {
    const name = (nameInput.value || '').trim() || 'Pilgrim'
    if (isProfane(name)) {
      showNameError('Please choose a different name.')
      return
    }
    showNameError(null)
    const character = makeCharacter(name, selectedColor)
    const useDaily = dailyToggle?.checked ?? false
    let seed: string
    let seedDate: string | undefined
    if (useDaily) {
      const ds = await getDailySeed()
      seed = ds.seed
      seedDate = ds.seedDate
    } else {
      seed = `traverc-${Math.floor(Math.random() * 1e9)}`
    }
    root.hidden = true
    opts.onBegin({ character, seed, seedDate })
  }

  beginBtn.addEventListener('click', () => void begin())
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void begin()
    }
  })
}
