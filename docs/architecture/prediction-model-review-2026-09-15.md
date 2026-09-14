# Prediction-model review — 2026-09-15 SGT

The production champion should remain unchanged. This review completes the baseline audit, evaluator corrections, champion calibration, historical challenger retraining/evaluation, and a separate update using the latest official PL results. No model was promoted or deployed.

**Supersedes the performance conclusions in the September 14 handoff.** The earlier challenger evaluation reused parameters fitted on the entire corpus for every holdout. Its reported Brier wins were contaminated by future results. The previous first-origin “calibration failure” was also an absolute-error metric mislabeled as calibration. Those results cannot support promotion.

## Verified production baseline

Read-only public API and web observations on September 14 UTC / September 15 SGT:

- Railway API and Vercel web both report `4bdb834afdc62e495a64c1dcbaa49aa13f25357f`. Railway deployment ID: `d236e3a5-1082-48f9-b03b-007d1491166a`.
- `/ready` reports ready; 11 active fixtures. All inspected active forecast rows have Fundamental version `2`, with shipped constants **1.35 / 42 / −0.1**.
- Rating artifact `clubelo@1:1da9aa9560446a56edb2b78c26b5d35d79937034f498fa4a1b055ca009e2b696`, snapshot September 13, age one day, refresh not due. The post-weekend pin is already fresh; no replacement was necessary.
- Initial production ledger export: 61 rows, of which 53 are completed official scheduled-window seals (39 PL, 14 UCL qualifying). Eight legacy rows excluded. All 53 carry version `1`; numerical mapping classification finds 43 geometric and 10 fixed-total rows. Do not describe recomputations as forecasts actually published under version `2`.
- The local runtime still calls `ELO_CHAMPION.forecast`. One MLE challenger remains registered, with its public forecast/sample methods throwing. Neither constants nor registration changed.
- **First version-2 seal verified:** Leeds–Newcastle (`401879280`) was sealed at **2026-09-14T17:31:15.102Z**, before its 19:00 UTC kickoff, with `pre-kickoff-90m-v1` / `scheduled_window`, complete provenance, and unchanged 1.35 / 42 / −0.1 inputs. Final export has 62 rows: 54 official seals (40 PL, 14 UCL qualifying), eight legacy rows. Only 53 official rows have results (39 PL, 14 UCL). The new pending seal must not increase calibration n.

Public evidence: `/ready`, `/api/model/active`, `/api/evaluation/club-season` at `https://thepundit.up.railway.app`, and `https://thepundit.vercel.app/api/version`. Saved copies are in the ignored research directories below.

## Evaluator corrections

### Champion calibration (report schema 2)

- Full-sample fits remain descriptive. Production recommendations additionally require chronological PL validation.
- Expanding weekly folds fit only earlier matches, with a conservative 24-hour lag from kickoff to presumed result availability. The ledger does not record historical result-availability timestamps; this is a replay assumption, not proof of real-time availability.
- Minimum 20 training matches per fold; at least 40 held-out PL matches for a recommendation. Paired bootstrap uses fixed held-out Brier losses, grouped by UTC week, with 2,000 draws by default. The recommendation gate requires at least 1,000 draws and five observed weeks. These are minimum research safeguards, not statistical guarantees.
- Missing uncertainty cannot pass. Documented sample data cannot support a production change. An explicit CLI ledger never silently falls back to sample data.
- Calibration restricts the shared official-provenance gate to `pre-kickoff-90m-v1` / `scheduled_window`; cached fallback checkpoints are excluded from this policy-specific research cohort.
- Existing minimum Brier improvement of more than 0.005 is retained. Zero-HFA fits remain blocked. AIC support for optional mismatch inflation is required.
- Output remains research-only, with `productionAutoLoad: false`. Passing the replay would validate the fitting procedure, not automatically certify the final full-sample constants prospectively.

### Challenger evaluation (report schema 2)

