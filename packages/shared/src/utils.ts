import {
  USDC_DECIMALS,
  ONE_USDC,
} from "./constants";

/**
 * Convert raw USDC bigint (6 decimals) to human-readable string with $ and commas.
 * e.g. 1_500_000n → "$1.50", 1_234_567_890n → "$1,234.57"
 */
export function formatUsdc(raw: bigint): string {
  const isNegative = raw < 0n;
  const abs = isNegative ? -raw : raw;

  const whole = abs / ONE_USDC;
  const frac = abs % ONE_USDC;

  // Pad fraction to 6 digits, then take first 2 for cents
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0");
  const cents = fracStr.slice(0, 2);

  // Add commas to whole part
  const wholeWithCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const sign = isNegative ? "-" : "";
  return `${sign}$${wholeWithCommas}.${cents}`;
}

/**
 * Parse a human-readable USDC string to raw bigint (6 decimals).
 * Accepts: "1.50", "$1.50", "1,234.56", "$1,234.56", "100"
 */
export function parseUsdc(input: string): bigint {
  const cleaned = input.replace(/[$,\s]/g, "");
  const parts = cleaned.split(".");
  const whole = BigInt(parts[0] || "0");
  let frac = 0n;
  if (parts[1]) {
    const padded = parts[1].padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
    frac = BigInt(padded);
  }
  return whole * ONE_USDC + frac;
}

/**
 * Calculate implied probability (odds) for the YES outcome from pool sizes.
 * Returns a number between 0 and 1. Returns 0.5 (binary) or 1/3 (3-way) if all pools are empty.
 */
export function calculateImpliedOdds(poolYes: bigint, poolNo: bigint, poolDraw = 0n): number {
  const total = poolYes + poolNo + poolDraw;
  if (total === 0n) return poolDraw > 0n ? 1 / 3 : 0.5;
  return Number(poolYes) / Number(total);
}

/**
 * Calculate payout for a winning position.
 * DB pool columns are already NET of fees — do NOT re-deduct fee here.
 * payout = shares * totalPool / winningPool (floor division)
 * Multiply before divide to minimise precision loss.
 */
export function calculatePayout(
  shares: bigint,
  winningPool: bigint,
  totalPool: bigint  // already net of fees
): bigint {
  if (winningPool === 0n) return 0n;
  return (shares * totalPool) / winningPool;
}

/**
 * Shorten an Ethereum address: 0x1234...abcd
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Return a human-readable countdown string from now to a target unix timestamp (seconds).
 * e.g. "2d 5h 30m", "45m 12s", "Ended"
 */
export function timeUntil(targetTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  let diff = targetTimestamp - now;

  if (diff <= 0) return "Ended";

  const days = Math.floor(diff / 86400);
  diff %= 86400;
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}
