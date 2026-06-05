# Pundit — FIFA World Cup 2026 Prediction Market

Onchain parimutuel prediction market. Users buy USDC-denominated outcome shares on WC 2026 matches and tournament outrights. Winners split the net pool proportional to shares held. Admin oracle resolves; 30-min settlement delay before claims open.

**Chain:** Base Sepolia (chainId 84532) → Base mainnet post-launch  
**Token:** MockUSDC (6 decimals) on testnet; real USDC on mainnet  
**Status:** Pre-testnet. All code written and TypeScript-clean. Awaiting `.env` config + deploy.

---

## Tech stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4) |
| Contracts | Solidity 0.8.24+, Hardhat, OpenZeppelin v5. 58/58 tests passing. |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui |
| Web3 | wagmi v2, viem, RainbowKit |
| Backend | Express + TypeScript, Prisma 6, PostgreSQL (Railway managed) |
| Data | Polymarket Gamma API (public, no auth) — reference odds only |

**Build order:** `shared` → `contracts` → `api` → `web`  
After any Prisma schema change: `pnpm install` + `npx prisma generate` in `packages/api`

---

## Critical financial constraints

These are non-negotiable. Getting any of these wrong silently corrupts payouts.

- **USDC = 6 decimals**, not 18. `1 USDC = 1_000_000n`. Never use `Number()` for bigint USDC math — precision loss above 2^53.
- **Fee = ceil(amount × 200 / 10000)** — rounds up, in favour of protocol. Net = amount − fee. **DB pools are net** (fee already deducted at buy time). Never re-deduct the fee anywhere.
- **Payout = shares × totalPool / winningPool** — multiply before divide. No extra fee math. Pools are already net.
- **3-way outcomes everywhere.** `outcome` ∈ {0=Yes/Home, 1=No/Away, 2=Draw}. Binary `x===0 ? A : B` silently mislabels Draw. Always 3-branch lookup.
- **totalPool always = poolYes + poolNo + poolDraw** (all three). Omitting poolDraw gives wrong payouts on 3-way markets.

---

## Critical non-obvious patterns

