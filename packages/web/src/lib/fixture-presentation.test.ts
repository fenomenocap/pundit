import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PricingObject } from "./api";
import {
  deskChipCopy,
  espnStatusByIdentity,
  fixtureChipCopy,
  formatEdgeBand,
  formatSignedEvPct,
  isFutureScheduledFixture,
  marketEvFromPricing,
  marketRowSource,
  modelFixtureStatusLabel,
  passOrPlayChipCopy,
  priceThisChipCopy,
  PULL_CHIP_DECIMAL,
  PULL_CHIP_OUTCOME,
  pullModeChipCopy,
  SHARED_TOTAL_XG_SENTENCE,
} from "./fixture-presentation.ts";

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

  it("pins fixture chips without preview or analysis cues", () => {
    assert.equal(
      fixtureChipCopy("Arsenal", "Coventry City", "PL", "Tue"),
      "Arsenal vs Coventry City · PL · Tue"
    );
    assert.equal(
      fixtureChipCopy("Dinamo Zagreb", "Viking", "UCL", "Wed"),
      "Dinamo Zagreb vs Viking · UCL · Wed"
    );
    const text = fixtureChipCopy("Arsenal", "Coventry City", "PL", "Sat");
    assert.equal(/\b(?:preview|analyse|analyze|thoughts)\b/i.test(text), false);
  });

  it("does not sell Over 2.5 as a match-specific insight", () => {
    assert.equal(
      SHARED_TOTAL_XG_SENTENCE,
      "Totals sit near 50% because every match uses the same 2.70 expected goals."
    );
    assert.equal(/ClubElo|Dixon-Coles|Dixon–Coles/i.test(SHARED_TOTAL_XG_SENTENCE), false);
  });

  it("pins Pundit desk chip copy for pass/play and price-this", () => {
    assert.equal(passOrPlayChipCopy("Arsenal", "Coventry City"), "Pass or play · Arsenal vs Coventry City");
    assert.equal(
      priceThisChipCopy("Liverpool", "Brighton & Hove Albion"),
      "Price this · Liverpool vs Brighton & Hove Albion"
    );
    assert.equal(
      deskChipCopy("Dinamo Zagreb", "Viking", "pass-or-play"),
      "Pass or play · Dinamo Zagreb vs Viking"
    );
    assert.equal(
      deskChipCopy("Liverpool", "Brighton & Hove Albion", "price-this"),
      "Price this · Liverpool vs Brighton & Hove Albion"
    );
  });

  it("offers only future SCHEDULED fixtures as upcoming desk chips", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const future = "2026-09-08T15:00:00.000Z";
    const past = "2026-09-07T11:00:00.000Z";
    assert.equal(isFutureScheduledFixture(future, "SCHEDULED", now), true);
    assert.equal(isFutureScheduledFixture(future, undefined, now), true);
    assert.equal(isFutureScheduledFixture(future, "IN_PLAY", now), false);
    assert.equal(isFutureScheduledFixture(future, "FINISHED", now), false);
    assert.equal(isFutureScheduledFixture(past, "SCHEDULED", now), false);
    assert.equal(isFutureScheduledFixture(past, "IN_PLAY", now), false);
  });

  it("labels Live / Full time instead of Upcoming once ESPN says the match has started", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    const future = "2026-09-08T15:00:00.000Z";
    const past = "2026-09-07T11:00:00.000Z";
    assert.equal(modelFixtureStatusLabel({ utcDate: past, espnStatus: "IN_PLAY", now }), "Live");
    assert.equal(modelFixtureStatusLabel({ utcDate: past, espnStatus: "FINISHED", now }), "Full time");
    assert.equal(modelFixtureStatusLabel({
      utcDate: past,
      result: { homeScore: 2, awayScore: 1 },
      now,
    }), "Full time");
    assert.equal(modelFixtureStatusLabel({ utcDate: future, espnStatus: "SCHEDULED", now }), "Upcoming");
    assert.equal(modelFixtureStatusLabel({ utcDate: past, espnStatus: "SCHEDULED", now }), "Kickoff passed");
    assert.equal(modelFixtureStatusLabel({ utcDate: past, now }), "Kickoff passed");
    assert.equal(
      espnStatusByIdentity([{ competitionId: "eng.1", id: 5, status: "IN_PLAY" }]).get("espn:eng.1:5"),
      "IN_PLAY"
    );
  });
});
