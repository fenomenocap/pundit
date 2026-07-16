# Model

Cached output from Pundit's local Elo, Dixon-Coles, and 100,000-run tournament simulation — the probabilities that power the chat's grounding. See [The Model](../how-it-works/the-model.md).

### `GET /api/model/wc`

Team-level probabilities, sorted by win probability descending.

```json
{
  "teams": [
    {
      "team": "France",
      "winProb": 0.18,
      "sfProb": 0.52,
      "qfProb": 0.81,
      "marketPrice": 0.18,
      "edge": 0.0
    }
  ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

`edge` is `winProb - marketPrice` — positive means the model is more bullish on that team winning the tournament than the market is.

### `GET /api/model/fixtures`

Fixture-level probabilities for the full schedule.

```json
{
  "fixtures": [
    {
      "date": "2026-06-15T18:00:00Z",
      "group": "A",
      "stage": "group-stage",
      "home": "France",
      "away": "Morocco",
      "pHome": 0.62,
      "pDraw": 0.22,
      "pAway": 0.16,
      "pOver2_5": 0.54,
      "pUnder2_5": 0.46,
      "pBttsYes": 0.51,
      "pBttsNo": 0.49,
      "topScores": [{ "score": "1-0", "probability": 0.14 }],
      "stakePHome": 0.58,
      "stakePDraw": 0.24,
      "stakePAway": 0.18,
      "result": null
    }
  ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

This endpoint preserves the full fixture history. Completed `result` objects include `homeScore`, `awayScore`, `status`, and `winner`; `winner` is authoritative for penalty shootouts. Stake fields are nullable. `home` / `away` are positional labels only.

Historical probabilities are recalculated locally using current Elo ratings. Do not treat this endpoint as an immutable pre-match snapshot archive.
