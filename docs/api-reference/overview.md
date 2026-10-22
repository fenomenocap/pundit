# API Reference — Overview

Pundit's backend is a small read-mostly REST API. All documented endpoints below are public — no API key or authentication required on the client. **`POST /api/ask`** needs server-side inference: **`OPENROUTER_API_KEY`** in production (answers and search), or **`MINIMAX_API_KEY`** as the answer-only fallback when OpenRouter is unset.

**Base URL:** the Pundit API deployment (production: `https://134-209-121-101.sslip.io`, on DigitalOcean since 22 Oct 2026). The old Railway address is retired and may serve a frozen build; do not use it.

**Rate limits:**

* 100 requests/minute per client on the API as a whole
* 10 requests/minute across the declared deployment specifically on `POST /api/ask`. Each API process uses one shared bucket sized as `ASK_RATE_LIMIT_PER_MINUTE / API_REPLICAS`; production currently declares one replica.

Exceeding a limit returns an HTTP error with a JSON body like `{ "error": "Too many requests, please try again later" }`.

**Response shape:** endpoints that proxy cached upstream data (matches, model) all follow the same envelope:

```json
{
  "...data key...": [ /* ... */ ],
  "lastUpdated": "2026-07-28T10:00:00.000Z",
  "error": null
}
```

`lastUpdated` is when the underlying cache was last refreshed. The quiet cadence is ESPN and market odds every 30 minutes and the active model every hour. A kickoff inside 24 hours shortens that to 10 minutes, 10 minutes, and 30 minutes. A match in play shortens it to 2 minutes, 5 minutes, and 15 minutes. Club strengths are a pinned local release artifact rather than a runtime vendor cache. `error` is non-null when the relevant refresh or artifact validation failed.

**Endpoints:**

* [Matches](matches.md) — `GET /api/matches/*`
* [Recognized fixtures](matches.md#recognized-fixtures) — `GET /api/fixtures/recognized`
* [Model](model.md) — `GET /api/model/active`, `GET /api/model/fixtures`, `GET /api/model/backtest-gate`
* [FPL data](fpl.md) — `GET /api/fpl/bootstrap` (public FPL player data for the `/draft` simulator)
* [Ask](ask.md) — `POST /api/ask`
* [Evaluation](evaluation.md) — `GET /api/evaluation/*`
* [Polymarket Reference Odds](polymarkets.md) — legacy WC reference (`GET /api/polymarkets/*`)

**Health:**

* `GET /health` — liveness check (`{ "status": "ok" }`)
* `GET /ready` — cache readiness (model, ESPN, active fixtures, market odds). Returns 503 while caches are still bootstrapping. Includes `marketOdds.coverage` for active-fixture odds completeness.
