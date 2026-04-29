// Pre-run UI. Has two states:
//   - "create" — first-time players pick a name + robe and create a pilgrim.
//   - "ready"  — returning players see their pilgrim card + daily toggle +
//                begin button + today's leaderboard.

import { STARTING_COLORS, type Character } from './character'
import { MILESTONE_COLORS } from './meta'
import { isProfane } from './profanity'
import {
  getActiveCharacter,
  createActiveCharacter,
} from './active-character'
import { getDailySeed } from './services/daily'
import { getLeaderboard, type LeaderboardEntry } from './services/runs'
import { isBackendConfigured } from './services/supabase'
import { ensurePlayer } from './services/auth'

export interface BeginPayload {
  character: Character
  seed: string
  seedDate?: string
}

export interface StartScreenOpts {
  onBegin: (payload: BeginPayload) => void
}

interface ColorEntry {
  value: number
  name: string
}

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

function hex(value: number): string {
  return '#' + value.toString(16).padStart(6, '0')
}

function colorName(value: number): string {
  const fromStarter = STARTING_COLORS.find((c) => c.value === value)
  if (fromStarter) return fromStarter.name
  const fromMilestone = MILESTONE_COLORS.find((m) => m.color === value)
  return fromMilestone?.name ?? 'Unknown'
}

