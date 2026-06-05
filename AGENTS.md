# AGENTS.md — Pundit Prediction Market
# Agent Handoff: Status, Tasks, Blockers

Read CLAUDE.md first for architecture, constraints, and patterns. This file covers **current state** and **what to build next**.

---

## Current State (as of June 2026)

### ✅ Complete — do not re-implement

| Area | What exists | Notes |
|---|---|---|
| Smart contracts | `MarketFactory`, `ParimutuelEngine`, `CollateralVault`, `OracleResolver`, `MockUSDC` | 58/58 tests passing |
| Contract deploy | `packages/contracts/scripts/deploy.ts` | Deploys all 5 contracts, wires them, prints env vars |
| Market seeding | `packages/contracts/scripts/seed-wc.ts` | 16 WC 2026 markets (8 outrights + 8 group stage), two-step: on-chain + admin API |
| Market resolution | `packages/contracts/scripts/resolve-market.ts` | `MARKET_ID=3 OUTCOME=0 npx hardhat run ...` |
| API — markets | `packages/api/src/routes/markets.ts` | CRUD, admin create/resolve, Polymarket odds enrichment on detail |
| API — users | `packages/api/src/routes/users.ts` | Portfolio (positions + P&L), trade history. Returns `onchainId` on positions. |
| API — leaderboard | `packages/api/src/routes/leaderboard.ts` | P&L ranking, 60s cache |
| API — polymarkets | `packages/api/src/routes/polymarkets.ts` | `GET /api/polymarkets/wc` returns cached live WC markets |
| Polymarket service | `packages/api/src/services/polymarket-data.ts` | Fetches Gamma API on startup + every 6h, in-memory cache |
| Indexer | `packages/api/src/indexer.ts` | viem getLogs polling, handles MarketCreated/SharesPurchased/MarketResolved |
| Prisma schema | `packages/api/prisma/schema.prisma` | Market has `polymarketId String?` — migration written, run `prisma migrate deploy` on first boot |
| Frontend — homepage | `packages/web/src/app/page.tsx` | WC countdown banner (Jun 11 opener), default WC tab, trending movers, WC news, **Polymarket live preview section** |
| Frontend — Polymarket card | `packages/web/src/components/polymarket-card.tsx` | Purple-accented card for Polymarket reference markets. LIVE badge, "coming soon" modal, links to our market if `onchainMarketId` set. |
| Frontend — market detail | `packages/web/src/app/market/[id]/page.tsx` | Trading terminal layout: chart, order panel, trade panel, outcome detail. Polymarket ref badge (purple). |
| Frontend — portfolio | `packages/web/src/app/portfolio/page.tsx` | Positions table, P&L, claimable winnings, trade history. Claim uses `pos.onchainId`. |
| Frontend — leaderboard | `packages/web/src/app/leaderboard/page.tsx` | Routes through `fetchLeaderboard` in mock-data (mock/real via USE_MOCK flag) |
| Frontend — arena | `packages/web/src/app/arena/page.tsx` | "Coming soon" page |
| Trade panel | `packages/web/src/components/trade-panel.tsx` | Buy shares, USDC faucet (testnet only, shown at zero balance), approve+buy flow |
| Hooks | `packages/web/src/hooks/use-contracts.ts` | `useBuyShares`, `useClaimWinnings`, `useMarketData`, `useUserPosition`, `useUSDCBalance`, `useMintTestUSDC` |
| Mock data | `packages/web/src/lib/mock-data.ts` | 10 WC markets, mock Polymarket odds, mock leaderboard (10 traders), all mock fns accept address |
| TypeScript | All packages | 0 errors. Run `npx tsc --noEmit` in `packages/web` and `packages/api` to verify. |

---

## 🔴 Blocked on user — no code needed

These require credentials/infrastructure the user must configure manually:

| Blocker | Action needed | Where |
|---|---|---|
| Railway Postgres | Provision Postgres plugin → copy `DATABASE_URL` | railway.app |
| Deployer wallet | Fund with ~0.05 ETH on Base Sepolia | Any faucet |
| `DEPLOYER_PRIVATE_KEY` | Funded wallet private key | `.env` |
| `ETHERSCAN_API_KEY` | basescan.org → API Keys | `.env` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | cloud.walletconnect.com | `.env` |
| `ADMIN_API_KEY` | `openssl rand -hex 32` | `.env` |
| `DATABASE_URL` | From Railway | `.env` |

