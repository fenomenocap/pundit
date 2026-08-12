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
content-addressed outputs before any training decision. Even if the Premier
League counts reproduce, paired champion evaluation still requires
chronological ClubElo inputs as they stood before each fixture; those have not
yet been acquired. No challenger is registered or activated.
