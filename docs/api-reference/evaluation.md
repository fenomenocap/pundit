# Evaluation

Read-only calibration artifacts. Neither endpoint triggers live fetches or connects to chat/model cron — they serve static JSON built offline or updated by snapshot persistence.

### `GET /api/evaluation/club-season`

Rolling pre-kickoff probability snapshots for finished club-season fixtures (Premier League and UCL qualifiers). A snapshot is captured when a fixture leaves the scheduled window, freezing the model probabilities that were live at kickoff time.

```json
{
  "competitions": ["eng.1", "uefa.champions_qual"],
  "method": "snapshot",
  "builtAt": "2026-07-01T00:00:00.000Z",
  "updatedAt": "2026-07-28T10:00:00.000Z",
  "disclaimer": "Pre-kickoff probabilities captured when fixtures leave the scheduled window...",
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
  "fixtures": [ /* per-fixture snapshot rows with result */ ]
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

Do not treat either artifact as current forecasts. The live Model page recalculates with today's ClubElo ratings; evaluation artifacts preserve pre-kickoff views only.
