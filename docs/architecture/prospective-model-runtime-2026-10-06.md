# Runtime prospective comparison

The public champion and its fixed 2.70 total-goals assumption remain unchanged.
The exposed development candidate lost on over-2.5 proper scores. Runtime capture
does not approve or imply its promotion.

The earlier tool required a person to run it during each final 90-minute window.
No schedule was installed, so unseen model evidence could never accumulate
without manual intervention. This release adds a private collector after normal
cache bootstrap. It reads existing model, authoritative registry and ESPN caches
every five minutes, without network requests, answer-provider calls or a public
model write. `PROSPECTIVE_MODEL_CAPTURE=false` disables it. A missing, malformed
or changed-source manifest makes capture inactive and exposes the error on
`/ready.prospectiveModel`; it does not take down public forecasts.

The content-addressed candidate under `data/model-artifacts/prospective` retains
the existing 809-row fitted parameters and training provenance. It binds the
capture source bytes. A new freeze creates a separate cohort, never reuses prior
candidate observations, and never turns exposed development into blind evidence.
The first post-deploy collector activation creates an exclusive durable cohort
record. Evidence lives below `PUNDIT_DATA_DIR/prospective-model/<candidate hash>`
(`/data` in production), separately from the existing official forecast ledger.

The first observed checkpoint wins, including unavailable public models, unknown
venues and candidate failures. Exact content-addressed strength inputs, canonical
fixture identity and recomputed public champion probabilities must agree. The
collector records scheduled fixtures seen outside the checkpoint window and
preserves an explicit miss if no forecast was sealed by kickoff. A process-local
largest polling gap helps diagnose interruptions; it is not a complete uptime
record or a promise of complete schedule coverage. Fixtures first discovered
after kickoff cannot be sealed or treated as a prospective forecast.

Only seals created after cohort activation and before kickoff can acquire
results. Fresh, current, strictly complete season-schedule results supplement the
short rolling result cache, allowing outcomes to be recovered after downtime.
Conflicting completed cache identities or scores fail closed. Results retain
actual observation time. Stable scores are deduplicated through an atomic
successor claim keyed by the preceding observation digest across rolling-deploy
instances. A score returning from A to B to A acquires a new transition after B;
it is never suppressed merely because A appeared earlier. An interrupted claim
publication recovers its exact result. Later score corrections remain separate
immutable observations. Cyclic, orphan, conflicting or retrodated transitions
and corrupt cohort, seal, result, claim, seen or missed records fail
closed. Rescheduled sealed identities also stop capture for review. Nothing is
silently rewritten or retrospectively backfilled.

This cohort ends at 2027-07-01 UTC. Storage is bounded at 1,000 fixtures and
4,000 result observations; exceeding a bound stops collection visibly. Snapshot
validity and failures remain in the private evidence rather than being dropped
to improve accuracy denominators. `/ready` exposes the candidate hash, activation,
attempt/success times, counts, error and unchanged public/promotion flags. Zero
seals or results is collection progress, never a calibration result.

The observed live PL slate on 2026-10-06 Singapore time first kicks off at
2026-10-10 11:30 UTC (Arsenal–Leeds); its first eligible checkpoint begins at
10:00 UTC. Current future outcomes therefore cannot be available during this
repair. Earlier seasons can expand chronological development, but a candidate
trained on 2024–26 cannot be validated against older outcomes without temporal
leakage; old exposed holdouts cannot be re-labelled untouched. Any later
promotion must retain the existing chronological, multi-market, sample-size,
calibration, uncertainty and reviewed-release gates. A future result is not a
guaranteed improvement, and collecting it does not waive the candidate's known
totals weakness.

Focused collector/seal/CLI tests exercise pre-kickoff capture, restart, withheld
and missed observations, completed-result recovery/corrections, no backfill,
source drift, invalid timing, rescheduling and stored corruption. Real fixture
timing evidence and double-run logs are preserved under the ignored directory
`artifacts/model-qa/prospective-runtime-2026-10-06`. Synthetic test results are
explicitly test evidence, not observations of live future games.

## Private evaluation

The read-only CLI closes the collection-to-review path:

```sh
pnpm --filter @sports-predict/api exec ts-node --transpile-only scripts/evaluate-prospective-model.ts \
  --candidate data/model-artifacts/prospective/<selected-sha>.json \
  --cohort /data/prospective-model/<selected-sha>
```

It verifies source bindings, cohort dates, immutable file identities, embedded
rating inputs and both grids. Candidate forecasts are recomputed from the exact
frozen parameters; an arbitrary valid probability grid cannot be substituted.
It reports 1X2 Brier/log loss, over-2.5 Brier/log loss, BTTS Brier/log loss and
exact-score log loss, fixed five-bin reliability and paired UTC-week uncertainty.
The existing 2,000-draw bootstrap has an 80% empirical p10–p90 interval, not a
95% confidence interval. Exact-score probabilities outside the 0–10 grid use
the declared 1e-15 log floor and are counted separately.

Results use the latest verified correction observed at or before the requested
`--as-of` cutoff. Forecasts are never rewritten or refitted. Same-time conflicting
corrections reject. Failed, missed and pending forecasts remain in coverage
counts. Fewer than 40 paired completed fixtures or five UTC weeks explicitly
returns `INSUFFICIENT_EVIDENCE`; a populated report returns `REVIEW_REQUIRED`,
never promotion approval. Totals no-inferiority requires both proper totals
losses and their p90 deltas to be nonpositive after the minimum sample floor.
The existing two-origin, calibration and release gates remain separate and
cannot be waived by this report. Synthetic end-to-end tests verify loss formulas,
cutoffs, corrections, zero-observation output and rejection of substituted grids.
