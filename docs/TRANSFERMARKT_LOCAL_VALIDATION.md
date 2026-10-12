# Expanded Transfermarkt local Supabase validation

Date: 12 October 2026
Branch: `feature/transfermarkt-expanded-pipeline`
Dataset: Kaggle `davidcariboo/player-scores` v677 research baseline
Safety: local Docker/Supabase only; no production connection or deployment.

## Environment

An isolated Supabase project was used:

- project ID: `football-game-transfermarkt-validation`
- API: `http://127.0.0.1:55321`
- Postgres: `127.0.0.1:55322`
- database container: `supabase_db_football-game-transfermarkt-validation`

The branch was created from a commit containing migrations through `0012`.
Current local gameplay validation also requires the still-uncommitted
`0013`–`0018` migrations from the iOS worktree. Those migrations were applied
directly to this isolated database only. They were not copied into this branch
or applied to production.

## Integration and gameplay tests

The five previously skipped, current integration tests were run with
`RUN_SUPABASE_INTEGRATION_TESTS=1` and a localhost-only URL guard.

| Test group | Result |
|---|---:|
| Player Pick: private selection and one-time reveal | pass |
| Player Pick: same-club rejection, reset and valid Club × Club reveal | pass |
| Global player search | pass |
| Random National Team × Club round creation | pass |
| Atomic answer submission and countdown/late-answer behavior | pass |

Result: **5/5 passed**, both before and after importing the expanded dataset.
The post-import answer-submission test completed in approximately 3.4 seconds,
including its intentional 3.3-second countdown wait.

In addition, 100 random selections for each mode/difficulty combination were
checked against their combo row, answer count and rank thresholds. All **600**
samples were valid.

## Import result

The local database contains:

| Relation | Actual |
|---|---:|
| Players | 30,325 |
| Aliases | 28,620 |
| Player–club links | 95,612 |
| Player–national-team links | 13,911 |

The data insertion phase took **6.14 seconds**. PostgreSQL-side
`rebuild_answers()` plus both combo materialized-view refreshes took **2.80
seconds**, for an effective local load/rebuild time of approximately **8.94
seconds**.

The database size after import was **89,912,111 bytes** (85.75 MiB). Largest
relations:

| Relation | Size |
|---|---:|
| `club_club_answers` | 25.21 MiB |
| `player_club_history` | 12.16 MiB |
| `club_club_combos` | 9.81 MiB |
| `players` | 9.77 MiB |
| `country_club_answers` | 7.23 MiB |
| `player_aliases` | 4.16 MiB |

### Importer issues discovered

1. Clearing players in 500-ID PostgREST batches produced `URI too long`.
   `CLEAR_BATCH=100` is now used in this branch.
2. The first REST call to `rebuild_answers()` returned `UPDATE requires a WHERE
   clause`; the same function succeeded as PostgreSQL/service role and produced
   exact counts. This was not reproducible after the manual rebuild and remains
   a clean-environment release blocker.
3. Current challenge selection uses materialized combo views. The importer now
   calls `refresh_solo_combos()` after rebuilding answers.
4. The worktree's local npm cache became partially unreadable during validation.
   This affected CLI startup only, not generated data or PostgreSQL. Dependencies
   should be installed in a non-cloud-synced worktree before the next run.

No production endpoint was contacted.

## Generated metrics versus actual Supabase

| Metric | Generated JSON | Actual DB | Difference |
|---|---:|---:|---:|
| Players | 30,325 | 30,325 | 0 |
| Club × Club eligible players | 25,702 | 25,702 | 0 |
| National Team × Club eligible players | 13,882 | 13,882 | 0 |
| Used clubs | 2,308 | 2,308 | 0 |
| Used national teams | 138 | 138 | 0 |
| Club × Club answers | 150,465 | 150,465 | 0 |
| National Team × Club answers | 38,326 | 38,326 | 0 |
| Club × Club challenges | 76,521 | 76,521 | 0 |
| National Team × Club challenges | 14,518 | 14,518 | 0 |

There is no generated/answer-table discrepancy. The lookup tables contain
2,312 clubs and 140 national teams because the importer intentionally preserves
four seeded clubs and two seeded national-team names referenced by old local
game rows. None is used by the expanded player graph.

## Difficulty pools

These are strict pools satisfying both rank and answer-count thresholds, before
the RPC's fallback behavior:

