# Fixture-specific totals: development result

The new research candidate produces fixture-specific total goal rates, but it is **not ready for production**. On exposed chronological development rows, it improves 1X2 and BTTS scores while worsening over-2.5 scores. The public champion remains unchanged.

The frozen experiment is `artifacts/model-qa/fixture-totals-2026-10-05T13-18-25-578Z`. Its manifest binds the actual working-tree sources, data, splits and fits. The content-addressed final artifact is `f11b3794dca82a89c9f695e2eb5bfa3c6ab3b6ea1bbbe8686431609268314855.json`; the report SHA256 is `290a57d452936c3cd37347c3e9ad2d8a8f155798ae2d1744dd5a2ad88450f3f0`. Reproduce with Node 22 from the repository root:

```sh
node scripts/research-fixture-totals.mjs --base-source-sha 5c993dd2b7823a3c364c14fd7aad1bc4651f0fe0 --augment-ledger artifacts/model-qa/remaining-fixes/live-ledger.json
```

The base SHA names the parent revision; the manifest's exact source hashes identify the candidate actually evaluated. The command creates a new ignored directory and preserves prior reports. Reproducing the final fit requires the same inspected ledger and content-addressed rating artifacts; no production service or provider is called.

## Numerical validity and coverage

The original candidate run (`fixture-totals-2026-10-05T12-59-16-118Z`) accepted 31 of 69 weekly origins. A mathematically equivalent stable likelihood-increment comparator fixes cancellation in the line search; no objective, split, option grid, gradient threshold or iteration budget changed. The preserved rerun accepts 67 of 69 origins and 710 of 730 holdout fixtures. The 20 withheld forecasts remain in coverage denominators. Baseline fit parameter hashes are unchanged at every origin.

Two early fits stop with an actual line-search failure, at 2024-09-30 and 2024-10-14. Their gradient norms are 0.3092 and 0.1862, far above the fixed 0.000001 convergence threshold. At the first fit, Everton–Man City and Southampton–Man City nearly tie for the active maximum away goal rate (about 4.01147), with a limiting 1–0 correction near 1e-8. At the second, Man City–Wolves and Man City–Southampton nearly tie at a home rate of 4.40516, with a limiting 0–1 correction about 3.56e-7. These pairings were absent from those training sets. This is consistent with nonsmooth active-bound stalls; it does not establish a stationary or globally optimal solution. The candidate withholds these fits rather than relaxing convergence.

Independent Python calculations verify 31,136 accepted-origin/final-fit grids, including every ordered fitted-club pairing, plus 7,810 numerical fields across the 710 accepted holdout answers. Maximum unit-mass error is 2.0e-15 and maximum forecast discrepancy is 8.9e-16. Analytic finite-difference, smooth shared-coordinate tie, invalid unseen-pair, floating-point cancellation, eager train/validation row, and rating provenance controls are covered by 90 focused tests passing twice. Numerical validity does not establish predictive calibration.

## Exposed development comparison

Every origin selects options only from earlier inner validation blocks. The 760 existing joined results are already inspected development data, so these weekly holdouts are not an independent blind reserve. Metrics below compare the same 710 accepted fixtures.

| Proper score (lower is better) | Current champion | Candidate |
| --- | ---: | ---: |
| 1X2 Brier | 0.627787 | 0.618825 |
| 1X2 log loss | 1.044925 | 1.029884 |
| Over 2.5 Brier | 0.249269 | 0.254234 |
| Over 2.5 log loss | 0.691685 | 0.703156 |
| BTTS Brier | 0.257765 | 0.249809 |
| BTTS log loss | 0.710561 | 0.693257 |
| Exact-score log loss | 2.980523 | 2.971862 |

The paired UTC-week 2,000-draw p10–p90 empirical interval for the over-2.5 Brier difference is +0.000245 to +0.010078; for its log loss, +0.001496 to +0.022338. These are 80% empirical intervals, not 95% intervals or new promotion gates. Exact-score log-loss uncertainty crosses zero.

Accepted holdout total rates range from 1.6823 to 5.2095. Variation alone is insufficient: forecasts in the 2.0–2.5 total-rate bucket average 2.3267 expected goals against 2.8226 realized (124 fixtures), while the 3.5–4.0 bucket averages 3.6940 against 2.5000 (34 fixtures). The fixed bins suggest overly dispersed fixture totals on these exposed rows; they are diagnostics, not evidence for selecting a correction after seeing outer results.

## Frozen refreshed fit and remaining work

The final fit uses 809 rows: 760 historical plus 49 verified exposed official Premier League seals through 2026-09-20T15:30:00Z. One same-day rating pin is excluded. One-decimal sealed ratings are verified against their exact public serialization before recovering full precision from the hash-bound source artifact. The recent results refresh parameters only, with historically selected xi=0.002 and prior strength=24. They do not alter the historical replay or supply blind validation. Current-season coverage is incomplete; actual observation at 2026-10-05T13:18:25.578Z is the availability boundary.

The final fit converges at gradient norm 7.5775e-7, with all 600 ordered pairings among its 25 fitted clubs admissible and a minimum correction of 0.604917. Newly encountered clubs still require dated prior inputs and independent grid validation. No public model selector, constants, rating artifact or rolling production ledger is changed.

Further work should predeclare a separate development experiment for the nonsmooth constrained optimizer and the overly dispersed totals. Any revised shrinkage or calibration specification must be selected inside training data, then frozen before prospective outcomes. The private prospective collector can seal this candidate as a research comparison; its existence cannot waive the current over-2.5 weakness or the requirement for independent multi-market evidence and a separate promotion review.
