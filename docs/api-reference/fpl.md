# FPL Player Data

Public Fantasy Premier League player data for the `/draft` team simulator. This is **not** a model input: no forecast, probability or price on the desk uses it.

### `GET /api/fpl/bootstrap`

Proxies the public FPL `bootstrap-static` feed (no key) and trims it to the fields the simulator uses.

```json
{
  "source": "fpl-bootstrap-static",
  "fetchedAt": "2026-10-23T00:00:00.000Z",
  "gameweek": 9,
  "clubs": [{ "code": "ARS", "name": "Arsenal" }],
  "players": [
    {
      "id": 1,
      "name": "Example Player",
      "club": "ARS",
      "clubName": "Arsenal",
      "pos": "MID",
      "price": 6.5,
      "status": "a",
      "chanceNextRound": null,
      "news": null,
      "totalPoints": 30,
      "form": 4.2,
      "selectedByPercent": 12.3
    }
  ],
  "stale": false
}
```

The values above show the shape only; they are not real data.

* `pos` is one of `GK`, `DEF`, `MID`, `FWD`. `price` is in £m. A player with no published price has `price: null`; a price is never estimated.
* **Caching:** the last good payload is kept for 1 hour in memory and mirrored to disk under `PUNDIT_DATA_DIR` (or a temp directory), so a restart does not refetch. Concurrent requests share one upstream fetch.
* **Headers:** a good response has `Cache-Control: public, max-age=3600` and `X-Pundit-Cache: hit` or `miss`.
* **Stale on error:** if a refresh fails and an earlier payload exists, that payload is returned with `"stale": true`, `X-Pundit-Cache: stale` and `Cache-Control: no-store`.
* **Errors** are never cached: the API returns `502` with `Cache-Control: no-store` and `{ "error": "..." }`, and the next request retries the source.

The web app also has its own server route, `/api/fpl` on the website, which fetches the same public feed. The FPL site sometimes refuses requests from Vercel's servers; this API endpoint is the fallback route for that case.

Player data comes from Fantasy Premier League (public). Pundit is not affiliated with the Premier League, and the simulator is a simulator only.
