# Pundit — Football Prediction Analysis

Chat-first WC 2026 analysis. Active semifinals/final are grounded in precomputed Dixon-Coles/Poisson probabilities; tournament and clearly labelled general football questions are also supported. No blockchain, database, or trading. The former platform is archived at `archive/onchain-trading-v1`.

**Status:** Deployed (Vercel + Railway). `POST /api/ask` is live in production with the Anthropic key managed in Railway.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4), 2 packages: `api`, `web` |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui primitives (`components/ui/`) |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` |
| Data | ESPN public scoreboard/standings API, Polymarket Gamma API, worldcup-model static JSON — all public, no auth |

No Prisma, no Postgres, no wagmi/viem/RainbowKit, no Solidity/Hardhat. Don't reintroduce any of these without discussing it first — the whole point of the last pivot was to drop the trading platform.

---

## Data sources

| Source | Used by | Notes |
|---|---|---|
| **ESPN scoreboard/standings** (`packages/api/src/services/football-data.ts`) | `/api/matches/*` routes → `/fixtures` page | Public, keyless. Cron refresh every 6h. Returns real fixtures/results/standings with a `stage` field (`group-stage`, `round-of-32`, `round-of-16`, `quarterfinals`, `semifinals`, `3rd-place-match`, `final`). |
| **Polymarket Gamma API** (`packages/api/src/services/polymarket-data.ts`) | `/api/polymarkets/*` routes | Fetches the retained outright/group reference endpoints. Fixture-level discovery is owned by `worldcup-model`, not duplicated here. |
| **worldcup-model** (`model-data.ts`, `model-market-odds.ts`) | `/api/model/*`, `/model`, match grounding | Static JSON retains all 102 fixtures for evaluation. Its normalized endpoint supplies active Stake/Kalshi/Polymarket 1X2 prices for ESPN-active semifinals/final. |
| **Anthropic API** (`packages/api/src/services/ask.ts`) | `POST /api/ask` | Live in production. Supports featured-match grounding, tournament grounding, general football analysis, web search, and client-sourced conversation history. |

---

## Environment variables

```bash
# ── API ──────────────────────────────────────────────────────────────────────
API_PORT=3001
API_URL=http://localhost:3001

# ── Frontend (Next.js) ────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_USE_MOCK=true   # false hits the real API instead of mock-data.ts fallbacks

# ── worldcup-model (public, no key needed) ───────────────────────────────────
MODEL_DATA_BASE_URL=https://worldcup-model.vercel.app

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
- `/model` page: iframe embed of the external worldcup-model site — **do not touch**, per explicit standing instruction. Don't try to re-theme it, re-fetch its data, or replace the iframe with a native reimplementation.

---

## DO NOT

- Reintroduce Prisma/Postgres, wagmi/viem/RainbowKit, or any onchain trading concept without discussing it first.
- Read back, log, hardcode, or commit `ANTHROPIC_API_KEY`; it is managed only in Railway.
- Touch `/model`'s iframe embed.
- Assume `/api/polymarkets/*` or `/api/model/*` routes are dead just because no current page renders them — they're intentionally kept (see Data sources above).
- Call `fetch()` raw in page components for matches/standings data — go through `lib/mock-data.ts`'s wrappers, which honour `NEXT_PUBLIC_USE_MOCK`.
