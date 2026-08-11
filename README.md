# Pundit — Football Prediction Analysis

A chat-first analysis tool for the club season: Premier League and UEFA Champions League qualifiers. Ask about an upcoming match, the title race, or a general football topic and get a clearly labelled model-grounded or general read. No blockchain, no trading, nothing to buy — this is an analysis layer over public data.

World Cup 2026 live analysis is retired. The frozen backtest lives at `/evaluation/wc-2026`.

---

## Architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Next.js 14     │────────▶│   Express API    │────────▶│   MiniMax API    │
│   (chat UI)      │         │                  │         │   (chat answers) │
└──────────────────┘         └────────┬─────────┘         └──────────────────┘
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                 ┌───────────┐  ┌────────────┐  ┌──────────────┐
                 │ ESPN data │  │ ClubElo +  │  │ Stake/Kalshi │
                 │ + results │  │ Dixon-Coles│  │ /Polymarket  │
                 │           │  │ active set │  │ public odds  │
                 └───────────┘  └────────────┘  └──────────────┘
```

Public football/model/market sources are keyless and cached server-side on a cadence (ESPN + active market odds every 30 minutes, ClubElo + active model hourly). MiniMax powers the live chat through a Railway-managed secret. No database — everything is in-memory.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4) |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` (wire client for MiniMax's Anthropic-compatible endpoint) |

---

## Project Structure

```
packages/
  web/   — Next.js 14 frontend: chat homepage, /fixtures, /model, /evaluation/wc-2026
  api/   — Express REST API: /api/ask, /api/matches, /api/model, /api/evaluation
```

---

## Quick Start

Every env var has a sane default (see `.env.example`) — nothing needs to be configured to run this locally, and `packages/api` does not auto-load `.env` (no `dotenv` dependency), so exporting variables into your shell is what actually takes effect, not just editing the file.

```bash
pnpm install

export NEXT_PUBLIC_USE_MOCK=false
export NEXT_PUBLIC_API_URL=http://localhost:3001
export ALLOWED_ORIGINS=http://localhost:3000
export MINIMAX_API_KEY=sk-cp-...  # required for /api/ask

# Terminal 1 — API
cd packages/api && pnpm dev
# → http://localhost:3001

# Terminal 2 — Web
cd packages/web && pnpm dev
# → http://localhost:3000
```

`NEXT_PUBLIC_USE_MOCK=true` (the default) uses small hardcoded fixtures for `/fixtures` — no API needed to browse the frontend. Set it to `false` to hit the real API.

Chat requires `MINIMAX_API_KEY` in the API environment. It is configured in Railway production; local development must export its own key.

Local smoke checks (API must be running):

```bash
bash scripts/verify-local.sh
pnpm test && pnpm build
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/ask` | Multi-turn match, competition, or general football analysis. Requires `MINIMAX_API_KEY`. |
| GET | `/api/matches/competitions` | Enabled competition registry |
| GET | `/api/matches/active` | Active fixtures (14-day horizon) |
| GET | `/api/matches/upcoming` | Upcoming fixtures (ESPN, optional `?competition=`) |
| GET | `/api/matches/recent` | Recent results (ESPN) |
| GET | `/api/matches/standings` | Standings (ESPN) |
| GET | `/api/model/active` | Active club fixtures with model 1X2 probabilities |
| GET | `/api/model/fixtures` | Same as active set (optional `?competition=`) |
| GET | `/api/evaluation/club-season` | Rolling club-season calibration artifact |
| GET | `/api/evaluation/wc-2026` | Frozen WC 2026 backtest artifact |
| GET | `/health` | API health check |
| GET | `/ready` | Model, ESPN, active-fixture, and market-odds cache readiness |

`GET /api/model/wc` returns **410 Gone** — live WC model retired.

---

## Frontend Pages

- **`/`** — chat homepage: grounded active-match analysis, competition/table questions, and general football follow-ups
- **`/fixtures`** — multi-competition live schedule, results, and standings (ESPN-backed)
- **`/model`** — native reference view of active club fixture model probabilities
- **`/evaluation/club-season`** — rolling pre-kickoff club-season calibration
- **`/evaluation/wc-2026`** — frozen WC 2026 backtest metrics and fixture table

---

## Deploy

Production (July 2026):

| Service | URL |
|---|---|
| **Web (Vercel)** | [https://thepundit.vercel.app](https://thepundit.vercel.app) — project `sports-prediction-markets-web`, **Root Directory** `packages/web` |
| **API (Railway)** | [https://thepundit.up.railway.app](https://thepundit.up.railway.app) — service `@pundit/api` |

Verify the live stack after env or deploy changes:

```bash
pnpm verify:prod
```

### Railway (`@pundit/api`)

```bash
cd packages/api && railway up
```

| Variable | Production value |
|---|---|
| `MINIMAX_API_KEY` | Railway secret (required for chat) |
| `ALLOWED_ORIGINS` | `https://thepundit.vercel.app` (comma-separate extra origins if needed) |

### Vercel (`packages/web`)

```bash
cd packages/web && vercel --prod
```

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://thepundit.up.railway.app` |
| `NEXT_PUBLIC_USE_MOCK` | `false` |
| `NEXT_PUBLIC_DOCS_URL` | GitBook public URL after publishing `docs/` (enables footer and chat doc links) |

**GitBook:** connect the repo `docs/` folder (GitHub sync), publish, then set `NEXT_PUBLIC_DOCS_URL` in Vercel to the public space URL.

Required env vars for local dev are listed in `.env.example`. Never commit `MINIMAX_API_KEY`.

## Backtesting note

The WC 2026 evaluation at `/evaluation/wc-2026` uses a frozen reconstructed artifact. Live club-season fixtures are recalculated on each ClubElo refresh; rigorous ongoing calibration will require immutable pre-kickoff snapshots in a later pass.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
