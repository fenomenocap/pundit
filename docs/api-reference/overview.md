# API Reference — Overview

Pundit's backend is a small read-mostly REST API. All documented endpoints below are public — no API key or authentication required (except `POST /api/ask`, which requires `MINIMAX_API_KEY` on the server).

**Base URL:** the Pundit API deployment (production: `https://thepundit.up.railway.app`).

**Rate limits:**

* 100 requests/minute per client on the API as a whole
* 10 requests/minute per client specifically on `POST /api/ask` (it calls out to an LLM, so it's limited more tightly)

Exceeding a limit returns an HTTP error with a JSON body like `{ "error": "Too many requests, please try again later" }`.

**Response shape:** endpoints that proxy cached upstream data (matches, model) all follow the same envelope:

```json
{
  "...data key...": [ /* ... */ ],
  "lastUpdated": "2026-07-28T10:00:00.000Z",
  "error": null
}
```

`lastUpdated` is when the underlying cache was last refreshed (ESPN and active market odds every 30 minutes, ClubElo + active model hourly). `error` is non-null only if the most recent refresh attempt failed — in that case you're still getting the last-known-good cached data, not an empty response.

**Endpoints:**

* [Matches](matches.md) — `GET /api/matches/*`
* [Model](model.md) — `GET /api/model/active`, `GET /api/model/fixtures`
* [Ask](ask.md) — `POST /api/ask`
* [Evaluation](evaluation.md) — `GET /api/evaluation/*`
* [Polymarket Reference Odds](polymarkets.md) — legacy WC reference (`GET /api/polymarkets/*`)

**Health:**

* `GET /health` — liveness check (`{ "status": "ok" }`)
* `GET /ready` — cache readiness (model, ESPN, active fixtures, market odds). Returns 503 while caches are still bootstrapping. Includes `marketOdds.coverage` for active-fixture odds completeness.
