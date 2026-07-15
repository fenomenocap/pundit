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
                 │   ESPN    │  │ Polymarket │  │ worldcup-     │
                 │  public   │  │ Gamma API  │  │ model (JSON)  │
                 │   API     │  │            │  │               │
                 └───────────┘  └────────────┘  └──────────────┘
```

Public football/model/market sources are keyless and cached server-side every six hours. Anthropic powers the live chat through a Railway-managed secret. No database — everything is in-memory.

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
  web/   — Next.js 14 frontend: chat homepage, /fixtures (bracket + standings), /model (iframe)
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
| GET | `/api/model/wc` | Team win/SF/QF probabilities from worldcup-model |
| GET | `/api/model/fixtures` | Full fixture history with 1X2, totals, BTTS, scorelines, and results |
| GET | `/health` | API health check |
| GET | `/ready` | Model, ESPN, and fixture-market cache readiness |

---

## Frontend Pages

- **`/`** — chat homepage: grounded live semifinal/final analysis, tournament questions, and general football follow-ups
- **`/fixtures`** — live knockout bracket + group standings (ESPN-backed)
- **`/model`** — embedded reference view of the external worldcup-model site (do not modify — it's an iframe, not something this repo renders itself)

---

## Deploy

```bash
# API → Railway
cd packages/api && railway up

# Frontend → Vercel
cd packages/web && vercel --prod
```

Required env vars for each are listed in `.env.example`. Keep `ANTHROPIC_API_KEY` in Railway/Vercel secret management and never commit it.

## Backtesting note

Pundit retains the companion model's full fixture and result history for future evaluation. The current feed recalculates older fixture probabilities using current Elo ratings, so rigorous backtesting will require immutable pre-kickoff snapshots in a later pass; the present history must not be described as look-ahead-free.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
