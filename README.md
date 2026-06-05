# Pundit — FIFA World Cup 2026 Prediction Market

Onchain parimutuel prediction market for the 2026 FIFA World Cup. Users buy USDC-denominated shares on match and tournament outcomes. Winners split the net pool proportional to shares held. Live Polymarket consensus odds are shown as reference.

**Chain:** Base Sepolia (testnet) → Base mainnet  
**Token:** MockUSDC (6 decimals, permissionless testnet faucet)

---

## Architecture

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Next.js 14     │───▶│   Express API    │───▶│   PostgreSQL     │
│   (Frontend)     │    │   + Prisma ORM   │    │   (Railway)      │
└────────┬─────────┘    └────────┬─────────┘    └──────────────────┘
         │                       │
         │  wagmi v2 / viem      │  viem (indexer polling)
         ▼                       ▼
┌────────────────────────────────────────────────────────────────────┐
│                     Base Sepolia (EVM)                             │
│  MockUSDC · MarketFactory · CollateralVault · ParimutuelEngine    │
│                          OracleResolver                            │
└────────────────────────────────────────────────────────────────────┘
         ▲
         │  Reference odds only (public API, no auth)
┌────────┴────────┐
│  Polymarket     │
│  Gamma API      │
└─────────────────┘
```

### Smart Contracts

| Contract | Purpose |
|---|---|
| **MockUSDC** | ERC-20 test stablecoin (6 decimals, permissionless `mint`) |
| **MarketFactory** | Creates and tracks prediction markets |
| **CollateralVault** | Holds USDC deposits, distributes payouts |
| **OracleResolver** | Admin-only outcome resolution + 30-min settlement delay |
| **ParimutuelEngine** | Core trading — `buyShares`, `claimWinnings` |

### How Parimutuel Trading Works

1. Users deposit USDC to buy Home / Away / Draw shares
2. All deposits pool together per market (no counter-party needed)
3. On resolution, a **2% protocol fee** is taken (rounded up)
4. Winners split the remaining pool **proportional to their shares**
5. A **30-minute settlement delay** protects against oracle manipulation

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (Node ≥18, pnpm 9.15.4) |
| Contracts | Solidity 0.8.24+, Hardhat, OpenZeppelin v5 |
| Frontend | Next.js 14 App Router, TypeScript, TailwindCSS, shadcn/ui |
| Web3 | wagmi v2, viem, RainbowKit |
| Backend | Express + TypeScript, Prisma 6, PostgreSQL |
| Chain | Base Sepolia → Base mainnet |

---

## Project Structure

```
packages/
  contracts/   — Solidity contracts, Hardhat tests (58/58 passing), deploy + seed scripts
  web/         — Next.js 14 frontend (dark theme, mobile-first)
  api/         — Express REST API + viem blockchain event indexer
  shared/      — TypeScript types, ABIs, constants (single source of truth)
```

---

## Quick Start (Local Dev with Mock Data)

```bash
# Install dependencies
pnpm install

# Start frontend only (mock data — no API or contracts needed)
cd packages/web
cp .env.local.example .env.local   # or create with: NEXT_PUBLIC_USE_MOCK=true
pnpm dev
# → http://localhost:3000
```

Mock mode (`NEXT_PUBLIC_USE_MOCK=true`) uses hardcoded WC 2026 data — no wallet, no API, no DB required.

---

## Full Testnet Setup

### Prerequisites

- Node.js ≥ 18, pnpm 9.15.4
- Base Sepolia wallet funded with ~0.05 ETH
- [Railway](https://railway.app) account (free tier works) for managed Postgres
- [WalletConnect Cloud](https://cloud.walletconnect.com) project ID (free)
- [Basescan](https://basescan.org) API key (free, for contract verification)

### 1. Configure environment

```bash
cp .env.example .env
# Fill in:
#   DEPLOYER_PRIVATE_KEY=  (funded Base Sepolia wallet)
#   ADMIN_API_KEY=         (openssl rand -hex 32)
#   DATABASE_URL=          (from Railway Postgres plugin)
#   ETHERSCAN_API_KEY=     (from basescan.org)

cp packages/web/.env.local.example packages/web/.env.local
# Fill in:
#   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
#   NEXT_PUBLIC_API_URL=http://localhost:3001
#   NEXT_PUBLIC_USE_MOCK=false   (set after contracts + markets are ready)
```

### 2. Run contract tests

```bash
cd packages/contracts && npx hardhat test
# All 58 tests must pass before deploying
```

### 3. Deploy contracts

```bash
npx hardhat run scripts/deploy.ts --network base_sepolia
# Prints all contract addresses — copy into .env and .env.local
```

### 4. Set up database

```bash
cd packages/api && npx prisma migrate deploy
```

### 5. Start API + indexer

```bash
# Terminal 1 — API server
cd packages/api && npm run dev

# Terminal 2 — Blockchain indexer (polls for events)
cd packages/api && npx ts-node src/indexer.ts
```

### 6. Seed WC 2026 markets

```bash
cd packages/contracts
API_URL=http://localhost:3001 \
ADMIN_API_KEY=<your-key> \
npx hardhat run scripts/seed-wc.ts --network base_sepolia
# Creates 16 markets: 8 tournament outrights + 8 group stage matches
```

### 7. Start frontend

```bash
cd packages/web && pnpm dev
# → http://localhost:3000
```

### 8. Resolve a market (post-match)

```bash
cd packages/contracts
MARKET_ID=3 OUTCOME=0 npx hardhat run scripts/resolve-market.ts --network base_sepolia
# OUTCOME: 0=Home/Yes  1=Away/No  2=Draw
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/markets` | List markets (filters: `status`, `category`, `sort`) |
| GET | `/api/markets/:id` | Market detail + Polymarket reference odds |
| POST | `/api/markets` | Create market (admin) |
| POST | `/api/markets/:id/resolve` | Resolve market (admin) |
| GET | `/api/users/:addr/portfolio` | Positions, P&L, claimable winnings |
| GET | `/api/users/:addr/history` | Paginated trade history |
| GET | `/api/leaderboard` | Top traders by profit |
| GET | `/api/polymarkets/wc` | Live WC markets from Polymarket (reference only) |
| GET | `/health` | API + DB health check |

---

## Frontend Features

- **WC 2026 countdown banner** — live countdown to the Jun 11 tournament opener
- **Polymarket live preview** — purple cards showing live Polymarket WC consensus odds (reference only, always live regardless of mock mode)
- **Market grid** — our parimutuel pools with multiplier badges ("Up to 3.2x"), parimutuel pricing, search + category filter
- **Market detail** — trading terminal: price chart, order panel, trade panel, Polymarket consensus bar
- **Testnet USDC faucet** — "Get 100 USDC" button when balance is zero on Base Sepolia
- **Portfolio** — positions, P&L, claimable winnings with one-click claim
- **Leaderboard** — top traders ranked by profit (7d / 30d / all-time)
- **Arena** — coming soon (CLOB order book)

---

## Vercel + Railway Production Deploy

```bash
# API → Railway
cd packages/api && railway up

# Frontend → Vercel
cd packages/web && vercel --prod
```

**Required Vercel env vars:**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `84532` |
| `NEXT_PUBLIC_API_URL` | Your Railway API URL |
| `NEXT_PUBLIC_ENGINE_ADDRESS` | From deploy output |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | From deploy output |
| `NEXT_PUBLIC_VAULT_ADDRESS` | From deploy output |
| `NEXT_PUBLIC_USDC_ADDRESS` | From deploy output |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From WalletConnect Cloud |
| `NEXT_PUBLIC_USE_MOCK` | `false` |

---

## License

MIT
