# Pundit — Exhaustive Project Overview

*Snapshot: 2026-08-25 · branch `main` @ `b60cd09` · 292 commits · deployed*

Pundit is a **chat-first football analysis product** for the club season (Premier League + UEFA Champions League qualifiers). You ask about an upcoming match, the title race, the table, or football in general, and you get a **clearly labelled** answer: either grounded in server-owned data (fixture model, ESPN table, season simulation) or explicitly marked as general analysis.

The defining constraint of the codebase: **when the server owns a complete answer, the LLM never touches it.** MiniMax is reserved for (a) evidence-required "current" turns that need live web search and citation verification, and (b) open-ended general/ungrounded analysis. Everything else renders deterministically from a grounding payload.

There is **no database, no blockchain, no trading, nothing to buy.** The former onchain parimutuel prediction market (Solidity on Base Sepolia, Prisma/Postgres, wagmi/RainbowKit) was fully removed and archived at git tag `archive/onchain-trading-v1`.

---

## 1. Product surface

### Frontend pages (`packages/web`, Next.js 14 App Router)

| Route | What it is |
|---|---|
| `/` | The product. Multi-turn chat with grounding badges, suggestion chips built from priced fixtures, inline market comparison rows, streaming (SSE), New Chat, copy/share actions, status-aware error copy. |
| `/fixtures` | Multi-competition live schedule, results and standings from ESPN, with competition tabs and "Ask about this match" links into chat. |
| `/model` | Read-only native reference view over the active club-fixture model cache (`/api/model/*`). |
| `/evaluation/club-season` | Rolling pre-kickoff club-season calibration artifact. |
| `/evaluation/wc-2026` | **Frozen** World Cup 2026 backtest — a historical credibility artifact, deliberately disconnected from live caches and cron. |

Chat status bar distinguishes `ready`, `partial` (some fixtures unpriced), `unpriced`, `no-fixtures`, `unavailable`. Suggestion chips only ever offer fixtures the model has actually priced, so a chip can never answer 503.

### API endpoints (`packages/api`, Express)

| Method | Path | Description |
|---|---|---|
| POST | `/api/ask` | The four-tier analysis endpoint. Requires a MiniMax key. Rate-limited 10/min deployment-wide. |
| GET | `/api/matches/competitions` | Enabled competition registry |
| GET | `/api/matches/active` | Active fixtures (14-day horizon) |
| GET | `/api/matches/upcoming` | Upcoming ESPN fixtures (`?competition=`) |
| GET | `/api/matches/recent` | Recent results |
| GET | `/api/matches/standings` | ESPN standings |
| GET | `/api/fixtures/recognized` | Approved structured fixture identities + current capability decisions. Never exposes discovery candidates. |
| GET | `/api/model/active` | Active club fixtures with model 1X2 |
| GET | `/api/model/fixtures` | Same set, optional `?competition=` |
| GET | `/api/model/wc` | **410 Gone** — live WC model retired |
| GET | `/api/evaluation/club-season` | Rolling calibration artifact |
| GET | `/api/evaluation/wc-2026` | Frozen backtest artifact |
| GET | `/api/polymarkets/wc`, `/groups` | Legacy reference odds |
| GET | `/health` | Liveness |
| GET | `/startup` | Startup gate (Railway healthcheck path) — 200 only when football + active model caches are usable |
| GET | `/ready` | Full readiness + degradable-source health (see §6) |
| GET | `/version` | Build SHA |

---

## 2. The four answer tiers

`POST /api/ask` resolves every question into exactly one tier, and the tier determines what grounding is attached and whether MiniMax is invoked at all.

1. **Match** — a recognized, policy-eligible active fixture. Grounding = Dixon-Coles 1X2 + totals + BTTS + scorelines, plus no-vig market comparison from Stake/Kalshi/Polymarket where complete. Complete no-search responses render deterministically.
2. **Competition** — ESPN standings only. `current table` / `current standings` are treated as explicit referential cues: they retain the most recent competition the user named, defaulting to the Premier League (the only supported league-style table). Arbitrary pronouns do **not** inherit competition context.
3. **Season** — Premier League title/top-four Monte Carlo (10,000 runs) over the remaining schedule, seeded deterministically from standings + fixtures + ratings + run count + contributor identity, so identical inputs replay identically.
4. **General** — clearly labelled general football analysis, with a mandatory disclaimer. This and evidence-required current turns are the only places MiniMax generates prose.

