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
  web/   — Next.js 15 frontend: analysis desk, /fixtures (+ EPL table), /board (bet slip), /draft (FPL simulator), /evaluation (track record)
  api/   — Express REST API: /api/ask, /api/matches, /api/model, /api/evaluation, /api/fpl
deploy/do/ — DigitalOcean API deploy: compose, Caddy, blue/green swap.sh, SSH deploy.sh
docs/  — GitBook source (Git Sync from this folder; see docs/SUMMARY.md)
```

---

## Quick Start

Most env vars have safe local defaults (see `.env.example`). Local development
reads one gitignored repository-root `.env`: the API loads the whole file, and
`packages/web/next.config.mjs` copies in only its `NEXT_PUBLIC_*` values, so no
API secret enters the web process. Exported shell values, Vercel project env and
any `packages/web/.env*` file win over the root file. Production values come from
the API's env file on the DigitalOcean droplet and from the Vercel project.

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
answer model. Search needs `OPENROUTER_API_KEY`. Production keys live in the droplet's env file (never in git).

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
| GET | `/api/evaluation/club-season` | Track record: club-season calibration artifact, one scored forecast per match (`evaluation.dedupe`) |
| GET | `/api/evaluation/wc-2026` | Frozen WC 2026 backtest artifact |
| GET | `/api/fpl/bootstrap` | Public FPL player data for the `/draft` simulator (1 h cache, stale-on-error) |
| GET | `/health` | Process liveness |
| GET | `/startup` | Startup gate for usable football and active-model caches |
| GET | `/ready` | Runtime readiness and degradable-source status |
| GET | `/version` | API build SHA |

`GET /api/model/wc` returns **410 Gone** — live WC model retired.

---

## Frontend Pages

- **`/`** — analysis desk: live slate plus analyst pane for grounded match, table, season, and general questions
Nav: Desk · Fixtures · Bet slip · FPL · Track record.

- **`/fixtures`** — schedule grouped by day, forecasts (goals/scorelines and market comparison behind toggles) and a formal Premier League table
- **`/board`** — bet slip: singles and accumulators with combined odds and potential returns updating live (a calculator; no wallet or wager)
- **`/draft`** — FPL team simulator: 15-man squad, £100.0m, max 3 per club, XI, captain and vice, from public FPL data ("Simulator only … Not affiliated with the Premier League")
- **`/evaluation/club-season`** — Track record: one scored pre-kickoff forecast per match, plus the "How the forecasts work" section (`#methodology`)
- **`/model`** — removed; 308 redirect to `/evaluation/club-season#methodology`
- **`/legacy`** — previous chat-only homepage (not in the nav); `/vault` is also no longer linked
- **`/evaluation/wc-2026`** — frozen WC 2026 backtest metrics and fixture table

---

## Deploy

Production:

| Service | URL |
|---|---|
| **Web (Vercel)** | [https://thepundit.vercel.app](https://thepundit.vercel.app) — project `sports-prediction-markets-web`, **Root Directory** `packages/web` |
| **API (DigitalOcean)** | [https://134-209-121-101.sslip.io](https://134-209-121-101.sslip.io) — Docker blue/green behind Caddy, deployed by `.github/workflows/deploy-do.yml` |

Railway (`thepundit.up.railway.app`) is retired as the API host since 22 Oct 2026; it may still serve a frozen build and must not be used. Full pipeline: [`docs/ops/deploy.md`](docs/ops/deploy.md).

Verify the live stack after env or deploy changes:

```bash
pnpm verify:prod
```

### API (DigitalOcean)

Merges to `main` deploy automatically: after CI passes, `deploy-do.yml` sends the exact CI-tested sha to the droplet, where `deploy/do/swap.sh` runs a health-gated zero-downtime blue/green swap; Verify Production runs after the deploy. See [`deploy/do/README.md`](deploy/do/README.md). Droplet and env-file changes are made by the owner only.

| Variable | Role |
|---|---|
| `OPENROUTER_API_KEY` | Answers and search (primary) |
| `MINIMAX_API_KEY` | Answer fallback when OpenRouter unset |
| `ALLOWED_ORIGINS` | Vercel frontend origin(s) |
| `PUNDIT_DATA_DIR` | `/data` (bind mount of `/opt/pundit-data`) |
| `FIXTURE_REGISTRY_ENABLED` | `true` in production |
| `ONE_X_TWO_TEMPERATURE_ENABLED` | Off (unset); enabling needs the owner's approval |
| `CHAT_ENGINE` | Omit or `legacy` in production; `agent` is eval-only |

### Vercel (`packages/web`)

Vercel builds only on `main` and only when web/shared inputs change (`scripts/vercel-ignore.sh`); docs-only and API-only merges are skipped.

| Variable | Role |
|---|---|
| `NEXT_PUBLIC_API_URL` | DigitalOcean API URL (inlined at build) |
| `NEXT_PUBLIC_USE_MOCK` | `false` in production |
| `NEXT_PUBLIC_DOCS_URL` | Published GitBook URL (enables in-app doc links) |

**GitBook:** published at [pundit.gitbook.io/pundit-docs](https://pundit.gitbook.io/pundit-docs) by GitBook Git Sync from `docs/` (`docs/.gitbook.yaml`). Merging to `main` updates it; edit docs in git, not in the GitBook editor.

Required env vars for local dev are listed in `.env.example`. Never commit `OPENROUTER_API_KEY` or `MINIMAX_API_KEY`.

## Backtesting

- **WC 2026** — frozen reconstructed artifact at `/evaluation/wc-2026` (not live forecasts).
- **Club season** — Track record at `/evaluation/club-season`: rolling 90-minute pre-kickoff seals, one scored per match (production volume on the API's `/data`).
- **Methodology** — data sources, calibration evidence, known limits and pin expiry: [`docs/methodology.md`](docs/methodology.md).
- **EPL walk-forward harness** — `model/backtest/` (`pnpm backtest:ci`, `pnpm backtest:run`); gate exposed at `GET /api/model/backtest-gate`. See [`docs/how-it-works/model-backtest.md`](docs/how-it-works/model-backtest.md).

Live model views recalculate from the release's pinned strength artifact on the adaptive model cadence.

---

## History

This was originally an onchain parimutuel prediction market (Solidity contracts on Base Sepolia, Prisma/Postgres, wagmi wallet connection). That platform was fully removed and archived to git tag `archive/onchain-trading-v1` in favor of the current chat-first analysis product — recoverable via `git checkout archive/onchain-trading-v1` if ever needed.

---

## License

MIT
