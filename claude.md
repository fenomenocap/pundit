# Pundit — Football Prediction Analysis

Chat-first club-season analysis for the Premier League and UEFA Champions League qualifiers. Active fixtures are grounded in locally computed match probabilities; competition questions use ESPN standings, and other football questions are clearly labelled general analysis. World Cup 2026 live pipelines are retired, with historical credibility retained in the frozen backtest at `/evaluation/wc-2026`. No blockchain, database, or trading. The former platform is archived at `archive/onchain-trading-v1`.

**Status:** Deployed (Vercel + Railway). `POST /api/ask` is live in production with the Anthropic key managed in Railway.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4), 2 packages: `api`, `web` |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui primitives (`components/ui/`) |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` |
| Data | ESPN, ClubElo, Stake, Kalshi, and Polymarket public endpoints; model computed locally |

No Prisma, no Postgres, no wagmi/viem/RainbowKit, no Solidity/Hardhat. Don't reintroduce any of these without discussing it first — the whole point of the last pivot was to drop the trading platform.

---

## Data sources

| Source | Used by | Notes |
|---|---|---|
| **ESPN scoreboard/standings** (`packages/api/src/services/football-data.ts`) | `/api/matches/*`, `/fixtures`, competition grounding | Public and keyless. Enabled competitions refresh every 30 minutes; scheduled, in-play and completed fixture state is retained. |
| **ClubElo** (`club-ratings.ts`) | Active match model | Club ratings are cached by competition rating profile and refreshed hourly. |
| **Local model** (`dixon-coles.ts`, `model-data.ts`) | `/api/model/active`, `/api/model/fixtures`, `/model`, match grounding | Computes 1X2, totals, BTTS and scoreline probabilities for the 14-day active club-fixture set, including home-field advantage where configured. |
| **Stake/Kalshi/Polymarket** (`fixture-market-sources.ts`, `model-market-odds.ts`) | Active match grounding | Direct best-effort fetches normalize complete active 1X2 markets to no-vig probabilities every 30 minutes. Source failures remain isolated. |
| **Frozen WC evaluation** (`wc-evaluation.ts`) | `/api/evaluation/wc-2026`, `/evaluation/wc-2026` | Read-only historical backtest. It is not a live competition pipeline and has no cron. |
| **Anthropic API** (`packages/api/src/services/ask.ts`) | `POST /api/ask` | Four tiers: active-match model grounding, ESPN competition-standings grounding, Premier League season outlook (Monte Carlo), and clearly labelled general football analysis. Supports SSE streaming, web search, and client-sourced conversation history. |

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
NEXT_PUBLIC_DOCS_URL=         # optional GitBook public URL — enables "How it works" / "Learn more" links

# ── Anthropic (required for POST /api/ask) ───────────────────────────────────
ANTHROPIC_API_KEY=
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

---

## DO NOT

- Reintroduce Prisma/Postgres, wagmi/viem/RainbowKit, or any onchain trading concept without discussing it first.
- Read back, log, hardcode, or commit `ANTHROPIC_API_KEY`; it is managed only in Railway.
- Add a runtime dependency on the archived `worldcup-model` deployment or restore a live World Cup pipeline.
- Treat the frozen WC evaluation as current forecasts or regenerate it from current club ratings.
- Call `fetch()` raw in page components for matches/standings data — go through `lib/mock-data.ts`'s wrappers, which honour `NEXT_PUBLIC_USE_MOCK`.
