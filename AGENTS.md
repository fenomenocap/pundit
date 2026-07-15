# AGENTS.md — Pundit
# Agent Handoff: Status, Tasks, Blockers

Read `CLAUDE.md` first for architecture, data sources, and patterns. This file covers **current state** and **what to build next**.

---

## Current State

Chat-first WC 2026 matchup analysis app. No blockchain, no database — the previous onchain trading platform was fully removed (archived to git tag `archive/onchain-trading-v1`) in favor of this. A codebase hygiene pass just landed (dead code removed, docs rewritten, repo/folder renamed `football-prediction-market` → `pundit`, stale Railway env vars stripped).

### ✅ Complete — do not re-implement

| Area | What exists | Notes |
|---|---|---|
| Chat homepage | `packages/web/src/app/page.tsx` | Ask about a WC 2026 matchup, get a Claude-generated analysis. Calls `askQuestion()` in `lib/api.ts` → `POST /api/ask`. |
| `/api/ask` | `packages/api/src/routes/ask.ts` + `services/ask.ts` | Resolves two team names out of the question text, finds the matching cached fixture, calls Claude (`@anthropic-ai/sdk`) with the fixture's model probabilities as grounding, has a web-search tool available for injury/form news. Own rate limiter (10 req/min). **Built and correct — currently non-functional in production because `ANTHROPIC_API_KEY` is unset.** Do not treat this as a bug to fix by inventing a workaround; it's waiting on a credential only the user will provide. |
| `/fixtures` | `packages/web/src/app/fixtures/page.tsx` | Live knockout bracket + group standings, ESPN-backed. Unaffected by any of the above. |
| `/model` | `packages/web/src/app/model/page.tsx` | **Do not touch** — iframe embed of the external worldcup-model site, per standing explicit instruction. |
| API — matches | `packages/api/src/routes/matches.ts` + `services/football-data.ts` | ESPN public scoreboard/standings, no auth, 6h cron via `startFootballCron()` in `index.ts`. |
| API — polymarkets | `packages/api/src/routes/polymarkets.ts` + `services/polymarket-data.ts` | Still fetched/cached (6h cron), but **no current UI consumer** — the component that rendered this (`polymarket-ticker.tsx`) was removed as dead code during the hygiene pass. Kept because it's cheap and could back a future feature (see below). |
| API — model | `packages/api/src/routes/model.ts` + `services/model-data.ts` | worldcup-model static JSON, feeds both `/api/ask`'s grounding data and the (currently unused by any page) `/api/model/*` endpoints. |
| TypeScript | Both packages | 0 errors. Run `npx tsc --noEmit` in `packages/api` and `packages/web` to verify after any change. |

`packages/api` has a focused Vitest suite for backend pure functions and market parsers.
`packages/web` intentionally has no test infrastructure yet; this is a deliberate scope choice,
not an omission to fix without a specific frontend-testing requirement.

### GitHub authentication on macOS

GitHub CLI credentials are stored in the macOS keyring, and GitHub HTTPS operations use
`gh auth git-credential`. A sandboxed `gh auth status` may therefore report an invalid token
because it cannot access Keychain even when host authentication is valid. Before asking the user
to authenticate again, rerun `gh auth status` with escalated/host permissions. Never work around
Keychain isolation by writing a GitHub token to the repository, shell profile, or plaintext config.

---

## 🔴 Blocked on user — no code needed

| Blocker | Action needed | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | Get a key from console.anthropic.com | Railway `@sports-predict/api` service env vars — **explicitly not this agent's call to set**, has been raised and deferred multiple times |

---

## 🟡 Outstanding — forward-looking, not sequenced by urgency

**Revive Polymarket reference odds in the chat UI?** The Gamma API data (live WC outright + group-winner market prices) is fetched and cached server-side with zero current consumers. Worth deciding whether a chat answer should show "the market currently prices this at X%" alongside the model's own number, or whether this data source should just be dropped entirely if there's no plan to use it.

**`/fixtures`'s long-term relationship to the chat feature.** Right now it's a fully standalone reference page. Could `/api/ask` cite specific upcoming fixtures from it, or could the fixtures page link into a chat prompt for a given matchup ("ask about this game")?

**Extend `/api/ask` beyond WC 2026.** The team-resolution and fixture-grounding logic in `services/ask.ts` is generic Dixon-Coles-model plumbing — it would work for any competition once equivalent model JSON exists. Not urgent; no other competition's data exists yet.

**CI/CD.** No `.github/workflows` exist. At minimum, a workflow running `npx tsc --noEmit` in both packages on every PR would have caught issues faster during past passes.

---

## Key file map

```
packages/api/
  src/
    index.ts                — Express server; starts polymarketCron, modelCron, footballCron on boot
    middleware.ts            — requestLogger, AppError, errorHandler (no admin auth — was removed as dead code, nothing uses it)
    routes/
      ask.ts                 — POST /api/ask
      matches.ts             — GET /api/matches/{upcoming,recent,standings}
      polymarkets.ts         — GET /api/polymarkets/{wc,groups}
      model.ts               — GET /api/model/{wc,fixtures}
    services/
      ask.ts                 — team resolution, fixture grounding, Anthropic call
      football-data.ts       — ESPN fetch/parse/cache/cron
      polymarket-data.ts     — Gamma API fetch/cache/cron
      model-data.ts          — worldcup-model fetch/cache/cron, do not touch its consumer (/model)

packages/web/
  src/
    app/
      page.tsx               — chat homepage
      fixtures/page.tsx       — live bracket + standings
      model/page.tsx          — DO NOT TOUCH — external iframe embed
    components/
      navbar.tsx, footer.tsx
      ui/                     — shadcn primitives (Button, Input, Card, ScrollArea)
    lib/
      api.ts                 — typed fetch wrappers: askQuestion, getUpcomingMatches, getRecentMatches, getStandings
      mock-data.ts            — USE_MOCK-gated fallbacks for the three matches/standings fetchers (used by /fixtures)
      stage-label.ts          — formatStage(), STAGE_ORDER
      team-logos.ts           — getTeamFlag/getTeamColor, thin coverage (~16 teams)
```
