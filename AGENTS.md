# AGENTS.md — Pundit Prediction Market
# Agent Handoff: Status, Tasks, Blockers

Read CLAUDE.md first for architecture, constraints, and patterns. This file covers **current state** and **what to build next**.

---

## Current State (as of July 2026)

Contracts are deployed to Base Sepolia, the API is live on Railway, Postgres is live, and `NEXT_PUBLIC_USE_MOCK=false` — this is not a mock-mode demo anymore, it's a live (if untraded) testnet app. A design/content overhaul just landed to make the site feel current for the WC 2026 knockout stage. Read this table before touching any of these files — several were rewritten or deleted this pass.

### ✅ Complete — do not re-implement

| Area | What exists | Notes |
|---|---|---|
| Smart contracts | `MarketFactory`, `ParimutuelEngine`, `CollateralVault`, `OracleResolver`, `MockUSDC` | 58/58 tests passing, deployed to Base Sepolia (see `.env` for addresses) |
| Market seeding | `packages/contracts/scripts/seed-wc.ts` | 96 WC 2026 markets seeded: 48 outrights (still open, resolve 2026-07-20) + 48 group-stage matchups (all now past resolution — see Task A) |
| API — markets | `packages/api/src/routes/markets.ts` | CRUD, admin create/resolve, Polymarket odds enrichment on **both** list and detail endpoints (`polyById` lookup in the list route — do not re-add, it already exists) |
| API — matches | `packages/api/src/routes/matches.ts` + `packages/api/src/services/football-data.ts` | **Rewritten this pass.** No longer football-data.org (required a paid/signup API key) — now pulls from ESPN's public, keyless scoreboard API (`site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard`) and standings API (`site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings`). Returns real fixtures/results/standings with a `stage` field (`group-stage`, `round-of-32`, `round-of-16`, `quarterfinals`, `semifinals`, `3rd-place-match`, `final`). Cron wired in `index.ts` via `startFootballCron()`. |
| Frontend — homepage | `packages/web/src/app/page.tsx` | **Rewritten this pass.** Hero is now a live "next match" banner (team colors, flags, countdown) instead of a static tagline. Fake "Trending Markets" (random %) panel removed. Recent Results panel uses real ESPN data. Polymarket section is now a compact auto-scrolling ticker (`polymarket-ticker.tsx`), not a card grid. Market grid filters out markets past `resolutionTimestamp`, filters out **eliminated teams** (`lib/team-status.ts` — cross-references `/api/matches/standings` `advanced` flag + knockout-stage results), and **deduplicates** outright markets by team (works around the DB duplicate-seeding bug, see Task A2) before splitting into a `MarketCard` grid (real matchups) + `OutrightsBoard` (binary outright markets, dense sportsbook-style list). `OutrightsBoard` now shows real odds where available: pool → Polymarket reference → **worldcup-model win probability** (labeled "est.") → flat 50/50 only as last resort — this replaced a wall of identical 50/50 rows with real favorite/longshot differentiation. |
| Color palette | `packages/web/tailwind.config.ts` | Overrode stock `cyan`/`pink` 50-900 shades to Tailwind's own `sky`/`rose` values — calmer, higher-contrast, less neon than the defaults. Semantic meaning unchanged (cyan=Yes/ours, pink=No/Away per CLAUDE.md), only the actual hex values shifted. Ripples through every component automatically — don't hardcode hex values elsewhere, keep using the `cyan-*`/`pink-*` classes. |
| Frontend — fixtures | `packages/web/src/app/fixtures/page.tsx` **(new)** | Live knockout bracket + group standings, sourced from the ESPN-backed `/api/matches/*` endpoints. Linked from navbar. |
| Frontend — market detail | `packages/web/src/app/market/[id]/page.tsx` | Trading terminal layout unchanged structurally; badges/odds bumped to bolder pill style this pass. |
| Frontend — pool breakdown | `packages/web/src/components/pool-breakdown.tsx` **(new, replaces `orderbook.tsx` — deleted)** | Parimutuel markets have no real order book (no limit orders/matching engine). The old `Orderbook` component fabricated random bid/ask ladders with `Math.random()` — deleted. This shows real pool composition (amount + % + payout multiplier per outcome) instead. |
| Frontend — outcome detail | `packages/web/src/components/outcome-detail.tsx` | Also had a fake-trades generator (12 random trades whenever real trades were empty) — removed. Now honestly shows "No trades yet" when that's true. Tab renamed "Order Book" → "Pool". |
| Frontend — portfolio | `packages/web/src/app/portfolio/page.tsx` | Summary strip converted to bold stat blocks this pass. Logic unchanged. |
| Frontend — leaderboard | `packages/web/src/app/leaderboard/page.tsx` | Top-3 ranks now show medal emoji. Logic unchanged. |
| Frontend — model | `packages/web/src/app/model/page.tsx` | **Not touched this pass — leave alone per explicit user instruction.** Embeds the external `worldcup-model` iframe. |
| Frontend — arena | `packages/web/src/app/arena/page.tsx` | Still "Coming soon" — explicitly left alone this pass, not a placeholder bug. |
| Design tokens | `packages/web/src/app/globals.css` | `--radius` bumped 0.375rem → 0.625rem, `animate-marquee` keyframe added for the ticker. Palette (cyan/pink/amber/purple) unchanged — keep using it, don't reinvent. |
| TypeScript | All packages | 0 errors. Run `npx tsc --noEmit` in `packages/web` and `packages/api` to verify after any change. |

