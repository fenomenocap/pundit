# Club history research corpus

This directory contains the offline-only, content-addressed corpus contract.
Generated raw snapshots, datasets, and manifests are not loaded by production
routes, readiness, chat, or the active model.

Build command:

```bash
pnpm --filter @sports-predict/api build:club-history
```

`latest.json` points to a dated build manifest. Each manifest records retrieval
times, source URLs, SHA-256 hashes, validation results and the normalized dataset
hash. Raw ESPN responses are stored as content-addressed gzip files; rerunning
the builder never replaces a different raw response at the same path.

## Prior read-only audit — 2026-08-10

- Premier League 2024–25: **PASS**, 380/380 completed regulation-time fixtures,
  20 teams, 38 fixtures per team, complete home/away pairings.
- Premier League 2025–26: **PASS**, 380/380 completed regulation-time fixtures,
  20 teams, 38 fixtures per team, complete home/away pairings.
- UCL qualifying 2024–25: **INCONCLUSIVE**, 90 structurally valid fixtures; six
  AET/penalty finals excluded because the displayed final score is not a
  guaranteed 90-minute target, and no independent expected-count manifest is
  encoded.
- UCL qualifying 2025–26: **INCONCLUSIVE**, 92 structurally valid fixtures with
  the same six non-regulation exclusions and expected-count gap.

ESPN's response-level league metadata currently labels historical queries as
2026–27. The corpus therefore validates and uses each event's own season year,
while retaining the misleading top-level field in the immutable raw snapshot.

Those observations came from the protected prior worktree and are not current
certification evidence for this checkout. Run the builder and preserve its
content-addressed outputs before any training decision. Generated raw ESPN
responses, datasets, manifests, and `latest.json` are gitignored — do not
commit huge dumps. The builder never replaces a different raw response at the
same content-addressed path.

Even if the Premier League counts reproduce, paired champion evaluation still
requires chronological ClubElo inputs as they stood before each fixture. That
is a separate offline pipeline. Dated snapshots and per-club From/To series
are both incomplete as of 2026-09-09 — do not invent Elo from results. See
`../clubelo-history/README.md` and `../clubelo-club-history/README.md`.

Runtime never contacts ClubElo. UCL stays out of promotion until
expected-count and regulation-time scores exist
(`eligibleForCrossCompetitionPromotion` remains false while qualifying seasons
are `inconclusive`). No challenger is registered or activated.

## Local rebuild — 2026-09-09

`pnpm --filter @sports-predict/api build:club-history` reproduced the 2026-08-10
counts on this checkout. Outputs are gitignored (raw dumps, dataset, manifest,
`latest.json`).

| Season | Status | Fixtures | Training-eligible |
|---|---|---|---|
| Premier League 2024–25 | **PASS** | 380 | 380 |
| Premier League 2025–26 | **PASS** | 380 | 380 |
| UCL qualifying 2024–25 | **INCONCLUSIVE** | 90 | 84 |
| UCL qualifying 2025–26 | **INCONCLUSIVE** | 92 | 86 |

- Dataset SHA-256: `00f7065a80a5de7c0f4de6c89c7f7b27c11f863205acbb986ee9deb6bef7898a`
- Corpus status: `inconclusive` because UCL stays structural-only
- `eligibleForOfflineTraining`: true (Premier League only)
- `eligibleForCrossCompetitionPromotion`: false
- ESPN top-level season metadata still reports 2026–27; event-level years are used
- Chronological ClubElo inputs were still incomplete after this rebuild (tonyelhabr dump ends 2026-01-14; see `../clubelo-history/README.md`)
