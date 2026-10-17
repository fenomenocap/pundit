# Pundit — Football Prediction Analysis

A chat-first analysis tool for the club season: Premier League and UEFA Champions League qualifiers. Ask about an upcoming match, the title race, or a general football topic and get a clearly labelled grounded or general read. Complete no-search grounded answers come directly from server-owned fixture, table, season, and capability data; MiniMax is reserved for verified-current evidence turns and general/ungrounded open-ended analysis. No blockchain, no trading, nothing to buy — this is an analysis layer over public data.

World Cup 2026 live analysis is retired. The frozen backtest lives at `/evaluation/wc-2026`.

---

## Architecture

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│   Next.js 15     │────────▶│   Express API    │────────▶│ OpenRouter /     │
│   (analysis desk)│         │  legacy + eval   │         │ MiniMax (fallback)│
└──────────────────┘         └────────┬─────────┘         └──────────────────┘
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                 ┌───────────┐  ┌────────────┐  ┌──────────────┐
                 │ ESPN data │  │ Pinned club │  │ Stake/Kalshi │
                 │ + results │  │ strength +  │  │ /Polymarket  │
                 │           │  │ local model │  │ public odds  │
                 └───────────┘  └────────────┘  └──────────────┘
```

Public football and market sources are keyless and cached server-side on a cadence (ESPN and active market odds every 30 minutes; the complete Premier League schedule is checked on that cadence and refreshed ahead of its six-hour freshness deadline). The active model recomputes hourly from a reviewed, content-addressed club-strength artifact and never contacts ClubElo at runtime. Every complete server-grounded no-search response bypasses MiniMax and renders deterministically; “current” alone does not force search for those owned facts. Externally current questions still use bounded search and verification. If a market search supports nothing, Pundit falls back only to complete structured market snapshots already in match grounding. There is no database: runtime caches are in memory, while restart-critical artifact recovery copies, the season schedule, calibration, recognized-fixture mappings, and optional private-shadow artifacts use atomic JSON files under `PUNDIT_DATA_DIR`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node 22, pnpm 9.15.4) |
| Frontend | Next.js 15 App Router, React 19, TypeScript, TailwindCSS, shadcn/ui |
| Backend | Express + TypeScript, `@anthropic-ai/sdk` (OpenRouter answers/search; MiniMax Anthropic-compatible fallback) |

---

## Project Structure

```
packages/
  web/   — Next.js 15 frontend: analysis desk, paper lab, /fixtures, /model, /evaluation
  api/   — Express REST API: /api/ask, /api/matches, /api/model, /api/evaluation
```

---

## Quick Start

Most env vars have safe local defaults (see `.env.example`). Local development
reads one gitignored repository-root `.env`: the API loads the whole file, and
`packages/web/next.config.mjs` copies in only its `NEXT_PUBLIC_*` values, so no
API secret enters the web process. Exported shell values, Vercel project env and
any `packages/web/.env*` file win over the root file. Railway and Vercel inject
production values directly.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# In .env: set NEXT_PUBLIC_USE_MOCK=false to hit the local API, and paste your
# own OPENROUTER_API_KEY (answers and search). Never commit it.

# Terminal 1 — API
cd packages/api && pnpm dev
# → http://localhost:3001

# Terminal 2 — Web
cd packages/web && pnpm dev
# → http://localhost:3000
```

`NEXT_PUBLIC_USE_MOCK=true` (the default) uses small hardcoded fixtures for `/fixtures` — no API needed to browse the frontend. Set it to `false` to hit the real API.

Without `OPENROUTER_API_KEY` (or the `MINIMAX_API_KEY` answer fallback) the API
still serves every server-rendered answer — priced match cards, tables, season
outlooks, capability notices — and returns 502 only for turns that need the
answer model. Search needs `OPENROUTER_API_KEY`. Production keys live in Railway.

Local smoke checks (API must be running):