### 🗑️ Deleted this pass — do not resurrect

- `packages/web/src/components/polymarket-card.tsx` → replaced by `polymarket-ticker.tsx`
- `packages/web/src/components/orderbook.tsx` → replaced by `pool-breakdown.tsx`

---

## 🔴 Blocked on user — no code needed

These require credentials/infrastructure the user must configure manually:

| Blocker | Action needed | Where |
|---|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | cloud.walletconnect.com | `.env` (already set — verify still valid) |
| `ETHERSCAN_API_KEY` | basescan.org → API Keys, for contract verification | `.env` |
| Real Polymarket condition IDs | See Task A below — this needs Polymarket's actual Gamma API market list, not guessed/placeholder IDs | n/a |

---

## 🟡 Outstanding tasks — sequenced by priority

### Track 1 — Data fixes (do first — highest visible impact, no new infra needed)

**Task A: Fix the broken `polymarketId` → odds linkage (Priority: HIGH)**

Confirmed bug: every outright market's `polymarketId` (set in `seed-wc.ts`) does not match any currently-cached live Polymarket condition ID. The enrichment code in `markets.ts` (`polyById.get(m.polymarketId)`) is correct and already works for the ticker — it's the seed data that's wrong. Result: all 48 outright cards fall back to flat 50/50, which reads as broken/low-effort.