| Mode | Easy | Medium | Hard |
|---|---:|---:|---:|
| Club × Club | 204 | 912 | 76,521 |
| National Team × Club | 159 | 582 | 14,518 |

Easy requires top-ranked teams and at least five answers; Medium uses the wider
rank tier and at least three answers; Hard includes every playable combo.

Four curated national-team ranks fail to map cleanly to source names. Confirmed
examples are `Czechia` vs `Czech Republic`, `Turkiye` vs `Türkiye`, `South
Korea` vs `Korea, South`, and `Republic of Ireland` vs `Ireland`. Only 38 of the
42 curated national-team names map to used teams. This incorrectly pushes those
teams into Hard and should be fixed with canonical source-ID/name aliases before
release.

## Performance

Database-internal averages:

| Operation | Average |
|---|---:|
| `search_players` (1,000 mixed queries) | 31.16 ms |
| National Team × Club selection, Easy/Medium/Hard | 3.08 / 3.04 / 3.25 ms |
| Club × Club selection, Easy/Medium/Hard | 19.01 / 19.25 / 20.71 ms |

Local REST round-trip measurements, 100 sequential calls each:

| Operation | Average | Median | p95 |
|---|---:|---:|---:|
| Player search | 35.15 ms | 32.52 ms | 55.12 ms |
| National Team × Club Easy | 6.18 ms | 5.67 ms | 10.48 ms |
| National Team × Club Medium | 10.30 ms | 6.80 ms | 25.45 ms |
| National Team × Club Hard | 10.25 ms | 8.53 ms | 21.26 ms |
| Club × Club Easy | 23.23 ms | 21.15 ms | 38.59 ms |
| Club × Club Medium | 23.91 ms | 21.93 ms | 35.98 ms |
| Club × Club Hard | 23.86 ms | 22.97 ms | 29.30 ms |

These local results are acceptable for interactive gameplay. Club × Club
selection remains the relatively expensive path because it randomizes across a
76,521-row pool.

## Representative source audit

Twenty newly added players were sampled:

- 5 appearance-backed;
- 5 starting-lineup-backed;
- 5 event-only;
- 5 direct national-team-evidence players with incomplete profile caps.

For all 20:

- source ID and name matched;
- aliases matched the source `last_name` policy;
- every normalized club and appearance count matched distinct qualifying game
  evidence;
- national-team mappings matched national-team games;
- no duplicate source name occurred inside the sample.

Examples included Miroslav Klose, Roque Santa Cruz, Sebastian Kehl, Tomas
Rosicky, Tamás Hajnal and Roy Carroll. The sample covered 43 club names and the
Czechia, Germany, Paraguay and Croatia national teams. No incorrect senior
appearance was found in the sample.

### Global identity risks

The full database audit found:

| Risk | Count |
|---|---:|
| Exact duplicate player-name groups | 419 |
| Duplicate normalized player-name groups | 438 |
| Duplicate normalized alias groups | 3,213 |
| Aliases colliding with another player's normalized name | 671 |
| Duplicate normalized club-name groups | 0 |
| Duplicate normalized national-team-name groups | 0 |
| Club links with appearances below one | 0 |
| Imported players unable to answer either mode | 0 |

Examples such as `João Pedro` (10 IDs), `Paulinho` (7) and `Serginho` (7)
represent distinct source identities but are ambiguous when users submit names.
Source IDs are preserved in the research JSON but not in the production
`players` table. Challenge-aware answer resolution reduces false positives, but
duplicate-name and alias collisions require dedicated UX/validation tests
before deployment.

Several verified club names are legal or historical forms rather than familiar
display names, for example `Panthessalonikios Athlitikos Omilos
Konstantinoupoliton`, `Società Sportiva Lazio S.p.A.` and `Delfino Pescara
1936`. These are not evidence errors, but they are search/display quality risks.

## Decision

The expanded graph is internally consistent and gameplay-valid in local
Supabase. Actual answer and challenge counts exactly match the generated
dataset.

Production import is **not yet recommended**. Resolve before release:

1. reproduce a clean, one-command importer run through REST, including
   `rebuild_answers()` and combo refresh;
2. integrate/rebase migrations `0013`–`0018` into this branch's eventual base;
3. canonicalize the four known national-team rank/name mismatches;
4. define duplicate-player/alias collision behavior;
5. reinstall and rerun from a non-cloud-synced worktree;
6. complete legal review described in `TRANSFERMARKT_PIPELINE.md`.
