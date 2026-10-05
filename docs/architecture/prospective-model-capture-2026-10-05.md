# Private prospective model capture

This manual research tool compares a frozen candidate with the current public
champion. It does not change the public forecast, register a model, start a
collector or authorize promotion. The earlier `33713e00...` freeze is preserved
as superseded evidence; its source hashes intentionally fail against the repaired
collector and it must not be used for this cohort. The exposed development candidate still has
worse over-2.5 scores; see `fixture-totals-development-results-2026-10-05.md`.

The reviewed candidate manifest is
`artifacts/model-qa/fixture-totals-2026-10-05T13-18-25-578Z/prospective-b2c3029b93481c4d7b06e3d2ce9d68beceb48a763cc55db473e0f1fa69c65e68.json`.
Its filename suffix is its SHA256. It binds the exact fitted parameters and
809-row training hash from artifact `f11b3794...`, the original replay sources,
and all seven required sources that contributes to the capture forecast. It froze at
2026-10-05T13:50:33.810Z, after the actual training-result availability at
2026-10-05T13:18:25.578Z. The last training kickoff is 2026-09-20T15:30Z; this
earlier date is not substituted for actual result availability.

Artifacts are ignored local evidence, not bundled into public deployment.
Preserve the full candidate, training rows, data bindings, replay and capture
directories together. A changed bound source requires a new candidate freeze
and a separate cohort; it cannot reuse the previous candidate's evidence.

With Node 22 and locked dependencies installed, run from the repository root:

```sh
pnpm --filter @sports-predict/api exec tsx scripts/capture-prospective-model.ts \
  --candidate ../../artifacts/model-qa/fixture-totals-2026-10-05T13-18-25-578Z/prospective-b2c3029b93481c4d7b06e3d2ce9d68beceb48a763cc55db473e0f1fa69c65e68.json \
  --out ../../artifacts/model-qa/prospective-b2c3029b
```

This is a dry run: three bounded public GETs, no forecast writes. Add `--capture`
to preserve private evidence. Run within each fixture's final 90 minutes before
kickoff, and again after completed results appear but before the seven-day
recent-result cache expires. No prospective observations are backfilled from
earlier outcomes, and no automatic collection schedule is installed.

Every observed Premier League checkpoint attempt is retained, including missing
public model rows, unknown neutral venues, identity conflicts and invalid
candidate forecasts. The exact registry event, team orientation, kickoff,
champion provenance and finite published probabilities must agree. Exact
ratings are recovered from the local SHA-named artifact and must match the
public one-decimal serialization. Missing or malformed artifacts remain failed
attempts. Successful seals embed the verified artifact, so later integrity checks
remain possible after the local runtime pin retires. Recovered values, artifact
identity and recomputed champion grids are checked again on stored reads. Stored
forecasts use atomic exclusive publication and never overwrite the first
checkpoint observation. Results are separate immutable observations bound to
the original seal bytes. Corrupt, renamed or changed-source evidence fails
closed, including an old seal whose result has left the recent cache.

These guarantees apply to the manual observed cohort. They do not prove complete
fixture collection or prevent a filesystem owner from editing local files.
Zero checkpoint rows means no observations were collected; it is not an
accuracy result. Predictive calibration and promotion require unseen outcomes,
all-market scoring, adequate coverage and uncertainty, and a separate reviewed
decision under the existing model acceptance gates.
