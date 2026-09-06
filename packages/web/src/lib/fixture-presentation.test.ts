import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PricingObject } from "./api";
import {
  formatEdgeBand,
  formatSignedEvPct,
  marketEvFromPricing,
  marketRowSource,
  PULL_CHIP_DECIMAL,
  PULL_CHIP_OUTCOME,
  pullModeChipCopy,
} from "./fixture-presentation";

function pricing(overrides: Partial<PricingObject> = {}): PricingObject {
  return {
    fixtureId: "espn:eng.1:1",
    home: "Arsenal",
    away: "Coventry City",
    kickoff: "2026-09-01",
    modelVersion: "clubelo@1:test",
    pricedAt: "2026-08-30T06:00:00.000Z",
    model: {
      home: { p: 0.72, fairOdds: 1 / 0.72 },
      draw: { p: 0.18, fairOdds: 1 / 0.18 },
      away: { p: 0.1, fairOdds: 10 },
    },
    markets: [],
    userLine: null,
    stakeFrac: null,
    ...overrides,
  };
}

describe("pricing presentation", () => {
  it("formats signed EV% from the server fraction without recomputing", () => {
    assert.equal(formatSignedEvPct(0.4), "+40.0%");
    assert.equal(formatSignedEvPct(-0.1), "-10.0%");
    assert.equal(formatSignedEvPct(0.0034), "+0.3%");
    assert.equal(formatEdgeBand("fat-and-fragile"), "fat-and-fragile");
    assert.equal(formatEdgeBand(null), null);
  });

  it("exposes implied p, EV%, and edge band only when the server set evPct", () => {
    const rows = marketEvFromPricing(pricing({
      markets: [{
        source: "book",
        observedAt: "2026-08-30T06:00:00.000Z",
        edgeBand: "fat-and-fragile",
        legs: {
          home: {
            outcome: "home", modelP: 0.72, fairOdds: 1 / 0.72,
            decimalOdds: 7, impliedP: 1 / 7, evPct: 0.72 * 7 - 1,
          },
          draw: {
            outcome: "draw", modelP: 0.18, fairOdds: 1 / 0.18,
            decimalOdds: null, impliedP: null, evPct: null,
          },
          away: {
            outcome: "away", modelP: 0.1, fairOdds: 10,
            decimalOdds: 1.8, impliedP: 1 / 1.8, evPct: 0.1 * 1.8 - 1,
          },
        },
      }, {
        source: "kalshi",
        observedAt: "2026-08-30T06:00:00.000Z",
        edgeBand: null,
        legs: {
          home: {
            outcome: "home", modelP: 0.72, fairOdds: 1 / 0.72,
            decimalOdds: null, impliedP: null, evPct: null,
          },
          draw: {
            outcome: "draw", modelP: 0.18, fairOdds: 1 / 0.18,
            decimalOdds: null, impliedP: null, evPct: null,
          },
          away: {
            outcome: "away", modelP: 0.1, fairOdds: 10,
            decimalOdds: null, impliedP: null, evPct: null,
          },
        },
      }],
    }));
    assert.equal(rows.has("kalshi"), false);
    assert.deepEqual(rows.get("book"), {
      source: "book",
      edgeBand: "fat-and-fragile",
      legs: {
        home: { impliedP: 1 / 7, evPct: 0.72 * 7 - 1 },
        away: { impliedP: 1 / 1.8, evPct: 0.1 * 1.8 - 1 },
      },
    });
    assert.equal(marketEvFromPricing(undefined).size, 0);
    assert.equal(marketRowSource({ id: "market-kalshi" }), "kalshi");
    assert.equal(marketRowSource({ id: "forecast" }), null);
  });

  it("pins the empty-state pull chip to away at 7", () => {
    assert.equal(PULL_CHIP_OUTCOME, "away");
    assert.equal(PULL_CHIP_DECIMAL, 7);
    assert.equal(pullModeChipCopy("Arsenal"), "I found Arsenal at 7 — pass or play?");
  });
});
