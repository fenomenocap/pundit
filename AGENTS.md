# AGENTS.md — Pundit

Read `CLAUDE.md` first for architecture, data sources, and standing constraints.

## Current state

Pundit is a deployed chat-first club-season analysis app (Premier League + UCL qualifiers). It has no blockchain or database; the former trading platform is archived at `archive/onchain-trading-v1`. World Cup 2026 live pipelines are retired — credibility lives on the frozen backtest at `/evaluation/wc-2026`.

| Area | Current behavior |
|---|---|
| Chat homepage | Live multi-turn chat with status-aware errors, New Chat, grounding labels (match/competition/season/general), active market comparisons, and suggestions from featured active club fixtures. |
| `POST /api/ask` | Four tiers: active-match model grounding (ClubElo + HFA), competition standings grounding (ESPN table), Premier League season outlook (Monte Carlo title/top-four), and clearly labelled general football analysis. Uses aliases, a 12-turn/12,000-character history cap, web search, a 90-second Anthropic timeout (240s overall), and 10 requests/minute limiting. |
| Active model | `/api/model/active` and `/api/model/fixtures` serve Dixon-Coles 1X2 (plus totals/BTTS/scorelines) for active club fixtures only. |
| Featured fixtures | Next N active fixtures across enabled competitions (EPL priority), joined to model rows for chat suggestions and market odds. |
| Fixture markets | `fixture-market-sources.ts` fetches Stake/Kalshi/Polymarket by market profile; `model-market-odds.ts` caches no-vig 1X2 for the active fixture set. Source failures stay isolated. |
| `/fixtures` | Multi-competition live schedule/history and standings from ESPN, with competition tabs and Ask-about-this-match links into chat. |
| `/model` | Native read-only view of active club fixture model probabilities; links to WC backtest. |
| `/evaluation/club-season` | Rolling pre-kickoff snapshot calibration (read-only JSON artifact). |
| `/evaluation/wc-2026` | Frozen WC 2026 backtest artifact (read-only, no cron). |
| CI | `.github/workflows/ci.yml` runs TypeScript checks, API Vitest, web build, and Playwright smoke tests on pull requests. |

`packages/api` has focused Vitest coverage. `packages/web` has Playwright smoke tests only (`pnpm --filter web test:e2e`); no component unit tests unless explicitly requested.

## Production and secrets

- `ANTHROPIC_API_KEY` is configured on the Railway `@sports-predict/api` service. Never read it back, log it, hardcode it, or store it in the repository.
- Optional `ALLOWED_ORIGINS` (comma-separated) restricts browser CORS; leave unset only while debugging, and set it to the Vercel frontend origin(s) in production.
- `/health` is liveness. `/ready` reports model, ESPN, active-fixture, and market-odds cache readiness without exposing secrets.
- Cache refresh cadences: ESPN fixtures/standings and active market odds every 30 minutes; ClubElo ratings and active model every hour. All retain last-good data on refresh failure.

## Production verification

Live URLs: **Web** [thepundit.vercel.app](https://thepundit.vercel.app) · **API** [sports-predictapi-production.up.railway.app](https://sports-predictapi-production.up.railway.app)

After Vercel or Railway env/config changes that affect production, run `pnpm verify:prod` from the repo root (~15s). For local dev against running servers, use `bash scripts/verify-local.sh`.

## Chat eval cadence

Production chat eval (`pnpm chat-eval:production`) hits live Anthropic credits — run manually after Tier 1+ deploys as a post-deploy smoke, not in CI. Unit tests for the harness run via `pnpm chat-eval:test` (no production traffic). Dry-run config check: `pnpm chat-eval:dry-run`.

Qualitative copy guards in `scripts/chat-battle-test-lib.mjs` fail answers containing internal jargon (`Dixon-Coles`, `ClubElo`, `model-grounded`) and 400 bodies leaking schema field names.

## Future

- **Paid unified odds API** — candidate provider [The Odds API](https://the-odds-api.com/) when Stake/Kalshi/Polymarket scraper coverage becomes insufficient. Model probabilities stay local; market comparison would move to a single normalized feed.

## Key file map

```text
packages/api/src/
  index.ts                         — Express routes, readiness, ordered cache bootstrap
  routes/ask.ts                    — validation, history limits, 10/min limiter
  services/
    ask.ts                         — four-tier Anthropic orchestration and grounding
    club-ratings.ts                — ClubElo CSV fetch/cache by rating profile
    dixon-coles.ts                 — Elo-to-goal and analytical score model (+ HFA)
    model-data.ts                  — active-club fixture model cache
    football-data.ts               — ESPN fixtures/results/standings cache
    active-fixtures.ts             — 14-day active fixture index
    featured-fixtures.ts           — cross-comp featured selector
    fixture-market-sources.ts      — Stake/Kalshi/Polymarket by market profile
    model-market-odds.ts           — normalized active fixture 1X2 cache
    wc-evaluation.ts               — frozen WC backtest read path
    club-season-snapshots.ts         — rolling pre-kickoff snapshot persistence
    season-simulator.ts              — PL title/top-four Monte Carlo

packages/web/src/
  app/page.tsx                     — chat, featured suggestions, labels, inline odds
  app/fixtures/page.tsx            — multi-comp schedule/history and standings
  app/model/page.tsx               — active club fixture model reference
  app/evaluation/club-season/page.tsx — rolling club-season calibration UI
  app/evaluation/wc-2026/page.tsx  — frozen WC backtest UI
  lib/api.ts                       — typed API boundary
  lib/mock-data.ts                 — mock-aware fixture/standing wrappers
  e2e/smoke.spec.ts              — Playwright UI shell smoke (mock mode)
  playwright.config.ts           — chromium-only, mock-mode webServer
```

## GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use `gh auth git-credential`. A sandboxed `gh auth status` may report an invalid token because it cannot access Keychain even when host authentication is valid. Before asking the user to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.
