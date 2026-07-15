# Matches

Live World Cup 2026 fixtures, results, and group standings, sourced from ESPN's public scoreboard API. See [Data Sources](../how-it-works/data-sources.md).

### `GET /api/matches/upcoming`

Up to the next 50 scheduled/in-play matches, sorted earliest first.

```json
{
  "matches": [
    {
      "id": 731234,
      "competition": "FIFA World Cup",
      "homeTeam": "France",
      "awayTeam": "Morocco",
      "utcDate": "2026-06-15T18:00:00Z",
      "status": "SCHEDULED",
      "stage": "group-stage",
      "matchday": null,
      "group": "A",
      "score": null
    }
  ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

`status` is one of `SCHEDULED`, `IN_PLAY`, `FINISHED`, `POSTPONED`, `CANCELLED`. `stage` is one of `group-stage`, `round-of-32`, `round-of-16`, `quarterfinals`, `semifinals`, `3rd-place-match`, `final`.

### `GET /api/matches/recent`

The most recent 20 finished matches, sorted most recent first. Same shape as `/upcoming`, with `status: "FINISHED"` and `score` populated.

### `GET /api/matches/standings`

Group-stage standings across all groups.

```json
{
  "standings": [
    {
      "position": 1,
      "team": "France",
      "playedGames": 2,
      "won": 2,
      "draw": 0,
      "lost": 0,
      "points": 6,
      "goalsFor": 5,
      "goalsAgainst": 1,
      "goalDifference": 4,
      "group": "A",
      "advanced": false
    }
  ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

`advanced` is `true` once that team has mathematically or actually advanced out of the group.
