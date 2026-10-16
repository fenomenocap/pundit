# xG backtest extension (2026-10-16)

## Data pipeline

| Source | Role | Command |
| --- | --- | --- |
| **Understat** | EPL match xG (AJAX, session cookie) | `pnpm backtest:download-xg` → `model/backtest/data/xg/understat/v1/EPL_{year}.json` |
| **StatsBomb open data** | PL 2015/16 shot-level xG for calibration | Same command → `data/xg/statsbomb/v1/pl_1516_match_xg.json` |
| **Calibration** | Map Understat → StatsBomb (n=75 overlapping fixtures) | `python3 -m backtest.cli calibrate-xg` → `calibration_v1.json` |

Committed fixtures under `model/backtest/data/xg/fixtures/` support CI unit tests; full season files stay gitignored and are produced offline.

Rolling **pre-match** xG for/against uses exponential decay (ξ=0.0065) with updates strictly before the calendar kickoff date (same-day Understat rows excluded to avoid leakage).

**ClubElo dated CSV**: live API returned 502; Wayback identity URLs did not return CSV in this environment — backtest keeps the results-built Elo proxy (`clubelo_history_probe.status: unreachable`).

## Walk-forward vs close (2122+, n=1,620 with closes)

| Model | Log loss | Δ vs champion | Δ vs close |
| --- | --- | --- | --- |
| **Champion baseline** | **0.9793** | — | +0.0234 |
| Phase 1 refit | 0.9807 | +0.0014 | +0.0248 |
| Phase 2 DC MLE | 1.0189 | +0.0396 | +0.0630 |
| **Phase 3 xG Poisson/DC** | 1.0321 | +0.0528 | +0.0762 |
| Ensemble | 0.9876 | +0.0083 | +0.0317 |
| **Market close** | **0.9559** | — | — |

**No model beats the close.** Bootstrap 95% CI for (champion − close) log loss is **[+0.0147, +0.0328]**, excluding zero — **the close is significantly better.**

**Promotion:** `promotedModel=champion_baseline`, `challengerBeatsChampion=false`, `edgeValidationActive=false`.

Holdout count is below the earlier 1,960-row run because 2026/27 rows lack Understat 2026 coverage; evaluation rows and odds filters are unchanged otherwise.

## Next data

- Understat 2026 season when published; improve same-day ordering within matchweek.
- More StatsBomb PL seasons if open-data expands beyond 2003/04 and 2015/16.
- ClubElo historical CSV capture when API/Wayback inventory is restored.