**Deploy sequence (after .env is filled):**
```bash
# 1. Run contract tests
cd packages/contracts && npx hardhat test

# 2. Deploy contracts to Base Sepolia
npx hardhat run scripts/deploy.ts --network base_sepolia
# → copy all printed addresses into .env and packages/web/.env.local

# 3. Migrate DB
cd packages/api && npx prisma migrate deploy

# 4. Start API + indexer
npm run dev                        # terminal 1
npx ts-node src/indexer.ts         # terminal 2

# 5. Seed WC markets (16 markets)
cd packages/contracts
API_URL=http://localhost:3001 ADMIN_API_KEY=<key> npx hardhat run scripts/seed-wc.ts --network base_sepolia

# 6. Flip mock mode off
# In packages/web/.env.local:
NEXT_PUBLIC_USE_MOCK=false
```

---

## 🟡 Outstanding tasks — ready to implement

### TASK 2: Admin Polymarket Sync (Priority: MEDIUM, post-deploy)

**Goal:** After seeding, link each of our on-chain markets to the corresponding Polymarket market by setting `polymarketId` in the DB. This enables the Polymarket reference badge on market detail pages and lets `PolymarketCard` navigate to our market when clicked.

**Why:** The `polymarketId` field exists on the Market model but is only set if explicitly passed during seeding. `seed-wc.ts` includes Polymarket IDs for markets it knows about, but a manual sync step is safer.

**Scope:**
1. `packages/api/src/routes/markets.ts` — add `PATCH /api/markets/:id` admin endpoint that accepts `{ polymarketId: string }` and updates the record. Protected by `requireAdmin`.
2. `packages/api/src/scripts/sync-polymarket-ids.ts` — one-shot script: fetches `/api/polymarkets/wc`, fuzzy-matches question strings against our markets in DB, calls PATCH for high-confidence matches (>85% similarity). Prints a diff for human review before writing.

**Key constraints:**
- Question matching is fuzzy — "Will Brazil win the 2026 FIFA World Cup?" vs "Brazil to win 2026 World Cup?" must match
- Never auto-link with <85% confidence — always require human confirmation for ambiguous matches
- Warn before overwriting existing `polymarketId` values (destructive)
- Once linked, `PolymarketCard` on homepage will automatically navigate to our market detail instead of showing the modal

---

### ~~TASK 3: Markets Sidebar Bug Fix~~ — ✅ Already correct

`packages/web/src/components/markets-sidebar.tsx` `getYesPrice()` already uses
`poolYes + poolNo + poolDraw` as denominator. No fix needed.

### ~~TASK 4: Leaderboard Payout Bug~~ — ✅ Already correct

`packages/api/src/routes/leaderboard.ts` line 105 already uses
`market.poolYes + market.poolNo + market.poolDraw` and does a full 3-branch outcome
lookup. No fix needed.

---

### TASK 5: Vercel + Railway Production Deploy (Priority: HIGH, post-.env)

**Goal:** Deploy the full stack publicly.

**Scope:**
1. `packages/api` → Railway service (alongside the Postgres plugin). Set all non-`NEXT_PUBLIC_` env vars in Railway dashboard.
2. `packages/web` → Vercel. Set all `NEXT_PUBLIC_*` env vars + `NEXT_PUBLIC_USE_MOCK=false` + `NEXT_PUBLIC_API_URL=<railway-url>`.
3. Update `CORS` in `packages/api/src/index.ts` to allow the Vercel domain (currently `cors()` allows all — fine for testnet but tighten before mainnet).
4. Start the indexer as a Railway background worker pointing at Base Sepolia RPC.

**Commands:**
```bash
# API on Railway — set env vars in dashboard, then:
railway up  (from packages/api)

# Web on Vercel:
cd packages/web && vercel --prod
```

---

## 🟢 Post-testnet (deferred)

