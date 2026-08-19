# Football Duel

Real-time 2-player football knowledge game. Both players get the same challenge
at the same time and race to type a valid football player's name — the first
correct answer to reach the server wins the round. The **server is authoritative**:
winners are assigned atomically in Postgres so two simultaneous correct answers
can never both win, and the opponent never sees what you type.

## Features

- Two challenge types: **Random** (server picks) and **Player Pick** (players
  secretly choose the teams, revealed simultaneously by the server).
- **30-second** server-authoritative round timer with urgent countdown.
- Global player **autocomplete** while guessing (fuzzy, keyboard-navigable).
- Standalone **Player Lookup** page (`/lookup`) to explore valid players for any
  National Team × Club or Club × Club combination.
- Real dataset (~16.8k players / 545 clubs / 104 national teams) from Transfermarkt.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase Postgres (schema + atomic RPCs)
- Supabase Realtime (live room/round sync)
- Supabase anonymous auth

## Quick start (run from GitHub)

> **Pulling the repo alone is not enough.** `node_modules` and `.env.local`
> (your Supabase keys) are intentionally not committed, and the football data
> lives in your Supabase **cloud** project — not in the repo.

```bash
git clone git@github.com:atakansucu/football-game.git
cd football-game
npm install
cp .env.example .env.local     # then fill in the values below
npm run dev                    # http://localhost:3000
```

Fill `.env.local` with your Supabase project values (from Supabase Dashboard →
**Project Settings → API**):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # only for scripts/tests, never shipped to the browser
```

As long as `.env.local` points at a Supabase project that already has the schema
and data, **no migration or import is needed** — the app just works. The easiest
way to move to a new machine is to copy your existing `.env.local` verbatim.

Setting up a **fresh, empty** Supabase project instead? See
[Full setup](#full-setup-local-or-fresh-supabase) below.

## Architecture

```
src/
  app/                 pages: / /create /join /room/[code] /lookup
  components/          shared UI (Button, ScoreBar, ChallengeCard, AnswerInput)
  features/
    room/              useGameRoom (realtime) + Lobby
    game/              GameScreen, MatchResult, round phase helpers
  lib/
    football/          PURE domain logic (normalize, validate, challenge) — no React/DB
    supabase/          browser + service-role clients
  server/game/         typed wrappers around the authoritative RPCs
  types/               db + game types
supabase/
  migrations/          0001 schema · 0002 RPCs · 0003 answers · 0004 lookup
                       0005 player-pick + timer · 0006 player search
  cloud-setup.sql      all migrations + seed in one file (for Supabase Cloud)
  seed.sql             demo data (real players)
scripts/data-import/   preprocess + import any dataset into the normalized shape
tests/                 vitest domain tests + DB integration test
```

Game rules live entirely in `src/lib/football` (unit-tested) and mirrored in the
database RPCs. The football data source can be swapped by feeding a
`NormalizedDataset` (see `scripts/data-import/types.ts`) into the importer without
touching game logic.

## Game modes

- **National Team × Club** — player represented the senior national team AND has
  >= 1 official first-team appearance for the club.
- **Club × Club** — player has >= 1 official first-team appearance for both clubs.

Only official first-team appearances count (loans count only if they played;
youth/reserve-only does not). Nationality/birthplace is never used — only the
senior national team represented.

## Full setup (local or fresh Supabase)

Only needed if you are **not** reusing an already-populated project (otherwise use
[Quick start](#quick-start-run-from-github)).

### Option A — Fresh Supabase Cloud project

1. Create a project at [supabase.com](https://supabase.com), then put its API URL
   + `anon` + `service_role` keys into `.env.local` (`cp .env.example .env.local`).
2. In the Supabase **SQL Editor**, run the contents of `supabase/cloud-setup.sql`
   (all migrations + seed in one file).
3. Import the full dataset (regenerate it first — see
   [Importing a real dataset](#importing-a-real-dataset)):

   ```bash
   npx tsx scripts/data-import/importFootballData.ts ./dataset.transfermarkt.json
   ```

4. `npm install && npm run dev`.

### Option B — Local Supabase (requires Docker)

1. `npm install`
2. `npm run db:start` — copy the printed `API URL`, `anon key`, `service_role key`
   into `.env.local`.
3. `npm run db:reset` — applies migrations + seed.
4. `npm run dev`.

Open two browser windows (or two devices): one creates a room, the other joins
with the code.

## Tests

```bash
npm test
```

Pure domain tests always run. The atomic-submission integration test in
`tests/submit.integration.test.ts` runs only when a local Supabase is up and
`SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL` are set (otherwise it is
skipped). It verifies simultaneous correct answers yield exactly one winner and
that early/late submissions are rejected.

## Importing a real dataset

The generated dataset (`dataset.transfermarkt.json`) is **not** committed (large,
gitignored). To regenerate it from the public Kaggle
[Transfermarkt "player-scores"](https://www.kaggle.com/datasets/davidcariboo/player-scores)
export:

```bash
# 1. Download + unzip (no auth needed for this public set)
curl -L -o tm.zip "https://www.kaggle.com/api/v1/datasets/download/davidcariboo/player-scores"
unzip tm.zip -d tmdata

# 2. Transform CSVs -> normalized dataset JSON
npx tsx scripts/data-import/fromTransfermarkt.ts ./tmdata ./dataset.transfermarkt.json

# 3. Import into the Supabase project from .env.local
npx tsx scripts/data-import/importFootballData.ts ./dataset.transfermarkt.json
```

The importer clears existing players (batched), reuses clubs/national teams by
name, only stores club relations backed by >= 1 official appearance (data covers
2012+), and rebuilds the precomputed answer tables so challenges are always
answerable. To feed any other source, produce a `NormalizedDataset` (see
`scripts/data-import/types.ts`) and run step 3.

> Note: this dataset's match log starts in 2012, so pre-2012 club spells (e.g.
> older players' early clubs) are not present.

## Configuration

- Winning condition defaults to **first to 5** (`DEFAULT_WIN_TARGET` in
  `src/types/game.ts`), and is selectable per room (3 / 5 / 7).
- Max players per room: 2 (enforced by the schema).
