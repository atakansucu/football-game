# Expanded Transfermarkt research pipeline

This pipeline builds a local research dataset from the Kaggle
`davidcariboo/player-scores` export. It does not connect to Supabase. Importing
the generated JSON remains a separate, explicitly approved operation.

## Evidence policy

An official senior appearance is accepted from:

1. `appearances.csv`, joined to `games.csv`;
2. `game_lineups.csv` rows whose type is exactly `starting_lineup`;
3. unambiguous on-field `game_events.csv` evidence:
   - goals and named assists;
   - players substituted in or out;
   - penalty-shootout takers.

The following are not accepted as standalone appearance evidence:

- bench or unused-substitute lineup rows;
- cards, because Transfermarkt can record cards shown to unused substitutes or
  staff;
- own-goal rows when the event alone does not safely identify the player's
  team;
- events whose game/team reference cannot be resolved;
- transfers, valuations, current-club fields, squad membership or youth-team
  history.

Competition type comes from `games.csv` and `competitions.csv`, with national
team IDs used only as a fallback when both type fields are absent. Club and
national-team names are resolved from the referenced game's home/away team
metadata, then checked against the appropriate team table.

Profile-based national-team membership always requires
`international_caps >= 1`. A confirmed national-team appearance, start or
qualifying event is independent direct evidence and can recover incomplete
profile cap fields.

## Commands

```bash
# Generate research JSON and a metrics sidecar.
npm run data:transfermarkt -- \
  /path/to/kaggle-v677 \
  /tmp/dataset.transfermarkt.research.json \
  /tmp/dataset.transfermarkt.research.stats.json

# Validate structure, eligibility and challenge/answer counts.
npm run data:transfermarkt:validate -- \
  /tmp/dataset.transfermarkt.research.json \
  scripts/data-import/baselines/transfermarkt-v677.json

# Audit identities present in lineups/events but absent from players.csv.
npm run data:transfermarkt:audit-identities -- \
  /path/to/kaggle-v677 \
  /tmp/external-identities.json
```

Do not pass the research JSON to `importFootballData.ts` without explicit
approval and a separate release review.

The isolated database results, gameplay tests, performance measurements and
data-quality sample are documented in
[`TRANSFERMARKT_LOCAL_VALIDATION.md`](TRANSFERMARKT_LOCAL_VALIDATION.md).

## Validated Kaggle v677 baseline

The source snapshot is Kaggle version 677, published 5 August 2026. The
conservative pipeline produced a 7,281,272-byte research JSON with SHA-256
`8c113f6dcec5b012d83aaac6303edf205ac60aca87f5fbc0a1e146d71fc7032f`.
All 30,325 emitted players have a unique retained `sourceId`.

| Metric | Current dataset | Original analysis maximum | Implemented baseline |
|---|---:|---:|---:|
| Usable players | 16,847 | 30,741 | **30,325** |
| Club × Club eligible players | 13,299 | 26,320 | **25,702** |
| National Team × Club eligible players | 8,476 | 13,987 | **13,882** |
| Clubs | 545 | 2,360 | **2,308** |
| National teams | 104 | 139 | **138** |
| Club × Club challenges | 24,537 | 83,560 | **76,521** |
| National Team × Club challenges | 7,470 | 15,490 | **14,518** |
| Club × Club answers | 53,821 | 175,375 | **150,465** |
| National Team × Club answers | 19,749 | 41,718 | **38,326** |

Net change from the current dataset is +13,478 players, +51,984 Club × Club
challenges, +7,048 National Team × Club challenges, +96,644 Club × Club answers
and +18,577 National Team × Club answers.

The implemented player baseline is 416 below the original 30,741 research
maximum. The original analysis treated every event participant field as proof.
The implementation deliberately rejects all 381,753 card rows and 6,729
ambiguous/unsupported event rows, including ambiguous own goals. This stricter
policy also removes 618 Club × Club candidates and 105 National Team × Club
candidates relative to the analysis maximum.

## Profile-external identities

The earlier broad event analysis found 19,606 potentially eligible IDs outside
`players.csv`. Applying the production-quality conservative event policy finds:

| Metric | Count |
|---|---:|
| External IDs with official evidence | 59,597 |
| Club × Club eligible | 18,796 |
| National Team × Club eligible | 147 |
| Eligible union | **18,890** |
| Eligible IDs with a lineup name | 18,866 |
| Eligible IDs without a name | 24 |
| Eligible IDs with multiple names | 209 |

These identities are audit-only and are not emitted into the normalized
dataset. They require profile enrichment, name reconciliation and duplicate
review before they can be considered for import.

## Remaining data-quality risks

- Appearance coverage is uneven by competition and geography; many recently
  added competitions have games/lineups/events but no `appearances.csv` rows.
- `international_caps`, citizenship and current national-team fields are
  incomplete for historical players.
- Five competition IDs in v677 lack complete competition metadata.
- Team names can change over time; the normalized game schema still merges by
  name at import time.
- Event semantics can change upstream. Unknown event types are ignored rather
  than guessed.
- The source stopped refreshing during 2026 and explicitly has different
  freshness cutoffs per CSV.

## Licensing and release risks

Kaggle labels the snapshot CC0, but that label does not by itself resolve all
rights in the underlying scraped Transfermarkt database, names, trademarks,
club branding, profile images or upstream website terms. The normalized output
contains names but intentionally does not add image assets or valuation data.

Before distribution or production import:

1. confirm that the intended use and redistribution are covered by counsel or
   written source permission;
2. pin the Kaggle version and file hashes in release metadata;
3. review trademark/logo usage separately;
4. retain a removal/correction process for player and team records;
5. rerun the full validation and manually sample newly introduced competitions.
