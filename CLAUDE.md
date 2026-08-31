# Pundit — Football Prediction Analysis

Chat-first club-season analysis for the Premier League and UEFA Champions League qualifiers. Recognized, policy-eligible active fixtures are grounded in locally computed match probabilities; recognized non-priced fixtures retain context with an explicit capability reason and no Pundit probabilities. Competition questions use ESPN standings, and other football questions are clearly labelled general analysis. World Cup 2026 live pipelines are retired, with historical credibility retained in the frozen backtest at `/evaluation/wc-2026`. No blockchain, database, or trading. The former platform is archived at `archive/onchain-trading-v1`.

**Status:** Deployed (Vercel + Railway). `POST /api/ask` is live in production with the MiniMax key managed in Railway.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node 22, pnpm 9.15.4), 2 packages: `api`, `web` |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui primitives (`components/ui/`) |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` (used as the wire client for MiniMax's Anthropic-compatible endpoint) |
| Data | ESPN, Stake, Kalshi, and Polymarket public endpoints; pinned ClubElo-derived strength artifact; model computed locally |

No Prisma, no Postgres, no wagmi/viem/RainbowKit, no Solidity/Hardhat. Don't reintroduce any of these without discussing it first — the whole point of the last pivot was to drop the trading platform.

---

## Data sources

| Source | Used by | Notes |
|---|---|---|
| **ESPN scoreboard/standings** (`packages/api/src/services/football-data.ts`) | `/api/matches/*`, `/fixtures`, competition and season grounding | Public and keyless. Enabled competition windows refresh every 30 minutes through bounded requests; scheduled, in-play, postponed and completed fixture state is retained. A separate strictly complete season-aware Premier League schedule is checked on that cadence and refreshed ahead of its six-hour freshness deadline, with atomic persistence and prior-generation recovery for the simulator. |
| **Fixture registry** (`fixture-registry.ts`) | `/api/fixtures/recognized`, chat routing, model eligibility | Approved structured ESPN identities are observed in shadow mode by default and persisted atomically with last-good recovery. Reviewed friendly records require an ESPN stable ID plus an official corroborating URL. Search and user text create candidates only and never become registry, grounding, or model input. Expanded routing is controlled by `FIXTURE_REGISTRY_ENABLED`; friendly pricing remains disabled. |
| **Pinned ClubElo artifact** (`club-strength-artifact.ts`, `club-ratings.ts`) | Active match model | A reviewed, content-addressed `clubelo@1` snapshot ships with each release and is loaded locally. Production runtime never contacts ClubElo. Hash, coverage and a 30-day freshness gate fail closed; atomic `/data` current/last-good copies recover a damaged release selector without changing inputs. |
| **Local model** (`dixon-coles.ts`, `model-data.ts`) | `/api/model/active`, `/api/model/fixtures`, `/model`, match grounding | Computes 1X2, totals, BTTS and scoreline probabilities for the 14-day active club-fixture set, including home-field advantage where configured. |
| **Stake/Kalshi/Polymarket** (`fixture-market-sources.ts`, `model-market-odds.ts`) | Active match grounding | Direct best-effort fetches normalize complete active 1X2 markets to no-vig probabilities every 30 minutes. Source failures remain isolated. |
| **Frozen WC evaluation** (`wc-evaluation.ts`) | `/api/evaluation/wc-2026`, `/evaluation/wc-2026` | Read-only historical backtest. It is not a live competition pipeline and has no cron. |
| **Web search** (`web-search.ts`) | `POST /api/ask` | Pundit-executed search tool, since MiniMax has no hosted equivalent. A **provider chain**, not a vendor: MiniMax's undocumented `/v1/coding_plan/search` is an optional provider (default primary), with Brave Search as a documented second provider behind the same seam. Any provider-level failure — 429, 5xx, timeout, malformed body, open breaker — fails over to the next enabled provider and is never reported as zero results. `searchWeb` returns a typed `WebSearchOutcome` (`ok` / `empty` / `degraded` plus a reason), so callers degrade on purpose. Breakers are **per provider** and count **per question**, not per search. Health is reported on `/ready` under `webSearch`. |
| **Grounded response layer** (`packages/api/src/services/ask.ts`) | `POST /api/ask` | Deterministically renders every no-search response with complete match, non-priced fixture, competition, or season grounding. “Current” alone is not an external-search cue for owned table, model, or season facts. An all-zero table requested as the sole source refuses a ranking rather than leaking a ratings-and-schedule forecast. Non-priced capability and identity-not-established candidate notices remain deterministic even when a mandatory current cue requires bounded search; search cannot alter capability or promote identity. If market verification establishes no supported claim, the response discards generated prose and renders only complete structured markets already present in match grounding, with no citations. Complete identical season inputs use a stable replay seed rather than request-local randomness. |
| **MiniMax API** (`packages/api/src/services/ask.ts`) | `POST /api/ask` | `MiniMax-M3` over MiniMax's Anthropic-compatible endpoint, on its own credential (`MINIMAX_INFERENCE_API_KEY`) so inference no longer shares a subscription quota with search. Health is reported on `/ready` under `inference`. It is limited to supported evidence-required prose plus general/ungrounded open-ended analysis; it does not override the deterministic grounded facts above. Supports the existing shared 90-second deadline, grounding-first SSE, web search/verification, and client-sourced conversation history. |

---

## Environment variables

```bash
# ── API ──────────────────────────────────────────────────────────────────────
API_PORT=3001
API_URL=http://localhost:3001
# Writable directory for state that must survive restarts: rolling club-season
# calibration, the club-strength artifact recovery copies, recognized-fixture registry/recovery copy,
# and the separately disabled private friendly-shadow ledger.
# Production points this at a mounted Railway volume (/data). Leave unset
# locally to use the in-repo packages/api/data directory.
PUNDIT_DATA_DIR=
# Shadow registry observes existing approved fixtures by default. Setting true
# enables expanded recognized-fixture routing; it never enables friendly prices.
FIXTURE_REGISTRY_ENABLED=false
# Private-only friendly policy/ledger library. No collector or public API/UI path;
# setting the flag alone does not acquire or append forecasts.
FRIENDLY_SHADOW_ENABLED=false
# Comma-separated browser origins for CORS. Leave empty for open CORS (dev).
# Production should set the Vercel frontend origin(s).
ALLOWED_ORIGINS=http://localhost:3000

# ── Frontend (Next.js) ────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_USE_MOCK=true   # false hits the real API instead of mock-data.ts fallbacks
NEXT_PUBLIC_DOCS_URL=         # optional GitBook public URL — enables "How it works" / "Learn more" links

# ── MiniMax (required for POST /api/ask) ─────────────────────────────────────
# Shared fallback for inference and search. Every override below is optional,
# so a deployment that sets only this keeps its existing behaviour.
MINIMAX_API_KEY=
# Optional overrides. The base URL is region-scoped: keys issued for mainland
# China authenticate only against https://api.minimaxi.com/anthropic.
MINIMAX_MODEL=MiniMax-M3
MINIMAX_BASE_URL=https://api.minimax.io/anthropic

# ── Inference credential (recommended in production) ─────────────────────────
# An Open Platform pay-as-you-go key. Answering costs ~1-3 inference calls and
# ~6 searches; sharing one coding-plan key meant retrieval spent the quota the
# answer needed, and a Claude Code session on the same subscription spent it
# too. Falls back to MINIMAX_API_KEY. /ready reports inference.dedicatedKey.
MINIMAX_INFERENCE_API_KEY=
MINIMAX_INFERENCE_BASE_URL=   # optional; falls back to MINIMAX_BASE_URL

# ── Web search providers ─────────────────────────────────────────────────────
# Search is a provider chain and MiniMax's endpoint is optional. Configure a
# second provider in production: without one, a throttle at MiniMax leaves
# answers with no evidence at all.
MINIMAX_SEARCH_API_KEY=       # optional; falls back to MINIMAX_API_KEY
MINIMAX_SEARCH_URL=           # optional override for the undocumented endpoint
BRAVE_SEARCH_API_KEY=         # documented second provider; enables failover
BRAVE_SEARCH_URL=
# Chain order. `brave,minimax` promotes Brave to primary with no code change.
# Unknown names are ignored; unnamed providers trail the chain.
WEB_SEARCH_PROVIDER_ORDER=    # default: minimax,brave
# Searches in flight process-wide. A load control, independent of provider
# health. Default 4, max 8.
WEB_SEARCH_CONCURRENCY=4

# ── Rate limiting for POST /api/ask ──────────────────────────────────────────
# The intended limit across the whole deployment. Every instance uses one
# process-wide bucket (not one per client IP), divided by API_REPLICAS.
# Railway runs a single replica today, so the default of 1 makes the configured
# limit the real one. Raise it only if the replica count is raised. /ready
# reports the resolved values under askRateLimit.
ASK_RATE_LIMIT_PER_MINUTE=10
API_REPLICAS=1
# Conversational response-facts architecture. On by default; set exactly false
# only for an emergency rollback. /ready reports its version and guard counters.
ANALYST_RESPONSE_V2=true
```

---

## Mock mode

`USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false"` (defaults **true**). Gates the wrappers in `packages/web/src/lib/mock-data.ts`, used by `/fixtures`. Homepage chat suggestions come from model-backed `/api/model/active` fixtures so every suggested matchup can receive match grounding.

---

## Design rules

- Dark theme only, CSS variables in `packages/web/src/app/globals.css` (navy background, cyan/pink accent hues via shadcn's HSL token convention).
- Mobile-first responsive.
- `/model` is a native read-only reference over Pundit's active club-fixture `/api/model/*` cache. Keep it aligned with the existing API contract rather than introducing a second model path.
- `/evaluation/wc-2026` is a frozen historical artifact. Do not reconnect it to live chat/model caches or cron.
- Keep server-owned facts deterministic when the grounding contract is complete. MiniMax may handle evidence-required current turns and general/ungrounded open-ended analysis, but it must not restate a recognized fixture's capability reason as a guessed lineup, squad, venue, rating, or policy explanation.
- In V2 match answers, numeric facts are rendered by the server from typed fact slots. Generated prose may select and connect approved facts, but it cannot supply probabilities, fair odds, market gaps, source IDs, betting recommendations, or lineup effects itself. Narrow fact and capability questions settle without retrieval; current team news still requires verified evidence.
- Search is an adapter seam, not a vendor integration. Add a provider by implementing `SearchProvider` in `web-search.ts` and registering it in `KNOWN_PROVIDERS`; never couple product behaviour to one provider's wire format.
- Never let a search failure reach a caller as an empty result set. `searchWeb` returns a typed outcome, and `empty` means the web had nothing — every other case carries a reason.
- Circuit-breaker accounting is per provider and per question. One question fans out into ~6 searches, so per-search accounting let a single throttled question blank the next reader's evidence for five minutes.
- Do not treat the word `current` by itself as requiring external search when the question asks for a complete server-owned table, model, or season-outlook fact. Manager, injury, lineup, transfer, odds and other external-current cues retain mandatory search.
- Preserve source fidelity: an all-zero table explicitly requested as the only evidence establishes no on-field ranking. Do not answer that request with season probabilities derived from ratings and the remaining schedule.
- Treat `current table` and `current standings` as explicit table references. Retain the most recent competition explicitly named in prior user turns; with no competition in view, use the Premier League as the only supported league-style table. Do not extend this retention to arbitrary pronouns.
- Preserve exact typed capability reasons in public copy: `friendly-policy-disabled`, `unsupported-competition`, `model-policy-disabled`, `model-initializing`, `ratings-refreshing`, `ratings-unavailable`, `neutral-venue-unknown`, or `required-context-missing`.

---

## DO NOT

- Reintroduce Prisma/Postgres, wagmi/viem/RainbowKit, or any onchain trading concept without discussing it first.
- Read back, log, hardcode, or commit `MINIMAX_API_KEY`, `MINIMAX_INFERENCE_API_KEY`, `MINIMAX_SEARCH_API_KEY` or `BRAVE_SEARCH_API_KEY`; they are managed in Railway for production and in the gitignored repo-root `.env` locally. `/ready` reports which variable supplied a key and never the value.
- Add a runtime dependency on the archived `worldcup-model` deployment or restore a live World Cup pipeline.
- Treat the frozen WC evaluation as current forecasts or regenerate it from current club ratings.
- Call `fetch()` raw in page components for matches/standings data — go through `lib/mock-data.ts`'s wrappers, which honour `NEXT_PUBLIC_USE_MOCK`.