- **Parimutuel price:** `P(i) = pool[i] / (poolYes + poolNo + poolDraw)`. The formula `noPool / total` for YES is CPMM — wrong here. The correct helper is `getParimutuelPrices(market)` in `packages/web/src/lib/mock-data.ts`.
- **USDC approval target is the vault** (`CONTRACTS.vault`), not the engine. Engine calls `vault.depositFor`. Approving the engine directly will revert.
- **Position.shares = net shares** (gross minus 2% fee). For "amount user paid" use `Trade.grossAmount`.
- **`MarketCategory` enum:** `PREMIER_LEAGUE` not `EPL`. Mismatch silently drops markets from category filters.
- **Indexer idempotency:** position shares are re-aggregated from all trades on each event — never increment blindly.
- **`ADMIN_API_KEY`** is server-side only. Never prefix with `NEXT_PUBLIC_`.
- **ABIs:** defined only in `shared/src/abis.ts`. Never re-declare elsewhere.
- **`useMintTestUSDC`** uses a locally-defined `MOCK_USDC_MINT_ABI` inside `use-contracts.ts` (the shared ABI doesn't include `mint`). This is the only intentional ABI definition outside `shared/`.

---

## Mock mode vs real mode

`USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false"` (defaults **true** until deploy).

**Rule:** All frontend data fetching for _our own markets_ goes through `lib/mock-data.ts`, which honours the flag. Never call `fetch()` raw in page components for market data.

**Exception:** `usePolymarketData()` in `packages/web/src/app/page.tsx` calls `fetch()` directly against `NEXT_PUBLIC_API_URL/api/polymarkets/wc`. This is intentional — it _bypasses_ `USE_MOCK` to always show live Polymarket reference data (or nothing if the API is down). This is the only authorised raw fetch in a page component.

---

## Polymarket data architecture

Two completely separate data flows — never mix them:

| Flow | Endpoint | Purpose |
|---|---|---|
| **Polymarket reference** | `GET /api/polymarkets/wc` | Live WC consensus odds from Gamma API. Reference only — not tradeable. |
| **Our markets** | `GET /api/markets` | Our on-chain parimutuel pools. What the main card grid shows. |

How they connect:
- `polymarketId` on a `Market` DB record links the two
- When set, `GET /api/markets/:id` enriches the response with `polymarketOdds`
- The purple "Polymarket ref" bar on market detail only renders when `polymarketOdds !== null`
- `PolymarketCard` on the homepage shows Polymarket markets directly; clicking an unlinked card shows a "coming soon" modal; clicking a linked one navigates to our market detail

**Service:** `packages/api/src/services/polymarket-data.ts` — fetches Gamma API on boot + every 6h. In-memory cache, stale-on-error. Exports: `getCachedPolymarketMarkets()`, `startPolymarketCron()`, `stopPolymarketCron()`.

**PolymarketMarket type** is defined in `packages/web/src/components/polymarket-card.tsx` (frontend) and matches the shape returned by `GET /api/polymarkets/wc`. The API service has its own identical interface in `polymarket-data.ts`.

---

## Environment variables

```bash
# ── Chain ──────────────────────────────────────────────────────────────────
CHAIN_ID=84532
RPC_URL=https://sepolia.base.org

# ── Contracts (fill after deploy) ──────────────────────────────────────────
FACTORY_ADDRESS=
ENGINE_ADDRESS=
VAULT_ADDRESS=
RESOLVER_ADDRESS=
USDC_ADDRESS=
DEPLOYMENT_BLOCK=0          # set to deploy block to skip backfill from genesis

# ── Database (Railway Postgres) ─────────────────────────────────────────────
DATABASE_URL=postgresql://...

# ── API (server-side only) ───────────────────────────────────────────────────
API_PORT=3001
API_URL=http://localhost:3001
ADMIN_API_KEY=              # openssl rand -hex 32 — NEVER prefix with NEXT_PUBLIC_

# ── Frontend (Next.js — all NEXT_PUBLIC_*) ────────────────────────────────────
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ENGINE_ADDRESS=
NEXT_PUBLIC_FACTORY_ADDRESS=
NEXT_PUBLIC_VAULT_ADDRESS=
NEXT_PUBLIC_USDC_ADDRESS=
NEXT_PUBLIC_USE_MOCK=true   # flip to false after contracts deployed + markets seeded

# ── Deploy ────────────────────────────────────────────────────────────────────
DEPLOYER_PRIVATE_KEY=       # funded Base Sepolia wallet (~0.05 ETH)
ETHERSCAN_API_KEY=          # from basescan.org — for contract verification
```

---

## Design rules

- Dark theme: navy/charcoal base, **cyan** (`cyan-400`/`cyan-500`) for our markets, **purple** (`purple-400`/`purple-500`) for Polymarket reference elements, **pink** for No/Away outcome
- Mobile-first responsive. All layouts work at 375px.
- No sell functionality — parimutuel has no sell mechanism. Do not add one.
- Polymarket cards use purple border/accents to visually separate them from our tradeable markets

---

## DO NOT

- Define ABIs outside `shared/src/abis.ts` (except the local `MOCK_USDC_MINT_ABI` in `use-contracts.ts`)
- Reference `Trade.amount` or `Trade.shares` — fields are `grossAmount` / `netShares`
- Re-deduct fee in payout calculations — pools are already net
- Use `noPool / total` for YES price — that is CPMM, not parimutuel
- Use `poolYes + poolNo` as totalPool on 3-way markets — must include `poolDraw`
- Prefix `ADMIN_API_KEY` with `NEXT_PUBLIC_`
- Use `Number()` for bigint USDC math
- Add sell / position-closing functionality
- Skip `pnpm install` + `prisma generate` after any schema edit
- Call `fetch()` raw in page components for market data — go through `lib/mock-data.ts` (except `usePolymarketData` which is the authorised exception)
- Show Polymarket data as tradeable markets — reference only
