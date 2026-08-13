# Matches

Live club-season fixtures, results, and standings across enabled competitions (Premier League and UCL qualifiers), sourced from ESPN's public scoreboard API. See [Data Sources](../how-it-works/data-sources.md).

### `GET /api/matches/competitions`

Registry of enabled competitions with id, name, type, and priority.

### `GET /api/matches/active`

Fixtures in the 14-day active window used for model grounding and featured chat suggestions.

### `GET /api/matches/upcoming`

Up to the next 50 scheduled/in-play matches, sorted earliest first. Optional filter: `?competition=eng.1`.

```json
{
  "matches": [
    {
      "id": 401234,
      "competitionId": "eng.1",
      "competition": "Premier League",
      "homeTeam": "Arsenal",
      "awayTeam": "Coventry City",
      "utcDate": "2026-08-15T14:00:00Z",
      "status": "SCHEDULED",
      "stage": null,
      "matchday": 1,
      "group": null,
      "score": null
    }
  ],
  "lastUpdated": "2026-07-28T10:00:00.000Z",
  "error": null
}
```

`status` is one of `SCHEDULED`, `IN_PLAY`, `FINISHED`, `POSTPONED`, `CANCELLED`.

### `GET /api/matches/recent`

The most recent 20 finished matches, sorted most recent first. Same shape as `/upcoming`, with `status: "FINISHED"` and `score` populated. Optional `?competition=`.

### `GET /api/matches/standings`

League standings for enabled competitions. Optional `?competition=eng.1`.

```json
{
  "standings": [
    {
      "competitionId": "eng.1",
      "position": 1,
      "team": "Arsenal",
      "playedGames": 0,
      "won": 0,
      "draw": 0,
      "lost": 0,
      "points": 0,
      "goalsFor": 0,
      "goalsAgainst": 0,
      "goalDifference": 0,
      "group": null,
      "advanced": false
    }
  ],
  "lastUpdated": "2026-07-28T10:00:00.000Z",
  "error": null
}
```

For cup-style competitions, `group` may be populated. `advanced` indicates knockout qualification where applicable.

### Recognized fixtures

#### `GET /api/fixtures/recognized`

Read-only certification surface for approved structured fixture identities. The response is sent with `Cache-Control: no-store` and contains registry status plus kickoff-sorted fixture records paired with their current capability:

```json
{
  "registry": {
    "enabled": false,
    "mode": "shadow",
    "fixtureCount": 1,
    "updatedAt": "2026-08-13T10:00:00.000Z",
    "loadedFrom": "primary",
    "error": null,
    "storageBlocked": false
  },
  "fixtures": [
    {
      "fixture": {
        "fixtureId": "espn:eng.1:401879301",
        "primarySource": "espn",
        "primarySourceFixtureId": "401879301",
        "homeTeam": { "id": "arsenal", "name": "Arsenal" },
        "awayTeam": { "id": "coventry", "name": "Coventry City" },
        "kickoff": "2026-08-15T14:00:00.000Z",
        "venue": "Emirates Stadium",
        "neutralVenue": false,
        "competition": { "id": "eng.1", "name": "Premier League", "category": "domestic-league" },
        "status": "scheduled",
        "recognition": "authoritative"
      },
      "capability": { "status": "priced", "modelFixtureId": "401879301" }
    }
  ]
}
```

Capabilities are `priced`, `temporarily-unpriced`, `outside-coverage`, or `insufficient-model-input`, each with its typed identifier or reason. The endpoint never exposes a `FixtureCandidate`, user text, search result, secret, or private friendly forecast. `registry.mode: "shadow"` means expansion routing is disabled; observation and persistence still run for existing approved feeds.
