# Evaluation

Read-only calibration artifacts. The endpoints do not trigger live fetches. The World Cup artifact is static; the club-season response is read from the durable evidence ledger maintained by the existing model and market refresh cadences.

### `GET /api/evaluation/club-season`

Rolling pre-kickoff forecasts for club-season fixtures (Premier League and UCL qualifiers). The first eligible Fundamental forecast observed within 90 minutes of kickoff is sealed. Result evidence and distinct timestamped pre-kickoff market comparisons can be appended, but a later model recalculation cannot replace the forecast.

```json
{
  "schemaVersion": 2,
  "competitions": ["eng.1", "uefa.champions_qual"],
  "method": "snapshot",
  "builtAt": "2026-07-01T00:00:00.000Z",
  "updatedAt": "2026-07-28T10:00:00.000Z",
  "disclaimer": "Immutable pre-kickoff Pundit Fundamental forecasts...",
  "metrics": {
    "fixtureCount": 42,
    "brierScore": 0.5821,
    "logLoss": 1.0234,
    "winnerAccuracy": 0.52,
    "drawCount": 8,
    "calibration": [
      { "label": "0.0–0.2", "count": 5, "avgPredicted": 0.14, "actualRate": 0.20 }
    ]
  },
  "evaluation": {
    "metricVersion": "multiclass-v1",
    "segments": [ /* contributor/version/competition/season/checkpoint/source-state metrics */ ],
    "exclusions": { "total": 3, "byReason": { /* explicit audit counts */ } }
  },
  "missedCheckpoints": [ /* fixtures for which no eligible pre-kickoff forecast existed */ ],
  "fixtures": [ /* sealed forecast, provenance, market observations, and result */ ]
}
```

UI: [`/evaluation/club-season`](https://thepundit.vercel.app/evaluation/club-season)

### `GET /api/evaluation/wc-2026`

Frozen World Cup 2026 backtest. Pre-kickoff probabilities were **reconstructed** from historical Elo ratings and the Dixon-Coles engine — not live snapshots. This artifact is immutable; no cron refreshes it.

```json
{
  "competition": "fifa.world",
  "method": "reconstructed",
  "builtAt": "2026-07-15T00:00:00.000Z",
  "disclaimer": "Immutable pre-kickoff probabilities reconstructed for backtesting...",
  "metrics": {
    "fixtureCount": 104,
    "brierScore": 0.5912,
    "logLoss": 1.0456,
    "winnerAccuracy": 0.49,
    "drawCount": 24,
    "calibration": [ /* buckets */ ]
  },
  "fixtures": [ /* finished WC fixtures with predicted vs actual */ ]
}
```

UI: [`/evaluation/wc-2026`](https://thepundit.vercel.app/evaluation/wc-2026)

### Metrics glossary

| Metric | Meaning |
|---|---|
| **Brier score (1X2)** | Mean squared error across home/draw/away probability vectors. Lower is better. |
| **Log loss** | Cross-entropy of predicted vs actual outcome. Lower is better. |
| **Outcome accuracy** | Share of fixtures where the highest-probability outcome matched the result. |
| **Calibration buckets** | Average predicted probability vs actual frequency within probability bands. |

When there are no finished eligible samples, Brier score, log loss and outcome accuracy are `null`; a zero would falsely imply perfect forecasting. Older schema-v1 fixture rows are loaded as partial-provenance records without inventing rating timestamps that were never captured. Legacy, incomplete-source, invalid-timestamp and post-kickoff rows remain preserved but are excluded from official metrics and reported in `evaluation.exclusions`.

Do not treat either evaluation artifact as current forecasts. The live Model page recalculates from the release's freshness-gated club-strength artifact; evaluation artifacts preserve pre-kickoff views only.
