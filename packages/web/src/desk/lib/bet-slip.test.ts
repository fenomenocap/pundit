import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulatorName,
  accumulatorReturns,
  combinedOdds,
  parseStake,
  reconcileSelections,
  roundMoney,
  singlesReturns,
  toggleSelection,
} from "./bet-slip.ts";

const a = { fixtureId: "f1", market: "home", price: 2.0 };
const b = { fixtureId: "f2", market: "draw", price: 3.4 };
const c = { fixtureId: "f3", market: "away", price: 1.55 };

describe("bet slip maths", () => {
  it("parses stakes strictly", () => {
    assert.deepEqual(parseStake("10"), { ok: true, value: 10 });
    assert.deepEqual(parseStake("1,250.50"), { ok: true, value: 1250.5 });
    assert.equal(parseStake("").ok, false);
    const empty = parseStake("");
    assert.equal(empty.ok ? "x" : empty.message, null);
    assert.equal(parseStake("0").ok, false);
    assert.equal(parseStake("-5").ok, false);
    assert.equal(parseStake("1.234").ok, false);
    assert.equal(parseStake("abc").ok, false);
    assert.equal(parseStake("1e3").ok, false);
    assert.equal(parseStake("2000000").ok, false);
  });

  it("multiplies prices for combined odds", () => {
    assert.equal(combinedOdds([]), 1);
    assert.equal(combinedOdds([2]), 2);
    assert.ok(Math.abs(combinedOdds([2, 3.4, 1.55]) - 10.54) < 1e-9);
  });

  it("returns singles per selection and in total", () => {
    const r = singlesReturns([a, b], 10);
    assert.deepEqual(r.legs.map((l) => l.returns), [20, 34]);
    assert.deepEqual(r.legs.map((l) => l.profit), [10, 24]);
    assert.equal(r.totalStake, 20);
    assert.equal(r.maxReturn, 54);
    assert.equal(r.maxProfit, 34);
  });

  it("rounds returns to pence", () => {
    const r = singlesReturns([{ fixtureId: "x", market: "home", price: 1.333 }], 3.33);
    assert.equal(r.legs[0].returns, roundMoney(3.33 * 1.333));
    assert.equal(r.legs[0].returns, 4.44);
  });

  it("prices an accumulator as stake times the product of prices", () => {
    const r = accumulatorReturns([a, b, c], 5);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.legs, 3);
    assert.ok(Math.abs(r.odds - 10.54) < 1e-9);
    assert.equal(r.returns, 52.7);
    assert.equal(r.profit, 47.7);
  });

  it("refuses accumulators that are too short or share a match", () => {
    assert.equal(accumulatorReturns([a], 10).ok, false);
    const same = accumulatorReturns([a, { fixtureId: "f1", market: "draw", price: 3 }], 10);
    assert.equal(same.ok, false);
    if (!same.ok) assert.match(same.reason, /same match/);
    assert.equal(accumulatorReturns([a, { fixtureId: "f9", market: "home", price: 1 }], 10).ok, false);
  });

  it("names accumulators", () => {
    assert.equal(accumulatorName(2), "Double");
    assert.equal(accumulatorName(3), "Treble");
    assert.equal(accumulatorName(5), "5-fold accumulator");
  });

  it("toggles selections and keeps one pick per match", () => {
    let slip = toggleSelection([], a);
    assert.deepEqual(slip, [a]);
    slip = toggleSelection(slip, b);
    assert.equal(slip.length, 2);
    const swap = { fixtureId: "f1", market: "away", price: 4 };
    slip = toggleSelection(slip, swap);
    assert.deepEqual(slip, [b, swap]);
    slip = toggleSelection(slip, swap);
    assert.deepEqual(slip, [b]);
  });

  it("drops selections whose match or price is gone and refreshes prices", () => {
    const prices: Record<string, number | null> = { "f1:home": 2.1, "f2:draw": null };
    const out = reconcileSelections([a, b, c], (f, m) => prices[`${f}:${m}`] ?? null);
    assert.deepEqual(out, [{ ...a, price: 2.1 }]);
  });
});
