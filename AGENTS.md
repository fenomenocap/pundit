# AGENTS.md — Pundit

Read `CLAUDE.md` first for architecture, data sources, and standing constraints.

## Current state

Pundit is a deployed chat-first club-season analysis app (Premier League + UCL qualifiers). It has no blockchain or database; the former trading platform is archived at `archive/onchain-trading-v1`. World Cup 2026 live pipelines are retired — credibility lives on the frozen backtest at `/evaluation/wc-2026`.

| Area | Current behavior |
|---|---|
| Chat homepage | Live multi-turn chat with status-aware errors, New Chat, grounding labels (match/competition/general), active market comparisons, and suggestions from featured active club fixtures. |
| `POST /api/ask` | Three tiers: active-match model grounding (ClubElo + HFA), competition standings grounding (ESPN table), and clearly labelled general football analysis. Uses aliases, a 12-turn/12,000-character history cap, web search, a 90-second Anthropic timeout (240s overall), and 10 requests/minute limiting. |
| Active model | `/api/model/active` and `/api/model/fixtures` serve Dixon-Coles 1X2 (plus totals/BTTS/scorelines) for active club fixtures only. |
| Featured fixtures | Next N active fixtures across enabled competitions (EPL priority), joined to model rows for chat suggestions and market odds. |
| Fixture markets | `fixture-market-sources.ts` fetches Stake/Kalshi/Polymarket by market profile; `model-market-odds.ts` caches no-vig 1X2 for the active fixture set. Source failures stay isolated. |
| `/fixtures` | Multi-competition live schedule/history and standings from ESPN, with competition tabs and Ask-about-this-match links into chat. |
| `/model` | Native read-only view of active club fixture model probabilities; links to WC backtest. |
| `/evaluation/wc-2026` | Frozen WC 2026 backtest artifact (read-only, no cron). |
| CI | `.github/workflows/ci.yml` runs both TypeScript checks and API Vitest on pull requests. |

`packages/api` has focused Vitest coverage. `packages/web` intentionally has no test infrastructure yet; do not add it without a specific frontend-testing requirement.

## Production and secrets

- `ANTHROPIC_API_KEY` is configured on the Railway `@sports-predict/api` service. Never read it back, log it, hardcode it, or store it in the repository.
- Optional `ALLOWED_ORIGINS` (comma-separated) restricts browser CORS; leave unset only while debugging, and set it to the Vercel frontend origin(s) in production.
- `/health` is liveness. `/ready` reports model, ESPN, active-fixture, and market-odds cache readiness without exposing secrets.
- Cache refresh cadences: ESPN fixtures/standings and active market odds every 30 minutes; ClubElo ratings and active model every hour. All retain last-good data on refresh failure.

## Production verification

Live URLs: **Web** [thepundit.vercel.app](https://thepundit.vercel.app) · **API** [sports-predictapi-production.up.railway.app](https://sports-predictapi-production.up.railway.app)

After Vercel or Railway env/config changes that affect production, run `pnpm verify:prod` from the repo root (~15s). For local dev against running servers, use `bash scripts/verify-local.sh`.

## Outstanding

- Immutable pre-kickoff probability snapshots for ongoing club-season calibration (WC evaluation artifact is enough for historical credibility).
- League-wide Monte Carlo title model (tier-2 uses standings only for now).
- `packages/web` test infrastructure (per above).
- Paid unified odds API.

## Key file map

```text
packages/api/src/
  index.ts                         — Express routes, readiness, ordered cache bootstrap
  routes/ask.ts                    — validation, history limits, 10/min limiter
  services/
    ask.ts                         — three-tier Anthropic orchestration and grounding
    club-ratings.ts                — ClubElo CSV fetch/cache by rating profile
    dixon-coles.ts                 — Elo-to-goal and analytical score model (+ HFA)
    model-data.ts                  — active-club fixture model cache
    football-data.ts               — ESPN fixtures/results/standings cache
    active-fixtures.ts             — 14-day active fixture index
    featured-fixtures.ts           — cross-comp featured selector
    fixture-market-sources.ts      — Stake/Kalshi/Polymarket by market profile
    model-market-odds.ts           — normalized active fixture 1X2 cache
    wc-evaluation.ts               — frozen WC backtest read path

packages/web/src/
  app/page.tsx                     — chat, featured suggestions, labels, inline odds
  app/fixtures/page.tsx            — multi-comp schedule/history and standings
  app/model/page.tsx               — active club fixture model reference
  app/evaluation/wc-2026/page.tsx  — frozen WC backtest UI
  lib/api.ts                       — typed API boundary
  lib/mock-data.ts                 — mock-aware fixture/standing wrappers
```

## GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use `gh auth git-credential`. A sandboxed `gh auth status` may report an invalid token because it cannot access Keychain even when host authentication is valid. Before asking the user to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.
