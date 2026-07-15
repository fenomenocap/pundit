# API Reference — Overview

Pundit's backend is a small read-mostly REST API. All documented endpoints below are public — no API key or authentication required.

**Base URL:** the Pundit API deployment (ask the team for the current environment's URL).

**Rate limits:**

* 100 requests/minute per client on the API as a whole
* 10 requests/minute per client specifically on `POST /api/ask` (it calls out to an LLM, so it's limited more tightly)

Exceeding a limit returns an HTTP error with a JSON body like `{ "error": "Too many requests, please try again later" }`.

**Response shape:** endpoints that proxy cached upstream data (matches, Polymarket, model) all follow the same envelope:

```json
{
  "...data key...": [ /* ... */ ],
  "lastUpdated": "2026-06-12T10:00:00.000Z",
  "error": null
}
```

`lastUpdated` is when the underlying cache was last refreshed (all caches refresh every 6 hours). `error` is non-null only if the most recent refresh attempt failed — in that case you're still getting the last-known-good cached data, not an empty response.

**Endpoints:**

* [Matches](matches.md) — `GET /api/matches/*`
* [Polymarket Reference Odds](polymarkets.md) — `GET /api/polymarkets/*`
* [Model](model.md) — `GET /api/model/*`
* [Ask](ask.md) — `POST /api/ask`

`GET /health` is the unauthenticated liveness check. `GET /ready` reports whether the model, ESPN, and featured-market caches have completed a successful refresh.
