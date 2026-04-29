// Tiny helper around the run-end HTML overlay. Decoupled from the scene so
// other UI (start screens, leaderboards, etc.) can live alongside it later.

export type RunOutcome = 'win' | 'death'

export interface RunEndPayload {
  outcome: RunOutcome
  turns: number
  tilesExplored: number
  totalTiles: number
  newlyUnlockedColorNames?: string[]
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