### Search-triggering policy

The word **"current" alone is not an external-search cue** for a server-owned table, model, or season fact. Externally-current cues — injuries, suspensions, lineups, managers, transfers, odds, recent results — always force bounded search. Search can never alter a fixture's capability decision or promote a discovery candidate into an established identity.

### Correctness guards (the bulk of `ask.ts`)

`packages/api/src/services/ask.ts` is **7,157 lines** — the largest file by an order of magnitude — because it encodes a long, hard-won list of failure modes. Categories:

- **Provenance segmentation** (`answer-provenance.ts`) — every sentence is classified `model` vs `evidence`, so guards can delete an uncited claim without wiping the model-derived verdict beside it.
- **Citation verification** (`claim-verifier.ts`, `evidence-page-retrieval.ts`) — positive current-news claims require a same-sentence, server-owned citation. Pages are fetched through an authority-tiered allowlist (`official` / `reputable` / `other`) with SSRF protection (`isPrivateOrReservedAddress`). Unverified claims are removed, or the answer abstains.
- **Market arithmetic** (`response-correctness.ts`) — complete 1X2 legs are validated (implied probabilities within tolerance) before any market claim survives. Incomplete markets fail closed. Third-party probabilities must carry an attribution label matching their origin.
- **Fail-closed fallbacks** — if verification supports no external claim, generated prose is *discarded* and only complete structured market rows already in grounding are rendered, with zero citations. If a match answer is emptied by guards, it fails over to the deterministic grounding payload rather than shipping blank.
- **Leak sweeping** — MiniMax tool-call markup, bracketed search directives, raw JSON tool payloads, retrieval reports, process narration ("Let me search…"), orphaned section labels, dangling section openers, empty emphasis, structurally incomplete tails, and truncated `<invoke name="` fragments are all stripped.
- **Semantics** — manager-era attribution (`attributeManagerEra`), contradictory directional rationale reconciliation, football geometry sanity (high line), score-string orientation ("which club is which half of 2–1"), totals mis-bucketing (`1-1` is not `over 2.5`), qualifier points language ("one point" ≠ "a draw"), decimal price normalization.
- **Guaranteed content** — a match read must state model-vs-market divergence, a value verdict, and a conditional close; these are composed deterministically if the model omits them.

Budgets: `PROVIDER_CALL_BUDGET = 10`, `MAX_CONTINUATIONS = 2`, 90-second shared request deadline, 12-turn / 12,000-character history cap.

---

## 3. Data sources

| Source | Module | Behaviour |
|---|---|---|
| **ESPN scoreboard/standings** | `football-data.ts` | Keyless. Enabled competitions refresh every 30 min (`FOOTBALL_DATA_REFRESH_INTERVAL_MS`), 15s fetch timeout. A separate **strictly complete** season-aware Premier League schedule is validated (`validateCompletePremierLeagueSchedule`), persisted atomically, with a 6-hour freshness deadline, a 60s safety margin, and last-good recovery for the simulator. |
| **Fixture registry** | `fixture-registry.ts` | Approved structured ESPN identities, persisted atomically with last-good recovery. Observes in **shadow mode** by default; `FIXTURE_REGISTRY_ENABLED` turns on expanded routing. Reviewed friendlies need an ESPN stable ID *plus* an official corroborating URL, and remain unpriced. Search results and user text create **candidates only** — never registry, grounding, or model input. |
| **Pinned ClubElo artifact** | `club-strength-artifact.ts`, `club-ratings.ts` | A reviewed, content-addressed `clubelo@1` snapshot ships with each release. **Production runtime never contacts ClubElo.** Selector, SHA-256 payload hash, coverage, plausible-rating bounds (500–3000) and a 30-day freshness gate all fail closed. Atomic `/data` current/last-good copies recover a damaged selector without changing inputs. |
| **Local model** | `dixon-coles.ts`, `model-data.ts` | Computes 1X2, totals, BTTS and scorelines for the 14-day active club-fixture set. Hourly refresh, 6-min cold retry. |
| **Stake / Kalshi / Polymarket** | `fixture-market-sources.ts`, `model-market-odds.ts` | Best-effort direct fetches, normalized to **no-vig** 1X2 every 30 min, scoped by market profile. Source failures stay isolated and are surfaced as `sourceWarnings`. |
| **Web search** | `web-search.ts` | See §4. |
| **Frozen WC evaluation** | `wc-evaluation.ts` | Read-only historical backtest. No cron, no live coupling. |
| **MiniMax** | `ask.ts` | `MiniMax-M3` over MiniMax's Anthropic-compatible endpoint, via `@anthropic-ai/sdk` as the wire client. Runs on its **own credential** (`MINIMAX_INFERENCE_API_KEY`) so inference no longer shares a subscription quota with search. |

