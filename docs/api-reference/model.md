# Model

Cached output from the `worldcup-model` companion project — the Dixon-Coles Poisson probabilities that power the chat's grounding. See [The Model](../how-it-works/the-model.md).

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

`stakePHome` / `stakePDraw` / `stakePAway` are no-vig implied probabilities derived from Stake's live 1X2 odds for that fixture, and are `null` when no market price is available yet. `home` / `away` are positional labels only — all World Cup 2026 matches are at neutral venues, so there's no home-field advantage baked into the probabilities.
