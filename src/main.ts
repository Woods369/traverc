import * as Phaser from 'phaser'
import './style.css'
import { GameScene, GAME_WIDTH, GAME_HEIGHT } from './scene'
import { initStartScreen } from './start-screen'
import { ensurePlayer } from './services/auth'

initStartScreen({
  onBegin: async ({ character, seed, seedDate }) => {
    // Anonymous-first: register the player on first run if a backend is
    // configured. Falls through silently if VITE_SUPABASE_* aren't set.
    await ensurePlayer(character.name)

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: 'game',
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      backgroundColor: '#0b0d12',
      render: {
        antialias: true,
        pixelArt: false,
      },
    }
    const game = new Phaser.Game(config)
    // Manually add the scene with run config so init(data) receives it.
    game.scene.add('game', GameScene, true, { character, seed, seedDate })
  },
})