### Competition registry (`config/competitions.ts`)

| id | Name | Enabled | Rating profile | Market profile | HFA |
|---|---|---|---|---|---|
| `eng.1` | Premier League | ✅ (priority 1) | `eng-clubs` | `premier-league` | yes |
| `uefa.champions_qual` | UCL Qualifiers | ✅ (priority 2) | `uefa-clubs` | `uefa-champions-league` | yes |
| `fifa.world` | FIFA World Cup 2026 | ❌ retired | `world` | `world-cup` | no |

---

## 4. Web search as a provider chain

Search is an **adapter seam, not a vendor integration** — MiniMax has no hosted search equivalent, so Pundit executes it.

- Providers implement `SearchProvider` and register in `KNOWN_PROVIDERS`. Today: `minimax` (undocumented `/v1/coding_plan/search`, default primary) and `brave` (documented, contractual, own quota and status page).
- `WEB_SEARCH_PROVIDER_ORDER` reorders the chain with no code change (`brave,minimax` promotes Brave). Unknown names are ignored; unnamed providers trail the chain.
- `searchWeb` returns a typed `WebSearchOutcome`: `ok` / `empty` / `degraded` + reason. **`empty` means the web genuinely had nothing** — every other case carries a reason, so a failure can never reach a caller as zero results.
- **Circuit breakers are per provider and per question**, not per search. One question fans out to ~6 searches; per-search accounting once let a single throttled question blank the next reader's evidence for 5 minutes. `withSearchQuestion()` scopes the accounting. Breaker opens after 3 consecutive failed *questions*, stays open 5 minutes.
- Bounds: 10s timeout, 2 attempts per provider with exponential backoff (250ms base, 1.5s cap, `Retry-After` honoured), 256KB response cap, 6 results max, 256-char query, 200-char titles, 600-char snippets, 2048-char URLs.
- `WEB_SEARCH_CONCURRENCY` (default 2, max 8) caps in-flight searches process-wide — a **load** control, deliberately independent of provider health.
- Health is reported on `/ready` under `webSearch`, separately from `inference`, because the two used to share a key and "which quota ran out" must be answerable from that payload alone.

---

## 5. The model

**Dixon-Coles bivariate Poisson**, computed locally (`dixon-coles.ts`, 172 lines):

- `ELO_SCALE = 400`, `DEFAULT_ELO = 1400`, `BASE_GOALS = 1.35`, `LAMBDA_CAP = 5`, `RHO = -0.1`, `MAX_GOALS = 10`, `DEFAULT_HOME_ADVANTAGE_ELO = 42`
- Elo → λ pair → score matrix → 1X2 / totals / BTTS / correct scores / ranked scorelines
- Home-field advantage applied per competition config (not for neutral sites)
- `simulateSeasonOutlook` (`season-simulator.ts`) — 10,000 Monte Carlo runs for title/top-four, seeded deterministically
- `runMonteCarlo` (`tournament-simulator.ts`) — 100,000 runs, group + bracket, retained from the WC-era pipeline
- Fixture recognition is a **gate, not a numeric input**: cancelled, postponed, unsupported, ambiguous or incomplete fixtures fail closed before pricing.

### Capability reasons (exact typed strings, preserved verbatim in public copy)

`friendly-policy-disabled` · `unsupported-competition` · `model-policy-disabled` · `model-initializing` · `ratings-refreshing` · `ratings-unavailable` · `neutral-venue-unknown` · `required-context-missing`

