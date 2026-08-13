# Club strength release artifacts

Pundit's current `clubelo@1` champion is selected by `production.json`. The
selector pins an immutable `<payloadSha256>.json` artifact. Runtime code reads
and validates those local files only; it never contacts ClubElo.

Build a reviewed release artifact from a captured ClubElo snapshot:

```bash
pnpm --filter @sports-predict/api build:club-strength-artifact \
  /path/to/club-ratings.json data/model-artifacts/clubelo/production.json
pnpm --filter @sports-predict/api verify:club-strength-artifact \
  data/model-artifacts/clubelo/production.json
```

The builder never overwrites an existing content-addressed artifact. Commit the
new immutable artifact and selector together. CI validates hash, identity,
minimum coverage, a defensive 500–3,000 Elo plausibility range, the declared
profile counts/unique-club manifest, explicit provider/retrieval/rights
provenance, and the 30-day freshness gate. An expired, corrupt, or materially
incomplete artifact therefore blocks a release instead of quietly changing or
fabricating ratings.

`golden-cutover-v1.json` permanently pins the ratings and every public 1X2,
totals, BTTS and top-score field for the 18 fixtures priced immediately before
the runtime-artifact cutover. Artifact verification reconstructs those outputs
and fails any mutation; later artifacts may add fixture coverage but cannot
rewrite this baseline.

The selected snapshot was produced from ClubElo calculations. ClubElo's About
page permits reuse with citation: <https://clubelo.com/About>. That statement is
not a formal API SLA or detailed software/data licence. Preserve this citation
and seek explicit permission before broader redistribution beyond the release
artifact needed to operate Pundit.
