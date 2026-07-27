# AGENTS.md — Pundit

Read `CLAUDE.md` first for architecture, data sources, and standing constraints.

## Current state

Pundit is a deployed chat-first WC 2026 analysis app. It has no blockchain or database; the former trading platform is archived at `archive/onchain-trading-v1`.

| Area | Current behavior |
|---|---|
| Chat homepage | Live multi-turn chat with status-aware errors, New Chat, grounding labels, active market comparisons, and suggestions derived from ESPN-active semifinals/3rd-place/final. |
| `POST /api/ask` | Three tiers: featured-match model grounding, tournament model grounding, and clearly labelled general football analysis. Uses aliases, a 12-turn/12,000-character history cap, web search, a 90-second Anthropic timeout (240s overall), and 10 requests/minute limiting. |
| Full fixture history | `/api/model/fixtures` retains every upstream fixture with 1X2, totals, BTTS, top scorelines, and completed results including the authoritative winner. |
| Featured fixtures | ESPN is authoritative. Only scheduled/in-play semifinals, the 3rd-place match, and the championship final with known teams receive live match grounding and market rows; completed matches are excluded from this derived view. |
| Fixture markets | `fixture-market-sources.ts` fetches Stake/Kalshi/Polymarket directly and `model-market-odds.ts` caches complete active no-vig 1X2 prices for featured fixtures. Source failures stay isolated. |
| `/fixtures` | Full live schedule/history, bracket, results, and standings from ESPN, with live scores, freshness stamps, and Ask-about-this-match links into chat. |
| `/model` | Native read-only view of Pundit's local team probabilities and full fixture model history. |
| CI | `.github/workflows/ci.yml` runs both TypeScript checks and API Vitest on pull requests. |

`packages/api` has focused Vitest coverage. `packages/web` intentionally has no test infrastructure yet; do not add it without a specific frontend-testing requirement.

## Production and secrets

- `ANTHROPIC_API_KEY` is configured on the Railway `@sports-predict/api` service. Never read it back, log it, hardcode it, or store it in the repository.
- Optional `ALLOWED_ORIGINS` (comma-separated) restricts browser CORS; leave unset only while debugging, and set it to the Vercel frontend origin(s) in production.
- `/health` is liveness. `/ready` reports model, ESPN, and fixture-market cache readiness without exposing secrets.
- Cache refresh cadences: ESPN fixtures/standings and featured market odds every 30 minutes; local Elo/model every hour; Polymarket outright/group reference every 6 hours. All retain last-good data on refresh failure.

## Production verification

Live URLs: **Web** [thepundit.vercel.app](https://thepundit.vercel.app) · **API** [sports-predictapi-production.up.railway.app](https://sports-predictapi-production.up.railway.app)

After Vercel or Railway env/config changes that affect production, run `pnpm verify:prod` from the repo root (~15s). Do not launch a verifier subagent for routine infra checks — the script is the gate.

It checks: API `/health`, CORS allow/deny against `ALLOWED_ORIGINS`, and that the Vercel JS bundle inlines `NEXT_PUBLIC_API_URL`. On failure, fix the specific check, redeploy, and re-run.

## Outstanding

- A rigorous backtest needs immutable pre-kickoff probability snapshots. The full fixture/result contract is retained now, but each local refresh recalculates older fixtures with current Elo; snapshot storage and formal calibration reporting remain a separate pass.
- Other competitions require equivalent model data before extending grounded analysis beyond WC 2026.
- **Manual (dashboard only):** set GitHub repo homepage to `https://thepundit.vercel.app`; disconnect legacy Vercel project `football_prediction_market` from this repo (see README Deploy section).

## Key file map

```text
packages/api/src/
  index.ts                         — Express routes, readiness, ordered cache bootstrap
  routes/ask.ts                    — validation, history limits, 10/min limiter
  services/
    ask.ts                         — three-tier Anthropic orchestration and grounding
    dixon-coles.ts                 — Elo-to-goal and analytical score model
    elo-ratings.ts                 — live eloratings.net TSV parser/fetcher
    tournament-simulator.ts        — 100,000-run group/knockout simulation
    model-data.ts                  — locally generated full-history model cache
    football-data.ts               — ESPN fixtures/results/standings cache
    featured-fixtures.ts           — active semifinal/final ESPN-to-model join
    fixture-market-sources.ts      — direct Stake/Kalshi/Polymarket normalizers
    model-market-odds.ts           — normalized active fixture 1X2 cache
    polymarket-data.ts             — retained outright/group reference endpoints

packages/web/src/
  app/page.tsx                     — chat, featured suggestions, labels, inline odds
  app/fixtures/page.tsx            — full schedule/history and standings
  app/model/page.tsx               — native local-model reference
  lib/api.ts                       — typed API boundary
  lib/mock-data.ts                 — mock-aware fixture/standing wrappers
```

## GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use `gh auth git-credential`. A sandboxed `gh auth status` may report an invalid token because it cannot access Keychain even when host authentication is valid. Before asking the user to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.