### Evaluation

- **`/evaluation/club-season`** — rolling, look-ahead-free calibration from immutable pre-kickoff snapshots (`club-season-snapshots.ts`, policy `pre-kickoff-90m-v1`, 90-minute window, ledger schema v2 with migration).
- **`/evaluation/wc-2026`** — frozen reconstructed backtest with Brier/log-loss style metrics and calibration buckets.
- **Contributor framework** (`model-contributors.ts`) — champion/challenger structure. `ELO_CHAMPION` is live; `REGISTERED_CHALLENGERS` is currently empty, i.e. the seam for growing off ClubElo onto proprietary data exists but is unpopulated.
- **Friendly shadow ledger** (`friendly-shadow-forecasts.ts`) — private-only, flag-gated (`FRIENDLY_SHADOW_ENABLED`), no collector and no public API/UI path. Setting the flag alone does not acquire or append forecasts.

---

## 6. Operations

### Deployment

| Service | Where |
|---|---|
| Web | Vercel — `thepundit.vercel.app`, project `sports-prediction-markets-web`, root dir `packages/web` |
| API | Railway — `thepundit.up.railway.app`, service `@pundit/api`, RAILPACK builder, healthcheck `/startup` (120s), restart ON_FAILURE ×10 |

Vercel builds are gated by `scripts/vercel-ignore-build.mjs`; Railway watches `/packages/api/**` plus root lockfiles/node version. Both are auto-deploy on push to `main`.

### Persistent state

There is **no database.** Runtime caches are in-memory; restart-critical state is atomic JSON under `PUNDIT_DATA_DIR` (a mounted Railway volume at `/data`, falling back to `packages/api/data` locally) via `persistent-store.ts`:

- rolling club-season calibration ledger
- club-strength artifact current/last-good recovery copies
- recognized-fixture registry + last-good copy
- complete Premier League season schedule + last-good copy
- private friendly-shadow ledger (only when separately enabled)

### `/ready` payload

Reports `model` (fixture count, ratings age, artifact id + SHA, cache-serving state), `football`, `seasonSchedule` (incl. `servingLastGood`, `ageMinutes`), `activeFixtures`, `webSearch` (per-provider health, breaker state, throttle timestamps, degraded reasons), `inference` (`dedicatedKey`, host, which env var supplied it — never the value), `askRateLimit` (resolved limit ÷ replicas), `marketOdds` (coverage + source warnings), `fixtureRegistry`.

Search health is deliberately **outside** the ready/not-ready decision: an outage should degrade an answer, not take the service down. Alert on `circuitOpen`, sustained `usingFallback`, advancing `lastThrottledAt`, or a set `lastDegradedReason`.

### Rate limiting

Global limiter 100/min. `/api/ask` uses one **process-wide** bucket (not per-IP) of `ASK_RATE_LIMIT_PER_MINUTE ÷ API_REPLICAS` — default 10 ÷ 1. Raise `API_REPLICAS` only when Railway's replica count actually changes.

### Security posture

`helmet`, allowlist CORS via `ALLOWED_ORIGINS` (open when unset, for dev), 32KB JSON body cap, `trust proxy 1`, SSRF guards on evidence page retrieval, `isSafeHref` on rendered markdown links, and process-level `unhandledRejection` / `uncaughtException` fatal logging.

---

## 7. Testing and CI

- **629 API test cases** across 34 Vitest suites. Heaviest: `ask.test.ts` (3,244 lines), `analysis-response.test.ts` (2,023), `answer-survival.test.ts` (1,352 — pins that a *correct* answer survives every guard, paired survive/still-blocked assertions per guard), `response-correctness-idempotence.test.ts` (running the guard three times must be stable), `answer-delivery-faults.test.ts`, `web-search.test.ts` (715).
- **Playwright** chromium smoke on `packages/web` in mock mode. No component unit tests by design.
- **CI** (`.github/workflows/ci.yml`) on PR *and* push to main: tsc both packages, verify pinned club-strength artifact, API Vitest, chat-eval harness unit tests, chat-eval dry-run config validation, Vercel ignored-build policy test, deployed-SHA resolution test, web build, Playwright smoke.
- **Verify Production** (`.github/workflows/verify-prod.yml`) on push to main: resolves the deployed SHA per target and runs `scripts/verify-prod.sh` against the live expansion-enabled registry.

