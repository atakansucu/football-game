# Licensing-safe team visual policy

Football Duel uses a deliberately artwork-free visual system for teams.

## Rendering rules

- National teams use emoji flags supplied by the operating system when a
  country mapping exists. Unknown teams use a generic globe.
- Clubs use a locally generated badge made from a 2–3 character label, a
  generic shield shape and deterministic colors selected from a curated palette.
- The generated badge is a non-official placeholder. It must not copy the
  geometry, color layout, typography, symbols or other distinctive elements of
  an official club crest.
- Club names are the only input. Rendering must not make network requests or
  read logo/image URL fields.
- Scraped crests, kit artwork, sponsor marks and unverified image datasets are
  not accepted. New artwork requires documented rights and release review.

The implementation lives in `src/lib/teamBadge.ts` and
`src/components/TeamBadge.tsx`. The same component is used in challenges,
selectors and player lookup so iPhone screens remain consistent.

## Supporting metadata research

Checked 12 October 2026. These sources may be candidates for factual supporting
metadata, not visual assets:

- [OpenFootball clubs](https://github.com/openfootball/clubs) publishes its
  club/stadium dataset under CC0. It can be evaluated for names, aliases,
  countries or stable matching keys. Coverage, freshness and entity matching
  still need validation before import.
- [Wikidata structured data](https://www.wikidata.org/wiki/Wikidata:Licensing)
  in its data namespaces is published under CC0. Attribution is encouraged by
  [Wikidata data access guidance](https://www.wikidata.org/wiki/Wikidata:Data_access)
  even though CC0 does not require it.

CC0 metadata does not make linked images, official crests, sponsor marks or
third-party URLs safe to redistribute. Any importer must whitelist factual
fields, preserve source/provenance, pin a reproducible snapshot and exclude
image properties. Club names and identifiers can also raise trademark or data
quality questions independent of copyright, so source adoption remains a
separate review.

No production dataset is changed by this policy.