export async function initStartScreen(opts: StartScreenOpts): Promise<void> {
  // ---- DOM lookups ---------------------------------------------------------
  const root = document.getElementById('startScreen') as HTMLElement | null
  const createSection = document.getElementById('startCreate') as HTMLElement | null
  const readySection = document.getElementById('startReady') as HTMLElement | null
  if (!root || !createSection || !readySection) return

  // Create-state nodes
  const nameInput = document.getElementById('startName') as HTMLInputElement | null
  const colorGrid = document.getElementById('startColors') as HTMLElement | null
  const lockedHint = document.getElementById('startLockedHint') as HTMLElement | null
  const nameError = document.getElementById('startNameError') as HTMLElement | null
  const createBtn = document.getElementById('startCreateBtn') as HTMLButtonElement | null
  if (!nameInput || !colorGrid || !createBtn) return

  // Ready-state nodes
  const swatch = document.getElementById('readySwatch') as HTMLElement | null
  const readyName = document.getElementById('readyName') as HTMLElement | null
  const readyMeta = document.getElementById('readyMeta') as HTMLElement | null
  const readyAggregates = document.getElementById('readyAggregates') as HTMLElement | null
  const beginBtn = document.getElementById('startBeginBtn') as HTMLButtonElement | null
  const dailyToggle = document.getElementById('startDaily') as HTMLInputElement | null
  const dailyDateEl = document.getElementById('startDailyDate') as HTMLElement | null
  const leaderboardPanel = document.getElementById('leaderboardPanel') as HTMLElement | null
  const leaderboardList = document.getElementById('leaderboardList') as HTMLOListElement | null
  const leaderboardEmpty = document.getElementById('leaderboardEmpty') as HTMLElement | null
  if (!swatch || !readyName || !readyMeta || !readyAggregates || !beginBtn) return

  if (dailyDateEl) dailyDateEl.textContent = prettyDate()

  // ---- Bootstrap: backend session + active character ----------------------
  // Anonymous Supabase session if backend is configured. No-op otherwise.
  await ensurePlayer('Pilgrim')

  let character = await getActiveCharacter()
  if (character) {
    showReady(character)
  } else {
    showCreate()
  }

  // -------------------------------------------------------------------------
  // CREATE STATE
  // -------------------------------------------------------------------------
  function showCreate(): void {
    if (!createSection || !readySection) return
    createSection.hidden = false
    readySection.hidden = true
    populateColorPicker()
    nameInput?.focus()
  }

  function showNameError(msg: string | null): void {
    if (!nameError) return
    if (msg) {
      nameError.textContent = msg
      nameError.hidden = false
    } else {
      nameError.textContent = ''
      nameError.hidden = true
    }
  }

  let selectedColor = STARTING_COLORS[0].value
  function populateColorPicker(): void {
    if (!colorGrid) return
    const palette: ColorEntry[] = STARTING_COLORS.map((c) => ({ ...c }))
    for (const m of MILESTONE_COLORS) {
      if (!palette.some((c) => c.value === m.color)) {
        palette.push({ value: m.color, name: m.name })
      }
    }
    // For v1 (single character): only starter colours unlocked at creation
    // time. Future: expose milestones tied to the player's lifetime wins.
    const unlocked = new Set(STARTING_COLORS.map((c) => c.value))
    selectedColor = STARTING_COLORS[0].value

    colorGrid.replaceChildren()
    const swatches: HTMLElement[] = []
    for (const c of palette) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'colorSwatch'
      button.style.backgroundColor = hex(c.value)
      const isUnlocked = unlocked.has(c.value)
      if (!isUnlocked) {
        button.disabled = true
        button.classList.add('locked')
        const milestone = MILESTONE_COLORS.find((m) => m.color === c.value)
        const wins = milestone?.winsRequired ?? 0
        button.title = `${c.name} — unlocks at ${wins} win${wins === 1 ? '' : 's'}`
        button.setAttribute('aria-label', `${c.name} (locked)`)
      } else {
        button.title = c.name
        button.setAttribute('aria-label', c.name)
        button.addEventListener('click', () => {
          selectedColor = c.value
          for (const s of swatches) s.classList.remove('selected')
          button.classList.add('selected')
        })
      }
      if (isUnlocked && c.value === selectedColor) button.classList.add('selected')
      colorGrid.appendChild(button)
      swatches.push(button)
    }

    if (lockedHint) {
      const lockedCount = palette.filter((c) => !unlocked.has(c.value)).length
      lockedHint.textContent =
        lockedCount > 0
          ? `${lockedCount} robe${lockedCount === 1 ? '' : 's'} locked \u2014 earn them by completing pilgrimages.`
          : ''
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!nameInput || !createBtn) return
    const name = (nameInput.value || '').trim() || 'Pilgrim'
    if (isProfane(name)) {
      showNameError('Please choose a different name.')
      return
    }
    showNameError(null)
    createBtn.disabled = true
    const created = await createActiveCharacter({ name, color: selectedColor })
    createBtn.disabled = false
    if (!created) {
      showNameError('Could not create pilgrim. Please try again.')
      return
    }
    character = created
    showReady(created)
  }
  createBtn.addEventListener('click', () => void handleCreate())
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleCreate()
    }
  })

  // -------------------------------------------------------------------------
  // READY STATE
  // -------------------------------------------------------------------------
  function showReady(c: Character): void {
    if (!createSection || !readySection) return
    createSection.hidden = true
    readySection.hidden = false

    swatch!.style.backgroundColor = hex(c.color)
    readyName!.textContent = c.name
    readyMeta!.textContent = `Level ${c.level} \u00b7 ${colorName(c.color)} robe`

    if (c.totalRuns === 0) {
      readyAggregates!.textContent = 'No journeys yet. Step lightly.'
    } else {
      const winRate = Math.round((c.totalWins / c.totalRuns) * 100)
      readyAggregates!.textContent =
        `${c.totalWins} win${c.totalWins === 1 ? '' : 's'} \u00b7 ` +
        `${c.totalRuns} run${c.totalRuns === 1 ? '' : 's'} (${winRate}%) \u00b7 ` +
        `streak ${c.currentStreak} (best ${c.longestStreak})`
    }
  }

  function renderLeaderboard(entries: LeaderboardEntry[]): void {
    if (!leaderboardList || !leaderboardEmpty) return
    leaderboardList.replaceChildren()
    if (entries.length === 0) {
      leaderboardEmpty.hidden = false
      return
    }
    leaderboardEmpty.hidden = true
    for (const e of entries) {
      const li = document.createElement('li')
      const dot = document.createElement('span')
      dot.className = 'swatch'
      dot.style.backgroundColor = hex(e.characterColor)
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = e.characterName || e.displayName || 'Pilgrim'
      const turns = document.createElement('span')
      turns.className = 'turns'
      turns.textContent = `${e.turns} turn${e.turns === 1 ? '' : 's'}`
      li.appendChild(dot)
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

  const handleBegin = async (): Promise<void> => {
    if (!character) {
      showCreate()
      return
    }
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
    root!.hidden = true
    opts.onBegin({ character, seed, seedDate })
  }
  beginBtn.addEventListener('click', () => void handleBegin())
}