### Chat eval harness (`scripts/chat-battle-test.mjs`, `evals/chat/scenarios.json`)

**Schema 16, 44 fixed scenarios**, hitting live production and real MiniMax credits — run manually after Tier 1+ deploys, never in CI. Scenario families: grounding routing and retention, fixture identity/two-legged tie resolution, capability contracts, market arithmetic and fail-closed behaviour, citation and abstention behaviour, geometry/history correctness, SSE ordering, client cancellation, malformed history.

Certification gates: ≥13,000ms preserved between request starts (monotonic offsets, 25ms scheduling margin, re-check after waking, four independent agreements required), required-traffic latency gate, per-target build-floor SHA convergence, a real deployment ID, clean browser evidence, and **critic PASS coverage for every successful HTTP-200 turn**. It fails certification on internal jargon leaking to users (`Dixon-Coles`, `ClubElo`, `model-grounded`), raw tool payloads, orphaned labels, or structurally incomplete endings. A timeout without a comparable prior run is `FAIL`, not an unproven "existing issue".

Latest recorded run (`artifacts/chat-evals/latest.json`, 2026-08-24, 49 turns): **`ISSUES FOUND`** — a run of match-arithmetic and citation scenarios did not complete. Release decisions require `overall: "PASS"`.

---

## 8. Repository layout

```
packages/
  api/                      Express + TypeScript, ~17k lines src
    src/index.ts            routes, readiness, ordered cache bootstrap
    src/config/competitions.ts
    src/routes/             ask · matches · model · evaluation · polymarkets
    src/services/           35 modules — see §3/§5
    src/lib/team-names.ts   canonical name/alias resolution
    data/                   pinned artifacts, registry, evaluation JSON
    scripts/                artifact build + verify, corpus build, ledger backup
  web/                      Next.js 14 App Router
    src/app/                page.tsx (chat) · fixtures · model · evaluation/*
    src/components/         home-chat.tsx (1,028 lines) + ui/ (shadcn primitives)
    src/lib/                api.ts (typed boundary) · mock-data.ts · team-logos · site-links
    e2e/smoke.spec.ts
docs/                       GitBook-synced: getting started, how it works,
                            API reference, architecture studies, ops, support
evals/chat/scenarios.json   44 certification scenarios
artifacts/chat-evals/       dated run reports (.json / .md / .critic.json)
scripts/                    chat eval harness, prod/local verify, SHA resolution,
                            Vercel ignore-build policy
CLAUDE.md / AGENTS.md       standing constraints for agentic work
```

### Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces 9.15.4, Node 22, 2 packages |
| Frontend | Next.js 14.2.35, React 18, TypeScript 5, TailwindCSS 3.4, shadcn/ui, react-markdown, lucide-react |
| Backend | Express 4.21, TypeScript 5.4, `@anthropic-ai/sdk` ^0.111, helmet 8, express-rate-limit 8, dotenv |
| Test | Vitest 2.1, Playwright 1.51 |

**Explicitly absent and not to be reintroduced without discussion:** Prisma, Postgres, wagmi/viem/RainbowKit, Solidity/Hardhat.

---

## 9. Environment variables

```bash
# API
API_PORT=3001
API_URL=http://localhost:3001
PUNDIT_DATA_DIR=                 # writable dir for restart-critical state; /data in prod
FIXTURE_REGISTRY_ENABLED=false   # expanded recognized-fixture routing; never enables friendly pricing
FRIENDLY_SHADOW_ENABLED=false    # private-only ledger library; flag alone collects nothing
ALLOWED_ORIGINS=http://localhost:3000

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_USE_MOCK=true        # false hits the real API
NEXT_PUBLIC_DOCS_URL=            # GitBook public URL; enables doc links

# MiniMax — shared fallback
MINIMAX_API_KEY=
MINIMAX_MODEL=MiniMax-M3
MINIMAX_BASE_URL=https://api.minimax.io/anthropic   # region-scoped; CN keys use api.minimaxi.com

# Dedicated inference credential (recommended in prod)
MINIMAX_INFERENCE_API_KEY=
MINIMAX_INFERENCE_BASE_URL=

# Search providers
MINIMAX_SEARCH_API_KEY=
MINIMAX_SEARCH_URL=
BRAVE_SEARCH_API_KEY=
BRAVE_SEARCH_URL=
WEB_SEARCH_PROVIDER_ORDER=       # default minimax,brave
WEB_SEARCH_CONCURRENCY=2         # max 8

# Rate limiting
ASK_RATE_LIMIT_PER_MINUTE=10
API_REPLICAS=1
```

