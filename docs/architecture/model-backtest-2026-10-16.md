# EPL walk-forward backtest (2026-10-16)

Owner-approved work to benchmark fundamental 1X2 models against de-margined Pinnacle (or Betfair exchange) closes from [football-data.co.uk](https://www.football-data.co.uk/). **Market odds never enter fundamental fits** — closes are evaluation-only. Labelled Consensus remains a separate, market-aware view in production.

## Harness

Package: `model/backtest/` (`pnpm backtest:ci`, `pnpm backtest:run`).

- Elo proxy rebuilt from E0+E1 results (K=20, goal-diff multiplier), **frozen before each match day**, linearly anchored to the pinned ClubElo production artifact (2026-10-13 snapshot).
- Production mapping: fixed-total 2.70 xG, HFA 42, ρ=−0.1 (`packages/api/src/services/dixon-coles.ts`).
- Holdout: EPL E0 from 2021/22 onward (`2122`…`2627`), **n=1,960** with close odds.
- Walk-forward: per-season parameter refits use strictly prior seasons; Elo updates daily after results.

## Results vs close (all holdout rows)

| Phase | Log loss | Δ vs champion | Δ vs close |
| --- | --- | --- | --- |
| Champion baseline | 0.9843 | — | +0.0253 |
| Phase 1 (HFA/base/ρ refit) | **0.9840** | −0.0002 | +0.0251 |
| Phase 2 (DC MLE) | 1.0228 | +0.0385 | +0.0638 |
| Phase 3 (rest/midweek + Elo softmax) | 0.9871 | +0.0029 | +0.0282 |
| Ensemble (fundamental stack) | 0.9864 | +0.0021 | +0.0274 |
| **Market close** | **0.9590** | — | — |

**No phase beats the close** on log loss. Bootstrap 95% CI for (model − close) log loss on the best fundamental (phase 1) is **[+0.017, +0.033]**, which **excludes zero** — the **close is significantly better**, not the model.

Phase 1 marginally beats the champion on walk-forward log loss but stays **behind** `BACKTEST_PROMOTED_MODEL_ENABLED` (default `false`) until a human enables it. Edge/chat wording remains gated: `edgeValidationActive=false` (see `GET /api/model/backtest-gate`).

## Phase 3 xG (2026-10-16)

Understat match xG is fetched offline (`pnpm backtest:download-xg`) into versioned JSON under `model/backtest/data/xg/`. StatsBomb open-data PL 2015/16 shot events calibrate Understat (`calibration_v1.json`). Rolling time-decayed pre-match xG for/against feeds a Poisson/Dixon–Coles 1X2 head and the fundamental ensemble. ClubElo dated CSVs are probed via API/Wayback; when unreachable the results-built Elo proxy remains.

## Other data notes

- **Injuries / lineups**: no free keyed feed identified — **stopped without spend**.

## Promotion criteria

Pre-declared in `model/backtest/backtest/promotion_criteria.json`. No promotion on simulated profit.

## Commands

```bash
pnpm backtest:download
pnpm backtest:run
```

Refreshes `packages/api/data/model-artifacts/backtest-gate.json` for the API.
