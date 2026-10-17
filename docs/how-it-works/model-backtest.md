# Model backtest

Offline **walk-forward** evaluation of Pundit’s fundamental 1X2 against **de-margined market closes** (Pinnacle / Betfair from [football-data.co.uk](https://www.football-data.co.uk/)). Closes are **evaluation-only** — they never enter fundamental fits. Labelled **Pundit Consensus** in production remains a separate, market-aware view.

## Verdict (pinned gate)

As of the 2026-10-16 harness run shipped on `main`:

- **No challenger phase beats the champion** on walk-forward log loss in a way that triggers automatic promotion.
- **Market close is significantly better** than the best fundamental (bootstrap 95% CI for log-loss gap excludes zero).
- Production **`edgeValidationActive=false`**: user-facing copy shows **model vs market** comparison only — not edge, value, or +EV claims from gaps.

Runtime exposure: `GET /api/model/backtest-gate` returns the pinned artifact plus `promotedModelEnabled` (from `BACKTEST_PROMOTED_MODEL_ENABLED`, default false).

## Harness location

Python package: `model/backtest/`

| Command | Purpose |
| --- | --- |
| `pnpm backtest:ci` | CI: install dev deps, pytest, fast baseline phase |
| `pnpm backtest:download` | Fetch football-data.co.uk CSVs |
| `pnpm backtest:download-xg` | Offline Understat xG JSON |
| `pnpm backtest:run` | Full phase run; refreshes `packages/api/data/model-artifacts/backtest-gate.json` |

Holdout: EPL E0 from 2021/22 onward with close odds; champion uses production fixed-total 2.70 mapping, HFA 42, ρ −0.1. Phase 2 is fitted Dixon–Coles MLE; phase 3 adds calendar/rest features; xG phases use Understat with StatsBomb calibration (see architecture note below).

## Promotion

Criteria live in `model/backtest/backtest/promotion_criteria.json`. **No promotion on simulated profit.** Enabling a promoted backtest model in production requires `BACKTEST_PROMOTED_MODEL_ENABLED=true` **and** a human decision — the gate artifact alone does not switch the champion.

## Detail

Full phase tables, xG pipeline notes, and injury/lineup scope stop: [architecture/model-backtest-2026-10-16.md](../architecture/model-backtest-2026-10-16.md) and [architecture/model-backtest-xg-2026-10-16.md](../architecture/model-backtest-xg-2026-10-16.md).
