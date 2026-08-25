# Search and inference reliability handoff

Date: 2026-08-25
Branch base: `b60cd09`
Status: implemented, verified locally, **not deployed**

Objective: retrieval and inference must stay reliable under load, vendor
throttling must be visible, and no undocumented subscription endpoint may remain
the sole load-bearing dependency — without changing product behaviour.

---

## 1. Root cause

The reported symptom was: under load, MiniMax returns 429s, the search circuit
breaker trips for several minutes, `searchWeb()` returns `[]`, and answers go
thin — reading to an operator as though the model had regressed.

Four causes were found in the code. Each was verified against the implementation
before any change was made; two were confirmed with reproduction tests.

### Cause 1 — batch accounting was a post-hoc correction, not a guard

Commit `570e31a` had already introduced `searchWebBatch`, bounded concurrency,
split cache TTLs and throttle visibility. But the per-search accounting it was
meant to replace was still live: `searchUncached` incremented
`consecutiveFailures` and opened the breaker on **every individual search**.
`searchWebBatch` then tried to repair the count *after* the batch had finished.

By that point the breaker was already open, and `searchWeb` had short-circuited
the remaining searches **of the same question**.

> **Reproduced.** A six-query question with every search failing made only
> **4 upstream calls**. Two searches were silently dropped — including any that
> would have succeeded.

### Cause 2 — two call sites bypassed batch accounting entirely (decisive)

`runToolUses` (`packages/api/src/services/ask.ts:5166`) and
`runLeakedSearchQueries` (`ask.ts:5271`) called `searchWeb` directly. Neither
went through `searchWebBatch`, so each failure counted individually against the
single global breaker.

> **Reproduced.** Three tool-path searches from **one** question opened the
> global breaker. The **next** user's question then made zero upstream calls and
> received zero evidence for five minutes.

This is the reported production symptom, and it was reachable from a single
question.

### Cause 3 — `[]` was overloaded four ways

`searchWeb` returned an empty array for all of: empty query, circuit open, all
providers failed, and genuine zero results. No caller could distinguish "the web
had nothing" from "our infrastructure is down".

### Cause 4 — one provider, one key

`PROVIDERS = [minimaxProvider]` with no fallback. Inference read the same
`MINIMAX_API_KEY`, so search, inference, and any Claude Code session on that
subscription drew down one shared quota.

### Correction to the original brief

The brief assumed uncommitted resilience work was sitting in the working tree.
It was not — the tree was clean, and that work was already committed in
`570e31a`. The genuine remaining defect was narrower and more specific than
"the breaker counts per search": batch accounting existed but did not cover the
two tool-path call sites, and did not prevent a mid-question trip.

---

## 2. Files changed

| File | Why |
|---|---|
| `packages/api/src/services/web-search.ts` | Provider chain + Brave adapter; typed outcomes; per-provider, per-question breakers; global concurrency gate; bounded retry; structured logging |
| `packages/api/src/services/ask.ts` | Separate inference credential and health tracking; three search call sites migrated to typed outcomes; request entry points wrapped in a question scope |
| `packages/api/src/index.ts` | `/ready` reports `inference` independently of `webSearch` |
| `.env.example` | Documents the new variables |
| `CLAUDE.md` | Records the adapter-seam and no-silent-failure rules |
| 6 test files | New coverage, plus mock adaptation to the outcome type |

Totals: 11 files, +1,900 / −329. No product logic was removed — every deleted
line was reviewed individually and accounted for.

---

## 3. Final inference architecture

Inference resolves its own credential, falling back to the shared one:

```
MINIMAX_INFERENCE_API_KEY   → falls back to → MINIMAX_API_KEY
MINIMAX_INFERENCE_BASE_URL  → falls back to → MINIMAX_BASE_URL
```

The Anthropic-compatible client, the model, the request shape and `maxRetries: 0`
are all untouched. This is a credential swap, not a client rewrite, so a
deployment that sets only `MINIMAX_API_KEY` behaves exactly as it did before.

Every inference call routes through `trackedInference()`, which feeds
`getInferenceStatus()` and emits a distinct `inference_rate_limited` log event —
deliberately separate from search throttling, because the two share a vendor and
previously shared a key, which made "which quota ran out?" unanswerable.

---

## 4. Final search and failover architecture

Search is a **provider chain**, not a vendor integration.

```
minimax → brave        (order resolved per call from WEB_SEARCH_PROVIDER_ORDER)
```

- Any provider-level failure — 429, 5xx, timeout, malformed body, rejected
  credential, open breaker — fails over to the next enabled provider.
- A provider returning *structurally valid emptiness* also falls through to the
  next provider, but is **not** counted as a failure against it.