Keys are managed in Railway for production and in the gitignored repo-root `.env` locally. They are never read back, logged, hardcoded or committed; `/ready` reports which variable supplied a key, never the value.

---

## 10. Development history

292 commits. The arc:

1. **Onchain parimutuel prediction market** — Solidity on Base Sepolia, Prisma/Postgres, wallet connection. Fully removed, archived at `archive/onchain-trading-v1`.
2. **World Cup 2026 pipeline** — live tournament model, Monte Carlo bracket, Polymarket comparison. Retired; credibility preserved as a frozen backtest.
3. **Club-season pivot** — Premier League + UCL qualifiers, ClubElo→Dixon-Coles, ESPN grounding, chat-first UI.
4. **Certification hardening** — PRs #83–#87 ("close production correctness gaps" → "close schema 16 certification gaps") plus a long tail of `fix(ask)` commits. Reading them in order is a catalogue of LLM answer-quality failure modes: tool markup reaching the chat bubble, guards deleting the model's own probabilities, market guards misreading a gap as a price, answers contradicting their own citations, follow-ups replaying the fixture card, narration preambles, punctuation left behind by a removed citation.
5. **Determinism push** — moving complete grounded answers off the LLM entirely, so the guards have less to catch.
6. **Recent, last ~5 commits** — deterministic decimal pricing, bounding the blast radius of a throttled question (per-question breakers), and stopping a player-price question from returning the match recital.

### Work in progress (uncommitted, ~1,900 insertions)

The **search provider chain and credential split** is built but not yet committed:

- `web-search.ts` (+935) — rewritten as a typed-outcome provider chain: `WebSearchOutcome`, per-provider `ProviderHealth`, `withSearchQuestion` scoping, bounded JSON reads, `Retry-After`-aware backoff, concurrency slots, Brave provider, configurable chain order.
- `ask.ts` (+247) — `InferenceStatus`, dedicated inference credential, `getInferenceStatus()`.
- `index.ts` (+17) — `webSearch` and `inference` blocks on `/ready`.
- `.env.example` (+37) and `CLAUDE.md` — documenting the split and the failover requirement.
- Tests: `web-search.test.ts` (+669), `readiness-route.test.ts` (+128), `ask.test.ts` (+117).

Also untracked: `.cursor/rules/prediction-model-improvement.mdc`.

---

## 11. Standing constraints

Recorded in `CLAUDE.md` / `AGENTS.md`, and load-bearing:

- Keep server-owned facts **deterministic** when grounding is complete. MiniMax must never restate a capability reason as a guessed lineup, squad, venue, rating or policy explanation.
- Search is a **seam**. Add a provider by implementing `SearchProvider`; never couple product behaviour to one provider's wire format.
- A search failure must **never** reach a caller as an empty result set.
- Breaker accounting is **per provider, per question**.
- "Current" alone does not force external search for owned table/model/season facts.
- **Source fidelity**: an all-zero table explicitly requested as the only evidence establishes no ranking — do not answer with ratings-and-schedule season probabilities.
- Capability reason strings are preserved **exactly** in public copy.
- `/model` stays aligned with the existing `/api/model/*` contract; no second model path.
- `/evaluation/wc-2026` stays frozen — no reconnection to live caches or cron.
- No raw `fetch()` in page components for matches/standings — go through `lib/mock-data.ts` so `NEXT_PUBLIC_USE_MOCK` is honoured.

### Known next step

**Paid unified odds API** — [The Odds API](https://the-odds-api.com/) is the candidate for when Stake/Kalshi/Polymarket scraper coverage becomes insufficient. Model probabilities would stay local; only market comparison would move to a single normalized feed.
