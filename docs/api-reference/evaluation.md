# Evaluation

Read-only calibration artifacts. The endpoints do not trigger live fetches. The World Cup artifact is static; the club-season response is read from the durable evidence ledger maintained by the existing model and market refresh cadences.

### `GET /api/evaluation/club-season`

Rolling pre-kickoff forecasts for club-season fixtures (Premier League and UCL qualifiers). The first eligible Fundamental forecast observed within 90 minutes of kickoff is sealed. Result evidence and distinct timestamped pre-kickoff market comparisons can be appended, but a later model recalculation cannot replace the forecast.

The JSON below shows the response shape. The numbers in it are not a published result. Live club-season metrics are on the production API's data volume, and the in-repo seed is empty.

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
    "exclusions": { "total": 3, "byReason": { /* explicit audit counts */ } },
    "dedupe": { "ruleId": "one-per-fixture-v1", "officialRows": 50, "scoredRows": 42, "collapsedDuplicates": 8 }
  },
  "missedCheckpoints": [ /* fixtures for which no eligible pre-kickoff forecast existed */ ],
  "fixtures": [ /* sealed forecast, provenance, market observations, and result */ ]
}
```

**One forecast per match.** `fixtures` keeps every stored row, but `metrics` and `evaluation.segments` score each `competitionId:fixtureId` once (rule `one-per-fixture-v1`). When a match has more than one official row, the order of preference is: `scheduled_window` checkpoint over a fallback seal, then the higher `modelVersion`, then the later `forecastAt`, then a fixed tie-break. `evaluation.dedupe` reports `officialRows`, `scoredRows` and `collapsedDuplicates`. Before 22 Oct 2026 duplicates were counted; on that day the production ledger had 104 official rows for 84 matches.

UI: [`/evaluation/club-season`](https://thepundit.vercel.app/evaluation/club-season) (**Track record** in the nav; its `#methodology` section replaces the removed `/model` page)

### `GET /api/evaluation/wc-2026`

Frozen World Cup 2026 backtest. Pre-kickoff probabilities were **reconstructed** from historical Elo ratings and the Dixon-Coles engine — not live snapshots. This artifact is immutable; no cron refreshes it. The frozen headline is **104** matches, Brier **0.4383**, log loss **0.7853**, winner accuracy **0.6827** (68.3%), and **24** draws.

```json
{
  "competition": "fifa.world",
  "method": "reconstructed",
  "builtAt": "2026-07-15T00:00:00.000Z",
  "disclaimer": "Immutable pre-kickoff probabilities reconstructed for backtesting...",
  "metrics": {
    "fixtureCount": 104,
    "brierScore": 0.4383,
    "logLoss": 0.7853,
    "winnerAccuracy": 0.6827,
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

When there are no finished eligible samples, Brier score, log loss and outcome accuracy are `null`; a zero would falsely imply perfect forecasting. Older schema-v1 fixture rows are loaded as partial-provenance records without inventing rating timestamps that were never captured. Legacy, incomplete-source, invalid-timestamp and post-kickoff rows remain preserved but are excluded from official metrics and reported in `evaluation.exclusions`. Official research cohorts use `checkpointPolicyId: "pre-kickoff-90m-v1"` and `checkpointReason: "scheduled_window"` only. A newly sealed row without a result must not inflate completed-n. The in-repo `club-season.json` seed is empty; production volume is the API's `/data` volume on DigitalOcean.

Do not treat either evaluation artifact as current forecasts. Live forecasts (`GET /api/model/active`) recalculate from the release's freshness-gated club-strength artifact; evaluation artifacts preserve pre-kickoff views only.
