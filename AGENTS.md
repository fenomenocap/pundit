# AGENTS.md — Pundit

Read `CLAUDE.md` first for architecture, data sources, and standing constraints.

## Current state

Pundit is a deployed chat-first WC 2026 analysis app. It has no blockchain or database; the former trading platform is archived at `archive/onchain-trading-v1`.

| Area | Current behavior |
|---|---|
| Chat homepage | Live multi-turn chat with status-aware errors, New Chat, grounding labels, active market comparisons, and suggestions derived from ESPN-active semifinals/final. |
| `POST /api/ask` | Three tiers: featured-match model grounding, tournament model grounding, and clearly labelled general football analysis. Uses aliases, a 12-turn/12,000-character history cap, web search, a 45-second Anthropic timeout, and 10 requests/minute limiting. |
| Full fixture history | `/api/model/fixtures` retains every upstream fixture with 1X2, totals, BTTS, top scorelines, and completed results including the authoritative winner. |
| Featured fixtures | ESPN is authoritative. Only scheduled/in-play semifinals and the championship final with known teams receive live match grounding and market rows; third place and completed matches are excluded from this derived view. |
| Fixture markets | `model-market-odds.ts` caches the companion model's normalized active Stake/Kalshi/Polymarket 1X2 markets. Do not reintroduce direct per-match provider discovery here. |
| `/fixtures` | Full live schedule/history, bracket, results, and standings from ESPN. |
| `/model` | Do-not-touch iframe of the external `worldcup-model` application. |
| CI | `.github/workflows/ci.yml` runs both TypeScript checks and API Vitest on pull requests. |

`packages/api` has focused Vitest coverage. `packages/web` intentionally has no test infrastructure yet; do not add it without a specific frontend-testing requirement.

## Production and secrets

- `ANTHROPIC_API_KEY` is configured on the Railway `@sports-predict/api` service. Never read it back, log it, hardcode it, or store it in the repository.
- `/health` is liveness. `/ready` reports model, ESPN, and fixture-market cache readiness without exposing secrets.
- Railway and all upstream data caches refresh every six hours and retain the last good data on refresh failure.

## Outstanding

- A rigorous backtest needs immutable pre-kickoff probability snapshots. The full fixture/result contract is retained now, but `worldcup-model` recalculates older fixtures with current Elo; snapshot storage and formal calibration reporting remain a separate pass.
- `/fixtures` could eventually add an “Ask about this match” link into chat.
- Other competitions require equivalent model data before extending grounded analysis beyond WC 2026.

## Key file map

```text
packages/api/src/
  index.ts                         — Express routes, readiness, ordered cache bootstrap
  routes/ask.ts                    — validation, history limits, 10/min limiter
  services/
    ask.ts                         — three-tier Anthropic orchestration and grounding
    model-data.ts                  — strict full-history worldcup-model cache
    football-data.ts               — ESPN fixtures/results/standings cache
    featured-fixtures.ts           — active semifinal/final ESPN-to-model join
    model-market-odds.ts           — normalized active fixture 1X2 cache
    polymarket-data.ts             — retained outright/group reference endpoints

packages/web/src/
  app/page.tsx                     — chat, featured suggestions, labels, inline odds
  app/fixtures/page.tsx            — full schedule/history and standings
  app/model/page.tsx               — DO NOT TOUCH external iframe
  lib/api.ts                       — typed API boundary
  lib/mock-data.ts                 — mock-aware fixture/standing wrappers
```

## GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use `gh auth git-credential`. A sandboxed `gh auth status` may report an invalid token because it cannot access Keychain even when host authentication is valid. Before asking the user to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.