- Setting `WEB_SEARCH_PROVIDER_ORDER=brave,minimax` promotes Brave to primary
  with no code change. Unknown names are ignored; unnamed providers trail the
  chain, so adding a key is sufficient to gain a fallback.

Adding a provider means implementing `SearchProvider` and registering it in
`KNOWN_PROVIDERS`. Product behaviour is never coupled to one provider's wire
format.

### Typed outcomes — no silent failure

`searchWeb` now returns:

```ts
{
  status: "ok" | "empty" | "degraded",
  results: WebSearchResult[],
  provider: string | null,
  reason: WebSearchFailureReason | null,
  usedFallback: boolean,
  attempts: ProviderAttempt[]
}
```

`empty` means a healthy provider searched and the web had nothing — a fact about
the world. Every other non-`ok` case is `degraded` and carries one of:

| Reason | Meaning |
|---|---|
| `rate_limited` | Provider returned HTTP 429 |
| `provider_unavailable` | 5xx, other 4xx, or transport failure |
| `timeout` | Network timeout |
| `circuit_open` | Provider breaker open; not called |
| `malformed_response` | Body unparseable or over the size cap |
| `not_configured` | No key, or credential rejected (401/403) |
| `providers_exhausted` | Every enabled provider failed |

The calling layer degrades on purpose. On the tool path the model is now told
*which* case it is: "search is unavailable" makes it abstain or fall back to
grounding, while "the web had nothing" is a finding it may report.

---

## 5. Circuit breaker: before vs after

| | Before | After |
|---|---|---|
| Scope | One global breaker | Per provider |
| Counts | Individual searches | Consecutive **questions** in which that provider lost every attempt |
| One 6-search question | Opened the breaker; dropped its own tail; blanked the next user for 5 min | Contributes exactly **1**; all 6 attempted; breaker stays closed |
| One provider down | All search stopped | Failover; other provider keeps serving |
| Concurrency | Conflated with provider health | Separate global semaphore (`WEB_SEARCH_CONCURRENCY`) |
| Retry | None | One per provider, jittered, honours `Retry-After`, suppressed once the provider is known-bad for this question |
| Half-open probe | — | One at a time; **a failed probe re-arms the window** |

Question scoping uses `AsyncLocalStorage`, so the planned batch, the model's own
tool calls, and leaked-query recovery all account to one question. With no scope
active, a single search is its own question — a safe default.

### A defect found and fixed during implementation

The first half-open implementation left the breaker **permanently expired** after
a failed probe: `circuitOpen` reported `false` and every subsequent search went
upstream, so the breaker protected nothing after its first window. Caught by
direct probing during review, fixed by re-arming the window on a failed probe,
and now covered by two regression tests.

---

## 6. Observability

`/ready` reports `webSearch` and `inference` as independent blocks.

`webSearch` carries: enabled and configured providers, primary provider,
`usingFallback`, `circuitOpen` (true only when *every* enabled provider is out),
`lastDegradedReason`, `degradedSearches`, and per-provider health — breaker
state and reopen time, last success, last throttle, failure reason and counts.

Alert on: `circuitOpen`, `usingFallback` staying true, any provider's
`lastThrottledAt` advancing, or `lastDegradedReason` being set. For inference,
`dedicatedKey: false` means answers are still being generated on the same
credential as search.

Structured log events for an operator reading Railway logs:

| Event | Says |
|---|---|
| `web_search_rate_limited` | A provider throttled us, with attempt number |
| `web_search_failover` | Which provider we moved from, to, and why |
| `web_search_circuit_opened` / `_reopened` | Breaker tripped or re-armed, with reopen time |
| `web_search_degraded` | Search produced no evidence, with reason and `impact: "answer_has_no_search_evidence"` |
| `web_search_batch_completed` | Per-question rollup: evidence, degraded, empty, providers used |
| `inference_rate_limited` | The **inference** quota throttled, not search |

The intent is that degraded answer quality is immediately attributable to search
throttling, rather than being misread as model regression.

---

## 7. Environment variables

All are optional. A deployment setting only `MINIMAX_API_KEY` keeps its existing
behaviour.

| Variable | Purpose |
|---|---|
| `MINIMAX_INFERENCE_API_KEY` | Pay-as-you-go key for inference; falls back to `MINIMAX_API_KEY` |
| `MINIMAX_INFERENCE_BASE_URL` | Region-scoped inference host; falls back to `MINIMAX_BASE_URL` |
| `MINIMAX_SEARCH_API_KEY` | Search key; falls back to `MINIMAX_API_KEY` |
| `MINIMAX_SEARCH_URL` | Override for the undocumented search endpoint |
| `BRAVE_SEARCH_API_KEY` | Enables the documented second provider and automatic failover |
| `BRAVE_SEARCH_URL` | Override for the Brave endpoint |
| `WEB_SEARCH_PROVIDER_ORDER` | Chain order; default `minimax,brave` |
| `WEB_SEARCH_CONCURRENCY` | Searches in flight process-wide; default 2, max 8 |

