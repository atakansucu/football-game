# Football Duel

Real-time 2-player football knowledge game. Both players get the same challenge
at the same time and race to type a valid football player's name — the first
correct answer to reach the server wins the round. The **server is authoritative**:
winners are assigned atomically in Postgres so two simultaneous correct answers
can never both win, and the opponent never sees what you type.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase Postgres (schema + atomic RPCs)
- Supabase Realtime (live room/round sync)
- Supabase anonymous auth

## Architecture

```
src/
  app/                 pages: / /create /join /room/[code]
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
  migrations/          0001 schema · 0002 functions/RPCs · 0003 answer rebuild
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

## Setup

1. Install deps:

   ```bash
   npm install
   ```

2. Start local Supabase (requires Docker):

   ```bash
   npm run db:start
   ```

   Copy the printed `API URL`, `anon key` and `service_role key` into `.env.local`:

   ```bash
   cp .env.example .env.local
   # then edit the values
   ```

3. Apply migrations + seed:

   ```bash
   npm run db:reset
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

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

Preprocess any source (e.g. a Transfermarkt export) into the normalized JSON
shape and import it:

```bash
npx tsx scripts/data-import/importFootballData.ts path/to/dataset.json
```

The importer only stores club relations with >= 1 appearance and rebuilds the
precomputed answer tables so challenges are always answerable.

## Configuration

- Winning condition defaults to **first to 5** (`DEFAULT_WIN_TARGET` in
  `src/types/game.ts`), and is selectable per room (3 / 5 / 7).
- Max players per room: 2 (enforced by the schema).