| Feature | Notes |
|---|---|
| Live scores integration | API-Sports or Opta. Not needed for WC outrights/group stage |
| AMM v2 / sell positions | Parimutuel has no sell mechanism. Would require new contract. |
| CLOB order book | Separate product. Arena tab is the placeholder. |
| Admin sync dashboard (UI) | Task 2 covers the script version; full UI is post-testnet |
| Premier League / Champions League markets | WC only for testnet. Categories exist in schema but no markets seeded. |
| Polymarket → Pundit onchainMarketId auto-link | Once TASK 2 sync is done, `PolymarketCard` navigates directly to our market |

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
    seed-wc.ts              — creates 16 WC markets on-chain + registers in DB
    resolve-market.ts       — MARKET_ID=N OUTCOME=0|1|2 to resolve a market

packages/api/
  prisma/schema.prisma      — Market(polymarketId), Trade(grossAmount, netShares), Position(shares)
  src/
    index.ts                — Express server, starts polymarketCron on boot
    indexer.ts              — viem polling, idempotent upserts
    middleware.ts           — requireAdmin (x-admin-key), errorHandler, AppError
    routes/
      markets.ts            — GET/POST /api/markets, GET /api/markets/:id, POST /:id/resolve
      users.ts              — GET /api/users/:addr/portfolio (returns onchainId), /history
      leaderboard.ts        — GET /api/leaderboard (⚠ verify poolDraw included — Task 4)
      polymarkets.ts        — GET /api/polymarkets/wc
    services/
      polymarket-data.ts    — Gamma API fetch, 6h cron, getCachedPolymarketMarkets()

packages/web/
  src/
    app/
      page.tsx              — homepage: WC countdown, WC default tab, Polymarket live section, market grid, news
      market/[id]/page.tsx  — trading terminal: chart, orders, trade panel, Polymarket ref badge (purple)
      portfolio/page.tsx    — positions, P&L, claim (uses pos.onchainId), trade history
      leaderboard/page.tsx  — uses fetchLeaderboard() from mock-data.ts (honours USE_MOCK)
      arena/page.tsx        — coming soon
    components/
      polymarket-card.tsx   — purple card for Polymarket reference markets. LIVE badge, coming-soon modal.
      trade-panel.tsx       — buy shares, testnet USDC faucet, approve flow
      market-card.tsx       — card with multiplier badge (Up to Xx)
      markets-sidebar.tsx   — ⚠ uses stale CPMM pricing — see Task 3
      outcome-detail.tsx    — right panel in trading terminal
      orders-panel.tsx      — recent trades panel
      price-chart.tsx       — recharts price history
    hooks/
      use-contracts.ts      — useBuyShares, useClaimWinnings, useMintTestUSDC, useUSDCBalance, useMarketData, useUserPosition
    lib/
      api.ts                — typed fetch wrappers + all response interfaces (incl. PositionResponse.onchainId, PolymarketMarket, getPolymarketMarkets)
      mock-data.ts          — 10 WC mock markets, MOCK_POLYMARKET_ODDS, MOCK_POLYMARKET_MARKETS, fetchLeaderboard, fetchPolymarketMarkets
      contracts.ts          — re-exports ABIs from shared, CONTRACTS addresses from env

packages/shared/
  src/
    abis.ts                 — ALL ABIs live here. Never define elsewhere (exception: MOCK_USDC_MINT_ABI in use-contracts.ts).
    types.ts                — MarketStatus, MarketCategory, Trade uses grossAmount/netShares
    constants.ts            — USDC_DECIMALS=6, PLATFORM_FEE_BPS=200n, SETTLEMENT_DELAY=1800
    utils.ts                — formatUsdc, parseUsdc, calculatePayout (bigint-safe)
```

---

## Colour system (quick ref)

| Colour | Meaning |
|---|---|
| `cyan-400 / cyan-500` | Our markets, Yes/Home outcome, primary actions |
| `pink-400 / pink-500` | No/Away outcome |
| `amber-400 / amber-500` | Draw outcome, WC banner |
| `purple-400 / purple-500` | Polymarket reference elements (cards, badge, consensus bar) |
| `green-400` | LIVE indicator (pulsing dot) |
