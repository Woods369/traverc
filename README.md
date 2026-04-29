# traverc

A small cozy hex-based roguelike pilgrimage.

You play one fragile traveller. Cross an unknown land one tile at a time.
Reach the shrine. Avoid the swamps. The bears, wolves and bandits are not
patient.

Every day, every player gets the same map. Compare your turns to the rest
of the pilgrims on the daily leaderboard.

## Play

https://traverc.vercel.app/

## Run locally

```bash
nvm use 22
npm install
npm run dev
```

Open the printed URL.

## Controls

- **Click** an adjacent hex to step. Each step costs MP; some terrain is slower.
- **SPACE / ENTER** ends your turn (refreshes MP).
- **Hover** any visible tile to see the turns it would take to reach.
- Walking into water or a mountain is impossible. Walking into a swamp hurts.

## Build for production

```bash
npm run build       # outputs /dist
npm run preview     # local preview of the production build
```

## Backend (optional)

The game runs fully offline out of the box. To enable the daily-seed
leaderboard, anonymous accounts, and tile visit aggregation, point the
client at a Supabase project:

1. Create a project at https://supabase.com/ (free tier is plenty).
2. SQL editor → run `sql/schema.sql`.
3. Authentication → Providers → enable **Anonymous sign-ins**.
4. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Restart `npm run dev`.

If `.env` is missing or empty, the services no-op and the game falls back
to local-only daily seeds.

## Stack

- Vite + TypeScript
- Phaser 4 (canvas + game loop)
- honeycomb-grid (hex math)
- simplex-noise (procedural biomes)
- Supabase (auth + Postgres + RLS, optional)

## Project layout

```
src/
  main.ts            entry; boots Phaser after the start screen emits a Character
  scene.ts           the game scene
  world.ts           map gen, biomes, encounters, pathfinding
  character.ts       character model + factory
  meta.ts            offline meta-progression (localStorage)
  start-screen.ts    pre-run screen + leaderboard
  overlay.ts         run-end overlay
  profanity.ts       client-side name filter
  services/          Supabase client + auth/runs/daily/tiles services
public/              favicon, OG image
sql/schema.sql       Tier 1 schema, RLS, leaderboard view
```

## Roadmap

- One persistent levelling pilgrim per account
- "Legacies" — flavoured achievements that follow your pilgrim
- Sound + ambient pad
- Mobile-friendly touch input
- NPC quest-givers and rest towns

## Licence

(decide before public launch — MIT or All Rights Reserved are both fine)
