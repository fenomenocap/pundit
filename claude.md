# Pundit — Football Prediction Analysis

Chat-first WC 2026 analysis. Active late-stage fixtures (semifinals, 3rd-place match, final) are grounded in precomputed model probabilities; tournament and clearly labelled general football questions are also supported. No blockchain, database, or trading. The former platform is archived at `archive/onchain-trading-v1`.

**Status:** Deployed (Vercel + Railway). `POST /api/ask` is live in production with the Anthropic key managed in Railway.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4), 2 packages: `api`, `web` |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui primitives (`components/ui/`) |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` |
| Data | ESPN, eloratings.net, Stake, Kalshi, and Polymarket public endpoints; model computed locally |

No Prisma, no Postgres, no wagmi/viem/RainbowKit, no Solidity/Hardhat. Don't reintroduce any of these without discussing it first — the whole point of the last pivot was to drop the trading platform.

---

## Data sources

| Source | Used by | Notes |
|---|---|---|
| **ESPN scoreboard/standings** (`packages/api/src/services/football-data.ts`) | `/api/matches/*` routes → `/fixtures` page | Public, keyless. Cron refresh every 30 minutes. Returns real fixtures/results/standings with a `stage` field (`group-stage`, `round-of-32`, `round-of-16`, `quarterfinals`, `semifinals`, `3rd-place-match`, `final`). Live scores are retained for in-play matches. |
| **eloratings.net** (`elo-ratings.ts`) | Local tournament and fixture model | Current TSV ratings are fetched on every hourly model refresh; missing tournament teams use the documented 1400 fallback with a warning. |
| **Local model** (`dixon-coles.ts`, `tournament-simulator.ts`, `model-data.ts`) | `/api/model/*`, `/model`, match grounding | Recomputes all ESPN fixtures and 100,000 tournament runs locally, carrying actual ESPN bracket pairings and authoritative winners forward. |
| **Stake/Kalshi/Polymarket** (`fixture-market-sources.ts`, `model-market-odds.ts`) | Featured match grounding | Direct best-effort public fetches normalize complete active 1X2 markets to no-vig probabilities every 30 minutes. Source failures remain isolated. |
| **Polymarket Gamma API** (`polymarket-data.ts`) | `/api/polymarkets/*` routes | Retained outright/group reference endpoints (6-hour refresh); the outright cache also supplies nullable tournament market prices. |
| **Anthropic API** (`packages/api/src/services/ask.ts`) | `POST /api/ask` | Live in production. Supports featured-match grounding, tournament grounding, general football analysis, web search, and client-sourced conversation history. |

---

## Environment variables

```bash
# ── API ──────────────────────────────────────────────────────────────────────
API_PORT=3001
API_URL=http://localhost:3001
# Comma-separated browser origins for CORS. Leave empty for open CORS (dev).
# Production should set the Vercel frontend origin(s).
ALLOWED_ORIGINS=http://localhost:3000

# ── Frontend (Next.js) ────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_USE_MOCK=true   # false hits the real API instead of mock-data.ts fallbacks

# ── Anthropic (required for POST /api/ask) ───────────────────────────────────
ANTHROPIC_API_KEY=
```

---

## Mock mode

`USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false"` (defaults **true**). Gates the wrappers in `packages/web/src/lib/mock-data.ts`, used by `/fixtures` and the homepage's featured-fixture suggestions.

---

## Design rules

- Dark theme only, CSS variables in `packages/web/src/app/globals.css` (navy background, cyan/pink accent hues via shadcn's HSL token convention).
- Mobile-first responsive.
- `/model` is a native read-only reference over Pundit's own `/api/model/*` cache. Keep it aligned with the existing API contract rather than introducing a second model path.

---

## DO NOT

- Reintroduce Prisma/Postgres, wagmi/viem/RainbowKit, or any onchain trading concept without discussing it first.
- Read back, log, hardcode, or commit `ANTHROPIC_API_KEY`; it is managed only in Railway.
- Add a runtime dependency on the archived `worldcup-model` deployment; the model and fixture-market normalizer are owned by this API now.
- Assume `/api/polymarkets/*` or `/api/model/*` routes are dead just because no current page renders them — they're intentionally kept (see Data sources above).
- Call `fetch()` raw in page components for matches/standings data — go through `lib/mock-data.ts`'s wrappers, which honour `NEXT_PUBLIC_USE_MOCK`.
