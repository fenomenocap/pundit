# Model

Cached output from Pundit's local Dixon-Coles engine, using the release's pinned ClubElo strength artifact, for the **active club-fixture set** (14-day horizon). See [The Model](../how-it-works/the-model.md).

### `GET /api/model/active`

Active fixtures with model probabilities. Optional filter: `?competition=eng.1`.

```json
{
  "fixtures": [
    {
      "competitionId": "eng.1",
      "competition": "Premier League",
      "fixtureId": 401234,
      "utcDate": "2026-08-15T14:00:00Z",
      "date": "2026-08-15",
      "stage": "match",
      "home": "Arsenal",
      "away": "Coventry City",
      "homeElo": 1850,
      "awayElo": 1520,
      "pHome": 0.72,
      "pDraw": 0.18,
      "pAway": 0.10,
      "pOver2_5": 0.55,
      "pUnder2_5": 0.45,
      "pBttsYes": 0.48,
      "pBttsNo": 0.52,
      "topScores": [{ "score": "2-0", "probability": 0.14 }],
      "stakePHome": null,
      "stakePDraw": null,
      "stakePAway": null,
      "oddsSources": [
        {
          "source": "polymarket",
          "observedAt": "2026-08-27T11:15:32.945Z",
          "pHome": 0.68,
          "pDraw": 0.20,
          "pAway": 0.12
        }
      ],
      "result": null
    }
  ],
  "lastUpdated": "2026-07-28T10:00:00.000Z",
  "error": null
}
```

`stakeP*` is Stake when that source returned a complete 1X2; it is `null` when Stake is disabled or missed. `oddsSources` is joined at read time from the 30-minute Kalshi/Polymarket cache. Incomplete legs are omitted. Full scoreline matrices are stripped from the HTTP response.

### `GET /api/model/fixtures`

Same payload as `/active`. Optional `?competition=` filter. Full scoreline matrices are omitted from the HTTP response (available internally for chat grounding).

### Retired: `GET /api/model/wc`

Returns **410 Gone**. The live World Cup tournament model is retired. See [Evaluation](evaluation.md) for the frozen WC 2026 backtest.

### Important caveat

The active fixture cache recalculates probabilities from the release's pinned **ClubElo rating artifact** on each refresh. The artifact is content-addressed and freshness-gated, but the active endpoint is still not an immutable pre-kickoff archive. For calibration metrics, use [Evaluation](evaluation.md).
