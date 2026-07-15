# Pundit — Football Prediction Analysis

A chat-first analysis tool for the 2026 FIFA World Cup. Ask about a matchup — "France vs Morocco," "who wins Argentina vs Brazil" — and get a plain-language read grounded in a Dixon-Coles/Poisson statistical model, not vibes. No blockchain, no trading, nothing to buy — this is an analysis layer over public data.

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

All three right-hand sources are public, keyless, and cached server-side with a 6-hour cron. No database — everything is in-memory.

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

**Known limitation:** the chat feature (`POST /api/ask`) requires `ANTHROPIC_API_KEY` to be exported in the API's environment, which is currently unset both locally and in production. Without it, chat requests return a 502.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/ask` | Ask about a WC 2026 matchup, get a Claude-generated analysis grounded in model data. Requires `ANTHROPIC_API_KEY`. |
| GET | `/api/matches/upcoming` | Upcoming fixtures (ESPN) |
| GET | `/api/matches/recent` | Recent results (ESPN) |
| GET | `/api/matches/standings` | Group standings (ESPN) |
| GET | `/api/polymarkets/wc` | Live WC outright markets from Polymarket (reference odds — not currently rendered by any page) |
| GET | `/api/polymarkets/groups` | Live WC group-winner markets from Polymarket |
| GET | `/api/model/wc` | Team win/SF/QF probabilities from worldcup-model |
| GET | `/api/model/fixtures` | Fixture-level model odds from worldcup-model |
| GET | `/health` | API health check |

---

## Frontend Pages

- **`/`** — chat homepage: ask about any WC 2026 matchup
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

Required env vars for each are listed in `.env.example`. Note the deployed API is missing `ANTHROPIC_API_KEY` — set it on Railway for chat to work in production.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