- Each origin now refits attack/defence using only that origin's training rows. Full-corpus fitted parameters, club membership and outcome-derived priors cannot enter a holdout fit.
- Dates, duplicate IDs/origins, overlapping or incomplete split manifests, prior timing, result lag, nonconvergence and invalid score grids fail closed. The on-disk evaluator checks corpus eligibility and its declared hashes against the training artifact, and saves blocked reports so a prior success cannot remain the apparent latest result.
- The legacy `calibrationMae` is explicitly described as per-result absolute error. Fixed-bin pooled one-vs-rest reliability ECE is added; the legacy check is retained alongside the new reliability check to avoid relaxing the promotion gate to rescue this model.
- Totals Brier, BTTS Brier, scoreline log-loss and paired weekly Brier uncertainty are reported. Totals/BTTS diagnostics are not newly tuned promotion thresholds.
- Overlapping holdouts are explicitly counted: 1,146 attempted pairs, 930 scored pairs, **572 unique holdout fixtures**. Do not present 1,146 as independent matches.

### Trainer false convergence

The separate 799-row weekend update exposed an invalid initial likelihood being returned as zero-iteration convergence: the invalid objective produced a zero gradient, and the optimizer checked that gradient before checking whether the likelihood was finite. The trainer now rejects invalid objectives/gradients and, when the initial low-score correction is inadmissible, starts from independent Poisson before optimizing. Previously valid initializations remain unchanged.

## Champion result: retain the shipped constants

The full-sample research fit remains **1.40 / 0 / −0.115**, without mismatch inflation.

| Comparison | n | Shipped Brier | Fitted Brier | Interpretation |
|---|---:|---:|---:|---|
| All official rows, recomputed | 53 | 0.6680 | 0.6660 | In-sample; below the 0.005 improvement threshold |
| PL only, recomputed | 39 | 0.6855 | 0.6698 | In-sample; not validation |
| Chronological PL holdout | 9 | 0.7777 | 0.7932 | Fitted procedure is worse on this small holdout |

Only one held-out UTC week exists. Its block-bootstrap interval is degenerate and cannot support inference; the five-week gate blocks it. Held-out log-loss also worsens, 1.2471 → 1.2698. The fold trained on 28 earlier PL results estimated HFA **41**, whereas fitting all 39 produces zero: strong evidence of instability in this small sample, not evidence that home advantage has disappeared.

Market comparison has 52 paired observations: shipped recomputed Brier 0.6746 versus market 0.6213. Market observations are the latest available per source, not necessarily contemporaneous with the model seal; this is descriptive, not proof of a tradeable edge or a matched-horizon comparison. Consensus remains separately labelled.

## Challenger result: do not promote

Historical retraining on the unchanged 760-row corpus reproduces the registered `4cfcbe5783d73380b927d25f4c2b206b3930df6df93f669f97503142d718d81d` artifact. The corrected evaluation gives:

| Training origin | Train n | Scored / holdout | Champion Brier | MLE Brier | ΔBrier 10–90% weekly interval |
|---|---:|---:|---:|---:|---|
| 2025-01-01 | 188 | 464 / 572 | 0.609407 | 0.626523 | +0.00370 to +0.03085 |
| 2025-08-01 | 380 | 272 / 380 | 0.627862 | 0.629524 | −0.01624 to +0.01848 |
| 2026-01-01 | 566 | 194 / 194 | 0.684014 | 0.661221 | −0.03576 to −0.00852 |

All three fits converge. The first two have 108 uncovered fixtures each because newly appearing clubs have no fitted parameters. Their metrics use only common covered fixtures; exclusions are material and block promotion. In the third period, MLE improves 1X2 Brier/log-loss and reliability, but legacy outcome MAE worsens and Over 2.5 Brier deteriorates **0.249581 → 0.267131**. BTTS improves slightly, 0.252104 → 0.249120, while scoreline log-loss is almost unchanged.

The historical rating corpus contains increasingly stale last-known windows in 2026. Its actual dataset SHA matches the manifest, and each joined row is dated before kickoff, but freshness is still a limitation. These fixed-origin evaluations freeze MLE until the end of each holdout while the champion receives fixture-date ratings. They are not evidence about a yet-unimplemented weekly MLE retraining service. No hyperparameter search or threshold relaxation was used to obtain these results.

## Latest-results research update

A separate ignored research script appends 39 official PL ledger results through September 13 to the 760 historical rows. It records the exact 799 input rows and their hash. This is an official-ledger subset, **not a claim of complete current-season corpus coverage**. It does not replace the registered artifact or its latest pointer.