- Write `packages/api/src/scripts/sync-polymarket-ids.ts`: fetch `/api/polymarkets/wc`, fuzzy-match question strings ("Will Brazil win the 2026 FIFA World Cup?" vs Polymarket's actual phrasing) against our 48 outright markets, `PATCH` matches above ~85% confidence via a new admin endpoint.
- Add `PATCH /api/markets/:id` (admin-only, `x-admin-key`) accepting `{ polymarketId: string }`.
- Never auto-link below the confidence threshold — print a diff for human review first.
- Once linked, `OutrightsBoard` and `MarketCard` will show real reference odds automatically (the fallback logic already exists, don't touch it).

**Task A2: Deduplicate seeded outright markets (Priority: HIGH)**

Confirmed bug: `GET /api/markets?limit=200` returns 96 outright ("will TEAM win it all") markets for only 48 teams — every team has two near-identical rows. Frontend now defensively dedupes client-side (`page.tsx`, keeps whichever duplicate has more volume) so it's not user-visible, but the root cause is in the DB and should be fixed properly:

- Check whether `seed-wc.ts` (or `packages/api/scripts/seed-wc-group-markets.ts`) was run twice against the same DB, or whether both scripts independently create outright markets for the same teams.
- Write a one-off cleanup script: find outright markets grouped by `teamA` where `category = WORLD_CUP` and `teamB IS NULL`, keep the one with the earliest `onchainId` (or highest volume if any exist), and either delete or mark `CANCELLED` the rest — check `Trade`/`Position` foreign keys first, don't blind-delete if a duplicate has real trades against it.
- Also confirmed separately: 29 of the (deduped) outright markets are for teams already mathematically eliminated (didn't advance from groups, or lost a knockout match) — frontend now filters these out live using `/api/matches/standings` (`advanced` field) + `/api/matches/recent` results (see `packages/web/src/lib/team-status.ts`). Once Task B below reseeds proper markets, this eliminated-team filter should keep working automatically — don't remove it.

**Task B: Reseed knockout-round markets (Priority: MEDIUM)**

All 48 seeded group-stage matchups are now past `resolutionTimestamp` (correctly filtered from the homepage grid as of this pass) — the tournament has moved to Round of 32. There are currently zero tradeable **matchup** markets; only outrights. `/fixtures` shows the real bracket via ESPN, but nothing there is backed by a tradeable Pundit market.

- Extend `packages/contracts/scripts/seed-wc.ts` with `MarketDef` entries for the actual live knockout fixtures (pull team names + kickoff times from `/api/matches/upcoming`, same source the `/fixtures` page uses — don't hand-type stale matchups again).
- Use 2-way outcomes for knockout matches (no draw — extra time/penalties resolve it), consistent with `Outcome` enum semantics in `shared/types.ts`.

**Task C: Team name reconciliation (Priority: LOW, do alongside A/B)**

`packages/web/src/lib/team-status.ts` has a small hand-written alias map (`TEAM_ALIASES`) because our seeded team names don't always match ESPN's naming (`"USA"` vs `"United States"`, `"the Democratic Republic of Congo"` vs `"Congo DR"`, `"Bosnia and Herzegovina"` vs `"Bosnia-Herzegovina"` — diacritics like Curaçao/Türkiye are handled generically via Unicode normalization, only these three needed manual aliases). If new teams get seeded with names that don't match ESPN's, the elimination filter will silently fail open (team never gets marked eliminated) rather than erroring — check this list against ESPN's naming whenever markets are reseeded.

---

### Track 2 — Season prep (Premier League 2026/27, do after Track 1)

The 2026/27 Premier League season starts mid-August. `MarketCategory` already includes `PREMIER_LEAGUE`, `LA_LIGA`, `BUNDESLIGA`, `SERIE_A`, `LIGUE_1`, `CHAMPIONS_LEAGUE`, `EUROPA_LEAGUE` in `shared/src/types.ts`, and the Prisma schema needs **no migration** — `teamA`/`teamB`/`outcomeA/B/C` are already generic strings, not WC-specific.

- **Homepage category tabs**: `CATEGORIES` in `page.tsx` is hardcoded to `["ALL", "WORLD_CUP"]`. Extend once domestic-league markets exist.
- **Reference odds**: `packages/api/src/services/polymarket-data.ts` has an `isWCRelated()` keyword filter that excludes everything non-WC. Extend it (or split into a separate fetch) to also pull Premier League markets from Polymarket's Gamma API.
- **Live fixtures**: the new ESPN-based pattern in `football-data.ts` generalizes easily — ESPN's public API supports `soccer/eng.1` (Premier League) the same way it supports `soccer/fifa.world`. Either parameterize the existing service by competition slug, or add a sibling service following the same shape (fetch → parse → cache → cron).
- **Seed real markets**: once fixtures are flowing, seed PL outright/matchday markets the same way `seed-wc.ts` does for the WC.

---

### Track 3 — Admin tooling (do after or alongside Track 2)

Market creation/resolution is currently CLI/API-only (`seed-wc.ts`, `resolve-market.ts`, raw `POST /api/markets` with `x-admin-key`). That's fine for one-off WC seeding but doesn't scale to seeding a new market or league every week during the football season.

- Build a minimal internal admin page (e.g. `packages/web/src/app/admin/page.tsx`), gated by requiring the admin key as a client-side prompt/header (never expose `ADMIN_API_KEY` via `NEXT_PUBLIC_*` — see CLAUDE.md).
- Forms for: create market (question, outcomes, category, teams, resolution date), resolve market (pick outcome), and — once Task A's sync script exists — trigger a Polymarket ID sync from the UI instead of the CLI.
- Keep it ugly/functional — this is an internal tool, not a redesign target.

---

### Track 4 — Mainnet launch readiness (do last — only once the above is stable)

- **CORS**: `packages/api/src/index.ts` currently calls `cors()` with no origin restriction. Fine for testnet, must be locked to the production Vercel domain before mainnet.
- **CI/CD**: no `.github/workflows` exist. At minimum, add a workflow running `npx hardhat test` (contracts) and `npx tsc --noEmit` (api, web) on every PR.
- **Security review**: 58/58 contract tests passing is not the same as an audit. Run `/security-review` or get an external audit before real USDC touches `CollateralVault`.
- **Real USDC migration**: swap `MockUSDC` for the real USDC contract address on Base mainnet (`USDC_ADDRESS` env var already has a slot for this — see CLAUDE.md env var table).
- **Oracle key custody**: `OracleResolver` resolution is currently a single EOA (`ADMIN_API_KEY` gates the off-chain API, but on-chain resolution is whatever key `resolve-market.ts` uses). Consider a multisig or timelock before real money is on the line.
- **Rate limiting**: current `express-rate-limit` config (100 req/min global) may be too permissive/restrictive for real traffic — revisit with production numbers.

---

## Key file map (quick reference)

```
packages/contracts/
  src/
    MarketFactory.sol       — market CRUD, status machine
    ParimutuelEngine.sol    — buyShares, claimWinnings, MAX_OUTCOME=2
    CollateralVault.sol     — USDC custody, authorized-only movements
    OracleResolver.sol      — admin resolve, enforces resolutionTimestamp
    MockUSDC.sol            — permissionless mint() for testnet faucet
  scripts/
    deploy.ts               — deploys all 5, wires them, writes deployed-addresses.json
    seed-wc.ts              — 96 WC 2026 markets (48 outrights + 48 group matchups) — see Task B
    resolve-market.ts        — MARKET_ID=N OUTCOME=0|1|2 to resolve a market

packages/api/
  prisma/schema.prisma      — Market(polymarketId), Trade(grossAmount, netShares), Position(shares) — supports any category, no migration needed for new leagues
  src/
    index.ts                — Express server; starts polymarketCron, modelCron, footballCron on boot
    indexer.ts              — viem polling, idempotent upserts
    middleware.ts           — requireAdmin (x-admin-key), errorHandler, AppError
    routes/
      markets.ts            — GET/POST /api/markets (polymarketOdds enrichment on list too), GET /:id, POST /:id/resolve
      matches.ts             — GET /api/matches/{upcoming,recent,standings} — ESPN-backed, includes `stage`
      users.ts              — GET /api/users/:addr/portfolio, /history
      leaderboard.ts        — GET /api/leaderboard
      polymarkets.ts        — GET /api/polymarkets/{wc,groups}
      model.ts               — GET /api/model/{wc,fixtures} — worldcup-model reference data, do not touch
    services/
      polymarket-data.ts    — Gamma API fetch, 6h cron. `isWCRelated()` keyword filter — extend for Track 2
      football-data.ts       — ESPN scoreboard/standings fetch, 6h cron, `stage` field — extend for Track 2
      model-data.ts          — worldcup-model fetch, do not touch

packages/web/
  src/
    app/
      page.tsx              — homepage: next-match hero, Polymarket ticker, Recent Results, MarketCard grid + OutrightsBoard
      fixtures/page.tsx      — live bracket + standings (new)
      market/[id]/page.tsx  — trading terminal: chart, orders, trade panel, pool breakdown
      portfolio/page.tsx    — positions, P&L, claim, trade history
      leaderboard/page.tsx  — ranked traders, medal emoji top 3
      model/page.tsx         — DO NOT TOUCH — external iframe embed
      arena/page.tsx         — coming soon, left alone intentionally
    components/
      polymarket-ticker.tsx — compact scrolling reference-odds strip (replaces deleted polymarket-card.tsx)
      outrights-board.tsx    — dense futures-board list for binary outright markets (new)
      pool-breakdown.tsx     — real pool composition + payout multiplier (replaces deleted orderbook.tsx)
      market-card.tsx        — team-color accent bar, bold pill odds
      trade-panel.tsx       — buy shares, testnet USDC faucet, approve flow
      outcome-detail.tsx    — Pool / Trades tabs, no fake data
      markets-sidebar.tsx   — market list in trading terminal left rail
      price-chart.tsx       — recharts price history
    hooks/
      use-contracts.ts      — useBuyShares, useClaimWinnings, useMintTestUSDC, useUSDCBalance, useMarketData, useUserPosition
    lib/
      api.ts                — typed fetch wrappers + response interfaces, incl. MatchResponse.stage, StandingResponse
      mock-data.ts          — mock fallbacks for all fetch* wrappers (used when NEXT_PUBLIC_USE_MOCK=true)
      stage-label.ts         — formatStage(), STAGE_ORDER (new)
      team-logos.ts          — getTeamFlag/getTeamColor — thin coverage (~16 teams), extend as needed for new leagues

packages/shared/
  src/
    abis.ts                 — ALL ABIs live here. Never define elsewhere (exception: MOCK_USDC_MINT_ABI in use-contracts.ts).
    types.ts                — MarketStatus, MarketCategory (WORLD_CUP + 7 domestic/continental leagues, ready for Track 2), Outcome
    constants.ts            — USDC_DECIMALS=6, PLATFORM_FEE_BPS=200n, SETTLEMENT_DELAY=1800
    utils.ts                — formatUsdc, parseUsdc, calculatePayout (bigint-safe)
```

---

## Colour system (quick ref)

| Colour | Meaning |
|---|---|
| `cyan-400 / cyan-500` | Our markets, Yes/Home outcome, primary actions |
| `pink-400 / pink-500` | No/Away outcome |
| `amber-400 / amber-500` | Draw outcome, claimable winnings |
| `purple-400 / purple-500` | Polymarket reference elements (ticker, badges) |
| `emerald-400` | Qualifying/advancing positions on standings tables |
| `red-400` | LIVE match indicator (pulsing dot) |

Visual direction as of this pass: bolder/sportier (DraftKings/Sleeper-inspired) — `font-black` for numbers/odds, `rounded-full` pills over sharp-cornered badges, team-color accents via `getTeamColor()` where a team is known. Keep new UI consistent with this rather than the old thin/muted style.
