/** USDC uses 6 decimals, not 18 */
export const USDC_DECIMALS = 6;

/** 1 USDC in raw units (10^6) */
export const ONE_USDC = 1_000_000n;

/** Platform fee in basis points (2% = 200 bps) */
export const PLATFORM_FEE_BPS = 200n;

/** Basis points denominator */
export const BPS_DENOMINATOR = 10_000n;

/** Settlement delay in seconds (30 minutes) */
export const SETTLEMENT_DELAY = 1800;

/** Base Sepolia chain configuration */
export const CHAIN_CONFIG = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  blockExplorer: "https://sepolia.basescan.org",
} as const;

/** Contract addresses — filled after deployment */
export const CONTRACT_ADDRESSES: Record<string, `0x${string}`> = {};
