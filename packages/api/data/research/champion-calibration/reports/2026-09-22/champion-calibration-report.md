# Champion calibration (Phase 1b)

Built at **2026-09-22T09:06:30.031Z**. Offline fit of the current champion (ClubElo + fixed-total Dixon–Coles grid). Production does **not** auto-load this file. MiniMax does not author probabilities.

## Ledger

- Path: `packages/api/data/research/champion-calibration/ledgers/production-2026-09-22.json`
- Used documented sample: **no**
- Rows: 72 · official with result: **64** (PL 50, UCL quals 14)
- Excluded outside scheduled checkpoint policy: 0
- Excluded: 8 (legacy 8, incomplete 0, post-kickoff 0)
- Published sealed mapping: geometric 43, fixed-total 21, neither 0
- Production target: **n=44** official `scheduled_window` rows on Railway (`PUNDIT_DATA_DIR=/data`). Do not treat the in-repo seed as truth.

## Constants

| | BASE_GOALS | HFA (Elo) | rho | mismatch inflation |
|---|---|---|---|---|
| Shipped (production) | 1.35 | 42 | -0.1 | 0 |
| Fitted (research only) | 1.41 | 11 | -0.05 | 0 |

Per-competition BASE_GOALS: {"eng.1":1.41,"uefa.champions_qual":1.35}. UCL: **frozen**.

## 1X2 / totals vs results

| Source | n | 3-way Brier | log-loss | winner acc. | O/U 2.5 Brier | mean λ vs goals |
|---|---|---|---|---|---|---|
| Shipped recomputed (fixed-total) | 64 | 0.6572 | 1.0972 | 0.4219 | 0.249 | 2.7 vs 2.953 |
| Fitted recomputed | 64 | 0.662 | 1.1047 | 0.4219 | 0.2491 | 2.794 vs 2.953 |
| Published sealed (historical) | 64 | 0.6617 | 1.1097 | 0.4219 | 0.2526 | 2.7 vs 2.953 |

Published sealed rows may still be the pre–Phase 0 geometric mapping. Shipped recomputed is the current champion on the same pre-kickoff Elos.

## Chronological validation (PL only)

Expanding weekly refits use only earlier results with a 24-hour kickoff lag. Historical replay, not a prospective seal of fitted constants. Final full-sample fit metrics above are descriptive only.

- Held-out matches: 20; folds: 2
- Held-out Brier: shipped 0.6827, fitted 0.7024
- Paired UTC-week bootstrap: {"method":"paired-utc-week-heldout","draws":2000,"seed":20260915,"n":20,"blockCount":2,"meanDelta":0.01978060150266398,"p10":0.015455061841680766,"p50":0.01978060150266398,"p90":0.02331967940710479}

## vs market no-vig (when `marketComparisons` exist)

| Forecast | n | model Brier | model log-loss | market Brier | market log-loss |
|---|---|---|---|---|---|
| Shipped recomputed | 63 | 0.6624 | 1.1047 | 0.6265 | 1.0418 |
| Fitted recomputed | 63 | 0.6686 | 1.1141 | 0.6265 | 1.0418 |
| Published sealed | 63 | 0.667 | 1.1174 | 0.6265 | 1.0418 |

## 1X2 and O/U 2.5 reliability by Elo-gap bucket (shipped recomputed)

| Bucket | n | \|Elo gap\| | home pred/act | draw pred/act | away pred/act | O/U 2.5 pred/act |
|---|---|---|---|---|---|---|
| close (<50) | 19 | 28.1 | 0.3416/0.3158 | 0.2803/0.4737 | 0.3781/0.2105 | 0.5064/0.4737 |
| moderate (50–150) | 24 | 102.9 | 0.3995/0.2917 | 0.2575/0.2917 | 0.343/0.4167 | 0.5064/0.7083 |
| large (150–250) | 11 | 187 | 0.5697/0.4545 | 0.2161/0.1818 | 0.2141/0.3636 | 0.5064/0.4545 |
| mismatch (≥250) | 10 | 325.6 | 0.582/0.7 | 0.1499/0.2 | 0.2681/0.1 | 0.5064/0.6 |

## Decision

- Recommend production change: **false**
- Changed shipped constants: **no**
- Rebuilt golden-cutover: **no**
- Production dixon-coles.ts constants were not changed by this offline report.
- Golden-cutover rebuild is reserved for a human decision after shipped constants move.
- Fitted 1X2 Brier is not clearly better than shipped 1.35/42/−0.1.
- Chronological PL holdout n=20; need 40.
- Need at least 1000 paired bootstrap draws and 5 held-out UTC weeks; missing uncertainty cannot pass.
- Held-out 1X2 Brier does not improve by more than 0.005.
- Held-out paired bootstrap 10–90% interval on ΔBrier does not lie entirely below 0.

Content-addressed research config `champion-calibration@1:e6bd1e70df6b3d4bcaba3b7eb6016cb2b092219943aa90083ece40e6a600fe18` has `productionAutoLoad: false`.
