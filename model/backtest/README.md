# Pundit model backtest (walk-forward vs close)

Reproducible Premier League 1X2 backtests using [football-data.co.uk](https://www.football-data.co.uk/) results and closing odds. The **market is never a fundamental input** — Pinnacle (or Betfair exchange) de-margined closes are the benchmark only.

## Binding promotion rules

Declared before any experiment (`backtest/promotion_criteria.json`):

- Walk-forward only (weekly rating freeze; per-season parameter refits use strictly prior seasons).
- Primary metrics: **log loss**, **Brier**, **calibration** vs the close on the same holdout rows.
- Bootstrap 95% CIs (2000 resamples, seed 0); promotion requires log-loss Δ (model − market) **upper bound &lt; 0** on the declared holdout.
- **Never** promote on simulated profit or Kelly ROI.

## Phases

| Phase | Model |
| --- | --- |
| Baseline | Production ClubElo-style proxy + fixed HFA 42 + `eloToLambdas` + Dixon–Coles ρ=−0.1 |
| 1 | Per-season walk-forward refit of HFA + base goals + ρ |
| 2 | Time-decayed Dixon–Coles attack/defence MLE |
| 3 | xG (StatsBomb open), rest days, European midweek flags |
| 4 | Stacked / calibrated ensemble of fundamental heads (no market in stack) |
| Gate | Edge labels allowed only when promoted model beats close at divergence threshold with CI excluding zero |

## Commands

```bash
cd model/backtest
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m backtest.cli download-data   # football-data.co.uk CSVs → data/raw/
python -m backtest.cli run --phase all # full walk-forward report
pytest -q                              # CI smoke (fixture CSV, no network)
```

From repo root: `pnpm backtest:ci` (install + pytest + fast baseline run).

## Outputs

Written under `model/backtest/artifacts/latest/`:

- `metrics_by_season.csv`, `calibration.csv`, `divergence_buckets.csv`, `backtest_rows.csv`
- `gate.json` — consumed by `GET /api/model/backtest-gate`
