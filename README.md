# Pundit — Football Prediction Analysis

A chat-first analysis tool for the 2026 FIFA World Cup. Ask about the active semifinal/final, the title race, or a general football topic and get a clearly labelled model-grounded or general read. No blockchain, no trading, nothing to buy — this is an analysis layer over public data.

---

## Architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Next.js 14     │────────▶│   Express API    │────────▶│   Anthropic API  │
│   (chat UI)      │         │                  │         │   (chat answers) │
└──────────────────┘         └────────┬─────────┘         └──────────────────┘
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                 ┌───────────┐  ┌────────────┐  ┌──────────────┐
                 │ ESPN data │  │ Live Elo   │  │ Stake/Kalshi │
                 │ + results │  │ + local DC │  │ /Polymarket  │
                 │           │  │ simulation │  │ public odds  │
                 └───────────┘  └────────────┘  └──────────────┘
```

Public football/model/market sources are keyless and cached server-side on a cadence (ESPN + featured odds every 30 minutes, local model hourly, Polymarket reference every 6 hours). Anthropic powers the live chat through a Railway-managed secret. No database — everything is in-memory.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4) |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` |

---

## Project Structure

```
packages/
  web/   — Next.js 14 frontend: chat homepage, /fixtures, and the native /model reference
  api/   — Express REST API: /api/ask, /api/matches, /api/polymarkets, /api/model
```

---

## Quick Start

Every env var has a sane default (see `.env.example`) — nothing needs to be configured to run this locally, and `packages/api` does not auto-load `.env` (no `dotenv` dependency), so exporting variables into your shell is what actually takes effect, not just editing the file.

```bash
pnpm install

# Terminal 1 — API
cd packages/api && npm run dev
# → http://localhost:3001

# Terminal 2 — Web
cd packages/web && pnpm dev
# → http://localhost:3000
```

`NEXT_PUBLIC_USE_MOCK=true` (the default) uses small hardcoded fixtures for `/fixtures` — no API needed to browse the frontend. Set it to `false` to hit the real API.

Chat requires `ANTHROPIC_API_KEY` in the API environment. It is configured in Railway production; local development must export its own key.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/ask` | Multi-turn featured-match, tournament, or general football analysis. Requires `ANTHROPIC_API_KEY`. |
| GET | `/api/matches/upcoming` | Upcoming fixtures (ESPN) |
| GET | `/api/matches/recent` | Recent results (ESPN) |
| GET | `/api/matches/standings` | Group standings (ESPN) |
| GET | `/api/polymarkets/wc` | Live WC outright markets from Polymarket (reference odds — not currently rendered by any page) |
| GET | `/api/polymarkets/groups` | Live WC group-winner markets from Polymarket |
| GET | `/api/model/wc` | Locally generated team win/SF/QF probabilities |
| GET | `/api/model/fixtures` | Full fixture history with 1X2, totals, BTTS, scorelines, and results |
| GET | `/health` | API health check |
| GET | `/ready` | Model, ESPN, and fixture-market cache readiness |

---

## Frontend Pages

- **`/`** — chat homepage: grounded live semifinal/final analysis, tournament questions, and general football follow-ups
- **`/fixtures`** — live knockout bracket + group standings (ESPN-backed)
- **`/model`** — native reference view of Pundit's local tournament probabilities and fixture history

---

## Deploy

Production (July 2026):

| Service | URL |
|---|---|
| **API (Railway)** | `https://sports-predictapi-production.up.railway.app` |
| **Web (Vercel)** | Project `sports-prediction-markets-web` — set **Root Directory** to `packages/web` |

The repo is linked to two Vercel projects (`sports-prediction-markets-web` and legacy `football_prediction_market`). Only **`sports-prediction-markets-web`** should track this monorepo; disconnect or ignore the legacy project so production does not serve the old Kickpredict trading UI.

### Railway (`@sports-predict/api`)

```bash
cd packages/api && railway up
```

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Railway secret (required for chat) |
| `ALLOWED_ORIGINS` | Your Vercel frontend origin(s), comma-separated |

### Vercel (`packages/web`)

```bash
cd packages/web && vercel --prod
```

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://sports-predictapi-production.up.railway.app` |
| `NEXT_PUBLIC_USE_MOCK` | `false` |

After the first successful deploy, set the GitHub repo **homepage** to the Vercel production URL and add the same origin to Railway `ALLOWED_ORIGINS`.

Required env vars for local dev are listed in `.env.example`. Never commit `ANTHROPIC_API_KEY`.

## Backtesting note

Pundit regenerates and retains the full fixture and result history for future evaluation. Each refresh recalculates older fixture probabilities using current Elo ratings, so rigorous backtesting will require immutable pre-kickoff snapshots in a later pass; the present history must not be described as look-ahead-free.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
