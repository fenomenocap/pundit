# Champion calibration (Phase 1b)

Built at **2026-09-09T13:41:17.437Z**. Offline fit of the current champion (ClubElo + fixed-total Dixon–Coles grid). Production does **not** auto-load this file. MiniMax does not author probabilities.

## Ledger

- Path: `packages/api/data/research/champion-calibration/ledgers/production-2026-09-09.json`
- Used documented sample: **no**
- Rows: 52 · official with result: **44** (PL 30, UCL quals 14)
- Excluded: 8 (legacy 8, incomplete 0, post-kickoff 0)
- Published sealed mapping: geometric 43, fixed-total 1, neither 0
- Production target: **n=44** official `scheduled_window` rows on Railway (`PUNDIT_DATA_DIR=/data`). Do not treat the in-repo seed as truth.

## Constants

| | BASE_GOALS | HFA (Elo) | rho | mismatch inflation |
|---|---|---|---|---|
| Shipped (production) | 1.35 | 42 | -0.1 | 0 |
| Fitted (research only) | 1.42 | 40 | 0 | 0 |

Per-competition BASE_GOALS: {"eng.1":1.42,"uefa.champions_qual":1.35}. UCL: **frozen**.

## 1X2 / totals vs results

| Source | n | 3-way Brier | log-loss | winner acc. | O/U 2.5 Brier | mean λ vs goals |
|---|---|---|---|---|---|---|
| Shipped recomputed (fixed-total) | 44 | 0.6456 | 1.0834 | 0.4091 | 0.2489 | 2.7 vs 3.023 |
| Fitted recomputed | 44 | 0.6554 | 1.0952 | 0.4091 | 0.2499 | 2.795 vs 3.023 |
| Published sealed (historical) | 44 | 0.6522 | 1.1016 | 0.4091 | 0.254 | 2.7 vs 3.023 |

Published sealed rows may still be the pre–Phase 0 geometric mapping. Shipped recomputed is the current champion on the same pre-kickoff Elos.

## vs market no-vig (when `marketComparisons` exist)

| Forecast | n | model Brier | model log-loss | market Brier | market log-loss |
|---|---|---|---|---|---|
| Shipped recomputed | 44 | 0.6456 | 1.0834 | 0.5907 | 0.9924 |
| Fitted recomputed | 44 | 0.6554 | 1.0952 | 0.5907 | 0.9924 |
| Published sealed | 44 | 0.6522 | 1.1016 | 0.5907 | 0.9924 |

## 1X2 and O/U 2.5 reliability by Elo-gap bucket (shipped recomputed)

| Bucket | n | \|Elo gap\| | home pred/act | draw pred/act | away pred/act | O/U 2.5 pred/act |
|---|---|---|---|---|---|---|
| close (<50) | 12 | 26.9 | 0.3437/0.3333 | 0.2805/0.5 | 0.3758/0.1667 | 0.5064/0.5 |
| moderate (50–150) | 19 | 102.2 | 0.4222/0.3158 | 0.2578/0.3158 | 0.32/0.3684 | 0.5064/0.6842 |
| large (150–250) | 7 | 197 | 0.5228/0.5714 | 0.2107/0.1429 | 0.2665/0.2857 | 0.5064/0.5714 |
| mismatch (≥250) | 6 | 345.7 | 0.5591/0.8333 | 0.1422/0.1667 | 0.2987/0 | 0.5064/0.5 |

## Decision

- Recommend production change: **false**
- Changed shipped constants: **no**
- Rebuilt golden-cutover: **no**
- Production dixon-coles.ts constants were not changed by this offline report.
- Golden-cutover rebuild is reserved for a human decision after shipped constants move.
- Premier League official n=30 is below the ~40 bar for shipping new constants.
- Fitted 1X2 Brier is not clearly better than shipped 1.35/42/−0.1.
- Bootstrap 10–90% interval on ΔBrier vs shipped does not lie entirely below 0.
- Production target remains n=44 official scheduled_window rows on Railway (PUNDIT_DATA_DIR=/data).

Content-addressed research config `champion-calibration@1:93e271e4ff96d96beb2dc3ab8d086d85893c52d6385f82960c01e6ac728fad27` has `productionAutoLoad: false`.
