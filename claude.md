# Sports Prediction Market

Onchain prediction market for FIFA World Cup 2026. Users trade binary outcome shares (YES/NO) on match and tournament outcomes using USDC on Base (Ethereum L2).

## Tech stack
- Monorepo: pnpm workspaces
- Smart contracts: Solidity 0.8.24+, Foundry
- Frontend: Next.js 14 (App Router), TypeScript, TailwindCSS, shadcn/ui
- Web3: wagmi v2, viem, RainbowKit
- Backend: Express + TypeScript, Prisma ORM, PostgreSQL
- Chain: Base Sepolia (testnet), Base (mainnet)

## Architecture
Parimutuel (pool-based) trading. Users deposit USDC into outcome pools. On resolution, winners split the total pool proportional to their share, minus a 2% platform fee. Centralized oracle resolution (admin-only) with 30-min settlement delay before claims open.

## Project structure
packages/contracts — Solidity + Foundry
packages/web — Next.js frontend
packages/api — Express backend
packages/shared — Types, constants, ABIs

## Critical constraints
- USDC = 6 decimals, not 18. Every calculation must account for this.
- Fee rounding: always in favor of protocol (round up fee, round down payout).
- Multiply before divide in all financial math to minimize precision loss.
- Never store private keys in code.
- Dark theme throughout (navy/charcoal base, electric blue accents, white text).
- Mobile-first responsive design.