Documented in both `.env.example` and `CLAUDE.md`.

---

## 8. Verification

Run from the repository root.

| Gate | Command | Result |
|---|---|---|
| API tests | `pnpm --filter @sports-predict/api test` | PASS — 39 files, **716 tests** (baseline 681; +35 new, 0 regressions) |
| API types | `npx tsc --noEmit` in `packages/api` | PASS |
| Production build | `pnpm build` | PASS — API and web |
| Secret scan | diff inspection + `git check-ignore .env` | PASS — see below |

### Test coverage added

Every scenario in the brief is covered, plus several found during
implementation:

- One question spawning multiple concurrent searches does not trip the breaker
- All of a failing question's searches are attempted, not skipped after the third
- Model tool-path searches account to the same question, not new ones
- One question's failures do not blank the next question's evidence
- MiniMax 429 falls over to Brave and still delivers evidence
- Failover on 5xx, malformed payload, rejected credential, and network error
- All providers failing yields an explicit degraded state, never silent `[]`
- Genuine zero results remain distinguishable from provider failure
- Each failure reason maps to its own typed value
- Inference works on the pay-as-you-go key alone, prefers it over the shared key,
  and still works on the shared key alone
- `/ready` accurately reports throttled-with-fallback and total-outage states
- Secrets never appear in logs or readiness output
- Retry storms suppressed; half-open probe re-arms; one probe at a time

### Operational simulation

Four scenarios were driven end to end against the real module with a stubbed
transport:

| Scenario | Result |
|---|---|
| MiniMax healthy, no fallback configured | 6/6 `ok`; breaker closed; no degradation |
| MiniMax 429, Brave healthy | 6/6 `ok` served by Brave; `usingFallback: true`; throttle recorded on MiniMax |
| MiniMax fully down, no fallback | 6 explicit `degraded` / `provider_unavailable`; all searches attempted; **1** failed question; breaker closed; next reader unaffected |
| Sustained outage across three questions | Breaker opens; **zero** further upstream calls; `circuit_open` returned |

### Secret handling

- `.env` confirmed gitignored (`.gitignore:2`)
- The real key value from `.env` appears **0 times** in the diff
- The only key-shaped strings in the diff are obviously-fake test fixtures
  (`payg-open-platform-key`, `brave-key-must-not-appear`)
- Dedicated tests assert no secret reaches logs or `/ready`
- `/ready` reports only *which variable* supplied a key and the endpoint host

---

## 9. Risks and limitations

1. **Brave's adapter has not been exercised against the live API.** It is
   implemented from the documented response shape and tested against mocks only.
   Run one real query before relying on it.
2. **Breaker state is per process.** Railway runs a single replica today, so this
   is currently exact. It needs revisiting if replica count is raised.
3. **Retry amplification under outage is bounded but non-zero.** Six searches
   cost eight upstream calls rather than six, because the first
   `WEB_SEARCH_CONCURRENCY` searches start before the provider is known-bad and
   still earn their transient-blip retry. Deliberate and capped.
4. **The MiniMax search endpoint remains undocumented.** It is now *optional*
   rather than load-bearing — but only once a second provider key is configured.

---

## 10. Deployment checklist

Nothing has been deployed. Before deploying:

1. Set `BRAVE_SEARCH_API_KEY` in Railway.
   **Without this there is still no fallback and the core fix is inert.**
2. Set `MINIMAX_INFERENCE_API_KEY` to a MiniMax Open Platform pay-as-you-go key.
3. Deploy, then confirm on `/ready`:
   - `inference.dedicatedKey: true`
   - `webSearch.enabledProviders: ["minimax", "brave"]`
   - `webSearch.circuitOpen: false`
4. Run one real question and confirm a `web_search_completed` event naming a
   provider.

---

## 11. Disposition

**The code is production-safe. The deployment is not yet — and the gap is
entirely configuration, not implementation.**

Silent failure is gone, throttling is visible and attributable to the correct
quota, and one question can no longer trip a breaker for the next reader.

But two of the four root causes are only *fixed in effect* once the environment
variables above are set. With no Brave key, failover has nowhere to go; with no
inference key, inference still shares search's quota. Until step 1 of the
checklist is done, a MiniMax throttle will still produce evidence-free answers —
the difference being that `/ready` and the logs will now say so plainly, instead
of leaving an operator to conclude that the model got worse.

One live Brave query should also be run before that path is considered proven.
