# 3-2-1 Football

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

## Licensing-safe team visuals

- National teams use operating-system emoji flags where a country mapping is
  available, with a generic globe fallback.
- Club visuals are generated locally from the club name: a short label, a
  generic shield and deterministic colors from a curated palette.
- Generated club badges are non-official placeholders. They do not reproduce or
  imitate club crests and the app does not fetch club logo URLs or remote badge
  artwork.
- Do not add scraped logos, unverified image datasets or third-party artwork
  without documented rights and a separate legal/release review.

See [`docs/VISUAL_ASSET_POLICY.md`](docs/VISUAL_ASSET_POLICY.md) for the design
rules and metadata-source notes.

## Stack

- Next.js App Router + TypeScript + Tailwind CSS, exported as static files
- Capacitor 8 native iOS shell
- Swift Package Manager (Capacitor and native plugin dependencies)
- Supabase Postgres (schema + atomic RPCs)
- Supabase Realtime (live room/round sync)
- Supabase anonymous auth

The active mobile architecture is **Next.js static export + Capacitor 8 + iOS
SPM**. Expo/EAS is not the build or release path documented for this app.

## Requirements

- Node.js **22 or newer** (`@capacitor/cli` 8.5.0 requires Node `>=22.0.0`)
- npm
- macOS + Xcode for iOS development
- An Apple Developer team for physical-device signing or distribution
- A configured Supabase project

The iOS deployment target is 15.0.

## Quick start

> **Pulling the repo alone is not enough.** `node_modules` and `.env.local`
> (your Supabase keys) are intentionally not committed, and the football data
> lives in your Supabase **cloud** project — not in the repo.

```bash
git clone git@github.com:atakansucu/football-game.git
cd football-game
node --version                  # must be >= 22
npm ci
cp .env.example .env.local     # then fill in the values below
npm run dev                    # http://localhost:3000
```

Fill `.env.local` with your Supabase project values (from Supabase Dashboard →
**Project Settings → API**):

```
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # only for scripts/tests, never shipped to the browser
```

`NEXT_PUBLIC_*` values are embedded into the static web bundle at build time.
Use the intended backend values **before** `npm run mobile:build`. Never place
`SUPABASE_SERVICE_ROLE_KEY` in client code, Capacitor configuration, Xcode build
settings, or a distributed app.

As long as `.env.local` points at a Supabase project that already has the schema
and data, **no migration or import is needed** — the app just works. The easiest
way to move to a new machine is to copy your existing `.env.local` verbatim.

Setting up a **fresh, empty** Supabase project instead? See
[Full setup](#full-setup-local-or-fresh-supabase) below.

## Architecture

```
src/
  app/                 statically exported application routes
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
out/                   generated Next.js static export (Capacitor webDir)
capacitor.config.ts    app id/name, webDir and native plugin configuration
ios/App/               Xcode project and native iOS application
  CapApp-SPM/          Capacitor-managed local Swift package
```

Game rules live entirely in `src/lib/football` (unit-tested) and mirrored in the
database RPCs. The football data source can be swapped by feeding a
`NormalizedDataset` (see `scripts/data-import/types.ts`) into the importer without
touching game logic.

## iOS architecture and development

The native app does not host a Next.js server. `next.config.mjs` uses
`output: "export"` and writes the site to `out/`. `capacitor.config.ts` points
`webDir` at that folder. Capacitor copies the static files into the iOS project,
then the WKWebView loads them locally while Supabase Auth, RPC and Realtime use
the network.

Current native identity:

- App/display name: `3-2-1 Football`
- Bundle ID: `com.atakansucu.footballduel`
- Capacitor: 8.5.0
- iOS deployment target: 15.0
- Native dependency manager: Swift Package Manager

`ios/App/CapApp-SPM/Package.swift` is generated/managed by Capacitor. Do not edit
it manually.

### Build, sync and open

From the repository root:

```bash
# Build the Next.js static export and sync it plus native plugins into iOS
npm run mobile:build

# Sync again only when out/ already contains the intended current build
npm run mobile:sync

# Open the native project in Xcode
npm run mobile:ios
```

`npm run mobile:build` is the normal path after any web app or environment
change. Opening Xcode without rebuilding/syncing can run stale web assets.

In Xcode, wait for the local `CapApp-SPM` package to resolve. Select the `App`
scheme, choose a signed physical device, then Run. Do not add CocoaPods steps;
this project uses SPM.

### Physical-device multiplayer test

Use two physical iOS devices with the same candidate build:

1. Device A creates a multiplayer room and records the room code.
2. Device B joins that code using a different display name.
3. Verify both devices enter the same round and see matching challenge/timer.
4. Submit nearly simultaneous correct answers; verify exactly one server winner.
5. Test wrong answers, next round, final result and rematch/exit behavior.
6. Background/foreground one device, reconnect it, and switch Wi-Fi/cellular
   where available.
7. Force a temporary network failure and verify recovery/error messaging.
8. Relaunch both apps and verify anonymous-session behavior is expected.
9. Confirm every club uses a generated shield and no remote crest is requested.

Record device model, iOS version, network type, app version/build number and
pass/fail result. Complete solo, lookup, keyboard, safe-area and accessibility
checks as part of the same release candidate.

### Archive and TestFlight

Production distribution is performed in Xcode, not EAS:

1. Run tests/typecheck, then `npm run mobile:build` with reviewed production
   public environment values.
2. Open Xcode with `npm run mobile:ios`.
3. Confirm Apple Team, bundle ID, signing, marketing version and monotonically
   increasing build number.
4. Select an eligible generic iOS device destination and use
   **Product → Archive**.
5. In Organizer, validate the archive.
6. Only after explicit approval, use **Distribute App** to upload that specific
   archive to App Store Connect.
7. Wait for processing, then—after separate explicit approval—assign the build
   to the intended TestFlight internal group.
8. Repeat the two-device matrix on the TestFlight build.

No credential, certificate, profile, issuer ID, key ID, private key, privacy URL
or support URL should be invented or committed. See
[`docs/APP_STORE_RELEASE_GUIDE.md`](docs/APP_STORE_RELEASE_GUIDE.md) and
[`docs/APP_STORE_METADATA_TEMPLATE.md`](docs/APP_STORE_METADATA_TEMPLATE.md).
Test evidence should use
[`docs/IOS_RELEASE_CHECKLIST.md`](docs/IOS_RELEASE_CHECKLIST.md).

### Production approval gates

- **Gate A — archive:** no production archive/distribution action until the
  release commit, environment, version/build, signing target, licenses, privacy
  inventory, support/privacy URLs and physical-device results are reviewed.
- **Gate B — upload:** no App Store Connect upload until the user approves the
  exact Xcode archive version/build and target app.
- **Gate C — TestFlight:** no tester/group assignment until the user approves
  the processed build.
- **Gate D — review:** no App Review submission until metadata, content rights,
  App Privacy answers and TestFlight results are approved.
- **Gate E — release:** automatic release stays off; App Store release requires
  a final explicit approval after Apple review.

The Transfermarkt-derived Kaggle dataset is a release blocker: public download
does not itself prove redistribution rights. **Do not release** without written
permission covering distribution or a fully substituted, documented
open-licensed source. Club visuals remain generated and artwork-free.

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