```bash
bash scripts/verify-local.sh
pnpm test && pnpm build
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| POST | `/api/ask` | Multi-turn match, competition, or general football analysis. Server needs `OPENROUTER_API_KEY` (or `MINIMAX_API_KEY` fallback). |
| GET | `/api/matches/competitions` | Enabled competition registry |
| GET | `/api/matches/active` | Active fixtures (21-day horizon) |
| GET | `/api/matches/upcoming` | Upcoming fixtures (ESPN, optional `?competition=`) |
| GET | `/api/matches/recent` | Recent results (ESPN) |
| GET | `/api/matches/standings` | Standings (ESPN) |
| GET | `/api/fixtures/recognized` | Approved structured fixture identities and current capability decisions; never discovery candidates |
| GET | `/api/model/active` | Active club fixtures with model 1X2 probabilities |
| GET | `/api/model/fixtures` | Same as active set (optional `?competition=`) |
| GET | `/api/model/backtest-gate` | Pinned walk-forward backtest gate (`edgeValidationActive`, promotion flags) |
| GET | `/api/evaluation/club-season` | Rolling club-season calibration artifact |
| GET | `/api/evaluation/wc-2026` | Frozen WC 2026 backtest artifact |
| GET | `/health` | Process liveness |
| GET | `/startup` | Startup gate for usable football and active-model caches |
| GET | `/ready` | Runtime readiness and degradable-source status |
| GET | `/version` | API build SHA |

`GET /api/model/wc` returns **410 Gone** — live WC model retired.

---

## Frontend Pages

- **`/`** — analysis desk: live slate plus analyst pane for grounded match, table, season, and general questions
- **`/board`**, **`/draft`**, **`/vault`** — local paper lab on the same slate (not a bookmaker)
- **`/legacy`** — previous chat-only homepage
- **`/fixtures`** — multi-competition live schedule, results, and standings (ESPN-backed)
- **`/model`** — native reference view of active club fixture model probabilities
- **`/evaluation/club-season`** — rolling 90-minute pre-kickoff club-season ledger
- **`/evaluation/wc-2026`** — frozen WC 2026 backtest metrics and fixture table

---

## Deploy

Production:

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

| Variable | Role |
|---|---|
| `OPENROUTER_API_KEY` | Answers and search (primary) |
| `MINIMAX_API_KEY` | Answer fallback when OpenRouter unset |
| `ALLOWED_ORIGINS` | Vercel frontend origin(s) |
| `PUNDIT_DATA_DIR` | `/data` mounted volume |
| `CHAT_ENGINE` | Omit or `legacy` in production; `agent` is eval-only |

### Vercel (`packages/web`)

```bash
cd packages/web && vercel --prod
```

| Variable | Role |
|---|---|
| `NEXT_PUBLIC_API_URL` | Railway API URL |
| `NEXT_PUBLIC_USE_MOCK` | `false` in production |
| `NEXT_PUBLIC_DOCS_URL` | Published GitBook URL (enables in-app doc links) |

**GitBook:** connect the repo `docs/` folder (GitHub sync), publish, then set `NEXT_PUBLIC_DOCS_URL` in Vercel to the public space URL.

Required env vars for local dev are listed in `.env.example`. Never commit `OPENROUTER_API_KEY` or `MINIMAX_API_KEY`.

## Backtesting

- **WC 2026** — frozen reconstructed artifact at `/evaluation/wc-2026` (not live forecasts).
- **Club season** — rolling 90-minute pre-kickoff seals at `/evaluation/club-season` (production volume on Railway `/data`).
- **EPL walk-forward harness** — `model/backtest/` (`pnpm backtest:ci`, `pnpm backtest:run`); gate exposed at `GET /api/model/backtest-gate`. See [`docs/how-it-works/model-backtest.md`](docs/how-it-works/model-backtest.md).

Live model views recalculate from the release's pinned strength artifact on the adaptive model cadence.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
