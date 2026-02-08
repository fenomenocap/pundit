# Sports Predict — Onchain Prediction Markets

Parimutuel prediction market for FIFA World Cup 2026. Users trade binary outcome shares (YES / NO) on match and tournament outcomes using USDC on Base (Ethereum L2).

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Next.js 14  │────▶│  Express API │────▶│   PostgreSQL     │
│  (Frontend)  │     │  + Prisma    │     │   (Market data)  │
└──────┬───────┘     └──────┬───────┘     └──────────────────┘
       │                    │
       │   wagmi v2 / viem  │  viem (indexer)
       ▼                    ▼
┌──────────────────────────────────────────┐
│           Base Sepolia (EVM)             │
│  ┌────────────┐  ┌──────────────────┐    │
│  │ MockUSDC   │  │ MarketFactory    │    │
│  └────────────┘  └──────────────────┘    │
│  ┌────────────┐  ┌──────────────────┐    │
│  │ Collateral │  │ ParimutuelEngine │    │
│  │ Vault      │  └──────────────────┘    │
│  └────────────┘  ┌──────────────────┐    │
│                  │ OracleResolver   │    │
│                  └──────────────────┘    │
└──────────────────────────────────────────┘
```

### Smart Contracts

| Contract | Purpose |
|---|---|
| **MockUSDC** | ERC-20 test stablecoin (6 decimals) |
| **MarketFactory** | Creates and tracks prediction markets |
| **CollateralVault** | Holds USDC deposits, distributes payouts and fees |
| **OracleResolver** | Admin-only outcome resolution with 30-min settlement delay |
| **ParimutuelEngine** | Core trading logic — buy shares, compute payouts |

### How Parimutuel Trading Works

1. Users deposit USDC to buy YES or NO shares (1 USDC = 1 share)
2. All deposits go into a single pool per market
3. When the market resolves, a **2% protocol fee** is taken (rounded up)
4. Winners split the remaining pool proportional to their shares (rounded down)
5. A 30-minute settlement delay protects against oracle manipulation

## Tech Stack

- **Monorepo**: pnpm workspaces
- **Smart Contracts**: Solidity 0.8.33, Hardhat, OpenZeppelin v5
- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Web3**: wagmi v2, viem, RainbowKit
- **Backend**: Express, TypeScript, Prisma ORM, PostgreSQL
- **Chain**: Base Sepolia (testnet)

## Project Structure

```
packages/
  contracts/   — Solidity contracts, Hardhat tests, deploy scripts
  web/         — Next.js frontend (dark theme, mobile-first)
  api/         — Express REST API + blockchain event indexer
  shared/      — TypeScript types, constants, ABIs
```

## Setup

### Prerequisites

- Node.js >= 18
- pnpm >= 8
- PostgreSQL 14+

### Install

```bash
pnpm install
```

### Environment

```bash
cp .env.example .env
# Edit .env with your values:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/sports_predict
#   PRIVATE_KEY=0x...           (deployer wallet)
#   BASE_SEPOLIA_RPC=https://...
#   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

### Database

```bash
cd packages/api
pnpm prisma migrate dev
```

### Local Development

```bash
# Terminal 1 — local blockchain
cd packages/contracts && npx hardhat node

# Terminal 2 — deploy contracts
cd packages/contracts && pnpm deploy:local

# Terminal 3 — API server + indexer
pnpm dev:indexer &
cd packages/api && pnpm dev

# Terminal 4 — frontend
cd packages/web && pnpm dev
```

## Scripts

### Root

| Command | Description |
|---|---|
| `pnpm dev` | Start all packages in parallel |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm clean` | Clean build artifacts |

### Contracts

| Command | Description |
|---|---|
| `pnpm test` | Run Hardhat test suite (unit + E2E) |
| `pnpm deploy:local` | Deploy to local Hardhat node |
| `pnpm deploy:sepolia` | Deploy to Base Sepolia |

### API

| Command | Description |
|---|---|
| `pnpm dev` | Start Express server with hot reload |
| `pnpm dev:indexer` | Start blockchain event indexer |
| `pnpm build` | Compile TypeScript |

### Web

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` | Production build |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/markets` | List all markets (with filters) |
| GET | `/api/markets/:id` | Market detail with pool sizes |
| GET | `/api/markets/:id/history` | Price history for charts |
| GET | `/api/positions/:address` | User's open positions |
| GET | `/api/leaderboard` | Top traders by profit |

## Frontend Features

- **Market Grid** — Browse markets with search, status filters, and loading skeletons
- **Market Detail** — Live odds chart (lazy-loaded), trade panel, outcome breakdown
- **Portfolio** — Position dashboard with P&L tracking and claim buttons
- **Leaderboard** — Top traders ranked by profit
- **Network Guard** — Auto-prompt to switch to Base Sepolia
- **Error Handling** — Human-readable contract revert messages with retry buttons
- **Performance** — React.memo cards, debounced search, Suspense boundaries
- **SEO** — Dynamic titles, OpenGraph tags, Twitter cards

## Deploying to Base Sepolia

### 1. Deploy Contracts

```bash
# Set deployer private key (needs Base Sepolia ETH for gas)
export DEPLOYER_PRIVATE_KEY=0x...
export RPC_URL=https://sepolia.base.org

cd packages/contracts
pnpm deploy:sepolia
```

The deploy script prints all contract addresses and env vars to copy.

### 2. Verify Contracts on Basescan (optional)

```bash
export ETHERSCAN_API_KEY=...
npx hardhat verify --network base_sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### 3. Deploy Frontend to Vercel

```bash
cd packages/web

# Install Vercel CLI
npm i -g vercel

# Deploy (first time — links to project)
vercel

# Set environment variables in Vercel dashboard or CLI:
vercel env add NEXT_PUBLIC_ENGINE_ADDRESS
vercel env add NEXT_PUBLIC_FACTORY_ADDRESS
vercel env add NEXT_PUBLIC_VAULT_ADDRESS
vercel env add NEXT_PUBLIC_USDC_ADDRESS
vercel env add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
vercel env add NEXT_PUBLIC_API_URL

# Production deploy
vercel --prod
```

### Required Vercel Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_ENGINE_ADDRESS` | ParimutuelEngine contract address |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | MarketFactory contract address |
| `NEXT_PUBLIC_VAULT_ADDRESS` | CollateralVault contract address |
| `NEXT_PUBLIC_USDC_ADDRESS` | MockUSDC contract address |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID |
| `NEXT_PUBLIC_API_URL` | Backend API URL (e.g. `https://api.yourdomain.com`) |

## Testing

```bash
# Run all contract tests (54 unit + 4 E2E)
cd packages/contracts && pnpm test

# E2E tests cover:
#   - Full lifecycle: deploy → trade → resolve → settle → claim → verify balances
#   - Market cancellation with full refunds
#   - Settlement delay enforcement
#   - Multi-market independent settlement
```

## License

MIT