The separate current-season replay trains on the earlier 760 matches only, then tests the 39 additions: 32 covered, seven uncovered. On covered fixtures, Brier improves **0.648530 → 0.634915**, totals Brier **0.249643 → 0.233672**, BTTS Brier **0.256089 → 0.244306**, and scoreline log-loss **2.994056 → 2.903814**. Legacy outcome MAE worsens. There are only four observed UTC weeks and one origin, so the small sample and missing coverage prohibit promotion regardless of the favourable Brier interval.

After correcting false convergence, the new 799-row fit genuinely converges in 153 iterations with finite penalized log-likelihood −217.973484. It is saved separately for research. Its training diagnostics are recorded in `weekend-research.json`; never score this fit on the same 39 additions and call that a holdout.

## Decision and concrete remaining model work

**Release the evaluator/trainer corrections for review; retain Fundamental and its constants. Do not promote the MLE artifact.** No production change is justified by these experiments.

The next substantive model work is now specific:

1. Implement and test a dated ClubElo prior-only initialization for clubs with zero training matches. Current prior regularization helps low-sample clubs already in the fit; it does not cover unseen clubs at forecast time. Keep identity and coverage gates explicit.
2. Evaluate a predefined weekly expanding-window retraining cadence. Train on results actually available before each forecast week; keep all candidate tuning inside earlier training windows. Compare both models on the same complete fixture set and report uncovered rows.
3. Improve the freshness of historical ratings where a documented dated source is available. Do not replace historical inputs with today's pin.
4. Collect additional naturally sealed completed forecasts. Forty total PL seals is no longer confused with forty held-out forecasts. Freeze any selected research candidate before prospective validation.
5. Set any revised multi-market promotion criteria before a new selection experiment. Changing the legacy MAE criterion is a separate methodological decision, not a way to turn today's FAIL into PASS.

Davidson, Negative Binomial/Sarmanov, lineup features and further market blending remain deferred. Production promotion still requires an explicit human decision after valid evidence supports it.

## Validation and release state

- Final full API Vitest run: **54 files, 991 tests passed**.
- API build and TypeScript checks passed; club-strength artifact verification passed with **18 unchanged golden fixtures**.
- New regressions cover held-out outcome isolation, ignoring full-corpus fitted parameters, invalid/incomplete/overlapping splits, missing uncertainty, paired resampling, scheduled-window policy, reliability versus outcome MAE, and false optimizer convergence.
- At completion of the research review, changes were local and uncommitted. A subsequent release is tracked through Git history and the deployment record. Pre-existing unrelated working-tree edits were preserved. No production configuration, live ledger, model constants, artifact registration, or frontend was changed. No paid chat evaluation was run because there was no deployment or chat change.

## Reproduction and evidence

From the repository root:

```bash
pnpm --filter @sports-predict/api calibrate:champion -- packages/api/data/research/champion-calibration/ledgers/production-2026-09-15.json --out-dir packages/api/data/research/champion-calibration/reports/2026-09-15 --bootstrap 2000
pnpm --filter @sports-predict/api train:dixon-coles-mle -- --force
pnpm --filter @sports-predict/api eval:dixon-coles-mle
pnpm --filter @sports-predict/api exec ts-node --transpile-only data/research/champion-calibration/reports/2026-09-15/weekend-research.ts
```

Local ignored evidence:

- `packages/api/data/research/champion-calibration/ledgers/production-2026-09-15.json` (completed-results research input) and `production-2026-09-15-final.json` (first version-2 seal receipt)
- `packages/api/data/research/champion-calibration/reports/baseline-2026-09-15/` (original invalid challenger report plus production observations)
- `packages/api/data/research/champion-calibration/reports/2026-09-15/` (corrected calibration, latest-results inputs/fit/replay and its one-off reproduction script)
- `packages/api/data/research/dixon-coles-mle/eval-report.json` (corrected historical evaluation)

Historical fixture dataset SHA: `00f7065a80a5de7c0f4de6c89c7f7b27c11f863205acbb986ee9deb6bef7898a`. Historical rating dataset SHA: `e84084c5652d895c1ee51825d4d2df62588d83456b96574c8db64f6f4e51c9d0`. Both file hashes were independently recomputed and matched.
