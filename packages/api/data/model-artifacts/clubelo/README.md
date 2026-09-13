# Club strength release artifacts

Pundit's current `clubelo@1` champion is selected by `production.json`. The
selector pins an immutable `<payloadSha256>.json` artifact. Runtime code reads
and validates those local files only; it never contacts ClubElo.

Refresh after each Premier League weekend (Sunday night / Monday) and after
UEFA Champions League midweeks that sit in the active 14-day window. Target
age is **7 days**. The 30-day gate still fails closed. Runtime never fetches.

```bash
pnpm --filter @sports-predict/api refresh:clubelo-snapshot
```

That is capture → build → verify. The same steps remain available separately:

```bash
pnpm --filter @sports-predict/api capture:clubelo-snapshot \
  data/model-artifacts/clubelo/.capture/club-ratings.json
pnpm --filter @sports-predict/api build:club-strength-artifact \
  data/model-artifacts/clubelo/.capture/club-ratings.json \
  data/model-artifacts/clubelo/production.json
pnpm --filter @sports-predict/api verify:club-strength-artifact \
  data/model-artifacts/clubelo/production.json
pnpm --filter @sports-predict/api check:club-strength-freshness
```

Before merge: ranking date should be within two days of capture, ENG/UEFA
coverage should not drop vs the previous pin, and a few active-fixture Elos
should keep a sensible order. Commit the new immutable artifact and selector
together, then deploy. `/ready` reports `ratingsRefreshDue` once age is 7
days; forecasts continue until day 30. A Monday GitHub Action fails if the
committed pin is 7 or more days old so an ageing snapshot cannot stay silent.

The capture prefers ClubElo's documented CSV API and falls back to the
published ranking page when that API is unavailable. Neither path is imported
by runtime model code. The builder never overwrites an existing
content-addressed artifact. Commit the new immutable artifact and selector
together. CI validates hash, identity, minimum coverage, a defensive 500–3,000
Elo plausibility range, the declared profile counts/unique-club manifest,
explicit provider/retrieval/rights provenance, and the 30-day freshness gate.
An expired, corrupt, or materially incomplete artifact therefore blocks a
release instead of quietly changing or fabricating ratings.

`golden-cutover-v1.json` permanently pins the Elo inputs and every public 1X2,
totals, BTTS and top-score field for the 18 fixtures priced immediately before
the runtime-artifact cutover. Verification reconstructs those outputs from the
frozen cutover artifact
`2da1616b28750ddbba93bb107ee4f1c5b450ef6fe1c92bda6914b6e3fb8ba6cf.json` and
fails any mapping mutation. A later reviewed freshness refresh may point
`production.json` at a new snapshot; it must not rewrite that cutover artifact
or the mapping baseline.

The selected snapshot was produced from ClubElo calculations. ClubElo's About
page permits reuse with citation: <https://clubelo.com/About>. That statement is
not a formal API SLA or detailed software/data licence. Preserve this citation
and seek explicit permission before broader redistribution beyond the release
artifact needed to operate Pundit.
