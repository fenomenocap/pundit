/**
 * Bet slip maths. Pure functions, no state, no wallet.
 *
 * Prices are decimal odds as shown on the site. A single returns stake x price.
 * An accumulator returns stake x product of prices and needs every leg to win.
 * Accumulators need at least two legs from different matches: legs from the
 * same match are correlated, so multiplying their prices would be wrong.
 */

export const MAX_STAKE = 1_000_000;

export type SlipSelection = {
  fixtureId: string;
  market: string;
  price: number;
};

export type StakeParse =
  | { ok: true; value: number }
  | { ok: false; value: null; message: string | null };

/** Parse the stake input. Empty input is not an error, just no stake yet. */
export function parseStake(raw: string): StakeParse {
  const text = raw.trim().replace(/,/g, "");
  if (text === "") return { ok: false, value: null, message: null };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, value: null, message: "Enter a stake as a positive amount with at most two decimal places." };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, value: null, message: "Stake must be greater than zero." };
  }
  if (value > MAX_STAKE) {
    return { ok: false, value: null, message: `Stake cannot exceed ${MAX_STAKE.toLocaleString("en-GB")}.` };
  }
  return { ok: true, value };
}

export function isValidPrice(price: number) {
  return Number.isFinite(price) && price > 1;
}

/** Round to pence for display and totals. */
export function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Product of decimal prices. Empty list is 1 (no legs). */
export function combinedOdds(prices: readonly number[]) {
  return prices.reduce((acc, p) => acc * p, 1);
}

export type LegReturn = { fixtureId: string; market: string; price: number; stake: number; returns: number; profit: number };

export type SinglesResult = {
  legs: LegReturn[];
  totalStake: number;
  /** Return if every single wins. */
  maxReturn: number;
  maxProfit: number;
};

/** Singles: the same stake on each selection separately. */
export function singlesReturns(selections: readonly SlipSelection[], stakePerSelection: number): SinglesResult {
  const legs = selections.map((s) => {
    const returns = roundMoney(stakePerSelection * s.price);
    return { fixtureId: s.fixtureId, market: s.market, price: s.price, stake: stakePerSelection, returns, profit: roundMoney(returns - stakePerSelection) };
  });
  const totalStake = roundMoney(stakePerSelection * selections.length);
  const maxReturn = roundMoney(legs.reduce((a, l) => a + l.returns, 0));
  return { legs, totalStake, maxReturn, maxProfit: roundMoney(maxReturn - totalStake) };
}

export type AccumulatorResult =
  | { ok: true; legs: number; odds: number; stake: number; returns: number; profit: number }
  | { ok: false; reason: string };

export function accumulatorName(legs: number) {
  if (legs === 2) return "Double";
  if (legs === 3) return "Treble";
  if (legs >= 4) return `${legs}-fold accumulator`;
  return "Accumulator";
}

/** Accumulator: one stake, every leg must win. */
export function accumulatorReturns(selections: readonly SlipSelection[], stake: number): AccumulatorResult {
  if (selections.length < 2) return { ok: false, reason: "An accumulator needs at least two selections." };
  const fixtures = new Set(selections.map((s) => s.fixtureId));
  if (fixtures.size !== selections.length) {
    return { ok: false, reason: "An accumulator cannot include two selections from the same match." };
  }
  if (!selections.every((s) => isValidPrice(s.price))) {
    return { ok: false, reason: "Every selection needs a price above 1.00." };
  }
  const odds = combinedOdds(selections.map((s) => s.price));
  const returns = roundMoney(stake * odds);
  return { ok: true, legs: selections.length, odds, stake: roundMoney(stake), returns, profit: roundMoney(returns - stake) };
}

/**
 * Add or toggle a selection. Clicking the same price again removes it.
 * A new pick on a match already on the slip replaces the earlier pick, so the
 * slip never holds two outcomes of one match.
 */
export function toggleSelection<T extends SlipSelection>(slip: readonly T[], next: T): T[] {
  const same = slip.find((s) => s.fixtureId === next.fixtureId && s.market === next.market);
  if (same) return slip.filter((s) => s !== same);
  return [...slip.filter((s) => s.fixtureId !== next.fixtureId), next];
}

/** Keep selections whose match is still listed, and refresh their price. */
export function reconcileSelections<T extends SlipSelection>(
  slip: readonly T[],
  priceFor: (fixtureId: string, market: string) => number | null,
): T[] {
  const out: T[] = [];
  for (const s of slip) {
    const price = priceFor(s.fixtureId, s.market);
    if (price !== null && isValidPrice(price)) out.push({ ...s, price });
  }
  return out;
}
