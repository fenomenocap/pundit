import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MatchGrounding, PricingObject } from "./api";
import {
  deskBoardFromGrounding,
  deskChipCopy,
  espnStatusByIdentity,
  fixtureChipCopy,
  formatEdgeBand,
  formatFairOdds,
  formatSignedEvPct,
  isFutureScheduledFixture,
  marketEvFromPricing,
  marketRowsFromGrounding,
  marketRowSource,
  modelFixtureStatusLabel,
  NO_COMPARISON_MARKET,
  parseDeskUserLine,
  passOrPlayChipCopy,
  PUNDIT_CONSENSUS_ROW_LABEL,
  PUNDIT_FUNDAMENTAL_ROW_LABEL,
  priceThisChipCopy,
  PULL_CHIP_DECIMAL,
  PULL_CHIP_OUTCOME,
  pullModeChipCopy,
  SHARED_TOTAL_XG_SENTENCE,
  userLinePayloadForAsk,
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

function matchGrounding(overrides: Partial<MatchGrounding> = {}): MatchGrounding {
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401",
    competitionId: "eng.1",
    competition: "English Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-14",
    stage: "REGULAR_SEASON",
    home: "Manchester United",
    away: "Manchester City",
    pHome: 0.3,
    pDraw: 0.25,
    pAway: 0.45,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    pricing: pricing(),
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

  it("formats server fair odds without inverting a probability", () => {
    assert.equal(formatFairOdds(1.21), "1.21");
    assert.equal(formatFairOdds(49.75), "49.75");
    assert.equal(NO_COMPARISON_MARKET, "No comparison market");
  });

  it("posts structured userLine from outcome + decimal, never chip copy", () => {
    assert.deepEqual(parseDeskUserLine("away", "2.10"), { outcome: "away", decimalOdds: 2.1 });
    assert.equal(parseDeskUserLine("away", ""), undefined);
    assert.equal(parseDeskUserLine("away", "1"), undefined);
    assert.deepEqual(userLinePayloadForAsk("+EV", "away", "2.10"), {
      outcome: "away",
      decimalOdds: 2.1,
    });
    assert.deepEqual(userLinePayloadForAsk("what is a +EV bet", "home", "2.10"), {
      outcome: "home",
      decimalOdds: 2.1,
    });
    assert.equal(userLinePayloadForAsk("+EV", "away", ""), undefined);
    assert.equal(userLinePayloadForAsk("Tactical matchup", "away", "2.10"), undefined);
    assert.equal(userLinePayloadForAsk("What are the odds", "home", "2.10"), undefined);
    const posted = userLinePayloadForAsk("I found City at 7 — pass or play?", "away", "2.10");
    assert.deepEqual(posted, { outcome: "away", decimalOdds: 2.1 });
    assert.notEqual(posted?.decimalOdds, PULL_CHIP_DECIMAL);
  });

  it("desk board copies fair odds and EV% from the server object", () => {
    const board = deskBoardFromGrounding(matchGrounding({
      pHome: 0.436,
      pDraw: 0.277,
      pAway: 0.287,
      pOver2_5: 0.506,
      pUnder2_5: 0.494,
      pBttsYes: 0.262,
      pBttsNo: 0.738,
      topScores: [
        { score: "0-2", probability: 0.12 },
        { score: "0-1", probability: 0.11 },
        { score: "0-3", probability: 0.09 },
        { score: "1-2", probability: 0.08 },
      ],
      oddsSources: [],
      pricing: pricing({
        model: {
          home: { p: 0.436, fairOdds: 2.29 },
          draw: { p: 0.277, fairOdds: 3.61 },
          away: { p: 0.287, fairOdds: 3.48 },
        },
        userLine: {
          outcome: "away",
          decimalOdds: 2.1,
          evPct: -0.3973,
          edgeBand: "noise",
          passPrice: 3.515,
          playPrice: 3.584,
          riskBand: "high",
        },
      }),
    }));
    assert.equal(board.oneXTwo.fairHome, 2.29);
    assert.equal(board.oneXTwo.fairDraw, 3.61);
    assert.equal(board.oneXTwo.fairAway, 3.48);
    assert.notEqual(board.oneXTwo.fairAway, 1 / 0.287);
    assert.equal(board.userLine?.decimalOdds, 2.1);
    assert.equal(board.userLine?.evPct, -0.3973);
    assert.equal(board.userLine?.edgeBand, "noise");
    assert.equal(board.userLine?.outcomeLabel, "Manchester City");
    assert.deepEqual(board.topScores.map((row) => row.score), ["0-2", "0-1", "0-3"]);
    assert.equal(board.markets.length, 0);
    assert.equal(board.totalsHonesty, SHARED_TOTAL_XG_SENTENCE);
    assert.equal(board.capturedEv.length, 0);
  });

  it("names a comparison market on an open fixture that has one", () => {
    const board = deskBoardFromGrounding(matchGrounding({
      fixtureId: "espn:eng.1:401879279",
      home: "Liverpool",
      away: "Fulham",
      pHome: 0.66,
      pDraw: 0.223,
      pAway: 0.117,
      pOver2_5: 0.5,
      pUnder2_5: 0.5,
      pBttsYes: 0.45,
      pBttsNo: 0.55,
      topScores: [
        { score: "2-0", probability: 0.132 },
        { score: "1-0", probability: 0.123 },
        { score: "1-1", probability: 0.106 },
      ],
      oddsSources: [{
        source: "polymarket",
        observedAt: "2026-09-09T10:00:00.000Z",
        pHome: 0.64,
        pDraw: 0.23,
        pAway: 0.13,
      }],
      pricing: pricing({
        fixtureId: "espn:eng.1:401879279",
        home: "Liverpool",
        away: "Fulham",
        model: {
          home: { p: 0.66, fairOdds: 1.52 },
          draw: { p: 0.223, fairOdds: 4.48 },
          away: { p: 0.117, fairOdds: 8.55 },
        },
      }),
    }));
    assert.equal(board.oneXTwo.home, "Liverpool");
    assert.equal(board.oneXTwo.away, "Fulham");
    assert.equal(board.oneXTwo.fairHome, 1.52);
    assert.equal(board.markets.length, 1);
    assert.equal(board.markets[0]?.label, "Polymarket");
    assert.equal(board.markets[0]?.id, "market-polymarket");
    assert.equal(board.userLine, null);
  });

  it("still flattens a completed-match payload without crashing or inventing a book", () => {
    const priced = deskBoardFromGrounding(matchGrounding({
      fixtureId: "espn:eng.1:401879292",
      home: "Arsenal",
      away: "Chelsea",
      pHome: 0.52,
      pDraw: 0.25,
      pAway: 0.23,
      pOver2_5: 0.57,
      pUnder2_5: 0.43,
      pBttsYes: 0.55,
      pBttsNo: 0.45,
      topScores: [],
      oddsSources: [],
      pricing: pricing({
        fixtureId: "espn:eng.1:401879292",
        home: "Arsenal",
        away: "Chelsea",
        model: {
          home: { p: 0.52, fairOdds: 1.92 },
          draw: { p: 0.25, fairOdds: 4 },
          away: { p: 0.23, fairOdds: 4.35 },
        },
        userLine: null,
      }),
    }));
    assert.equal(priced.oneXTwo.home, "Arsenal");
    assert.equal(priced.oneXTwo.away, "Chelsea");
    assert.equal(priced.oneXTwo.fairHome, 1.92);
    assert.deepEqual(priced.topScores, []);
    assert.equal(priced.markets.length, 0);
    assert.equal(priced.userLine, null);

    const lined = deskBoardFromGrounding(matchGrounding({
      fixtureId: "espn:eng.1:401879292",
      home: "Arsenal",
      away: "Chelsea",
      pHome: 0.52,
      pDraw: 0.25,
      pAway: 0.23,
      topScores: [],
      pricing: pricing({
        fixtureId: "espn:eng.1:401879292",
        home: "Arsenal",
        away: "Chelsea",
        model: {
          home: { p: 0.52, fairOdds: 1.92 },
          draw: { p: 0.25, fairOdds: 4 },
          away: { p: 0.23, fairOdds: 4.35 },
        },
        userLine: {
          outcome: "home",
          decimalOdds: 1.85,
          evPct: 0.52 * 1.85 - 1,
          edgeBand: "noise",
          passPrice: 1.95,
          playPrice: 2.0,
          riskBand: "high",
        },
      }),
    }));
    assert.equal(lined.userLine?.outcomeLabel, "Arsenal");
    assert.equal(lined.userLine?.decimalOdds, 1.85);
    assert.equal(lined.userLine?.evPct, 0.52 * 1.85 - 1);
  });

  it("flattens remaining GW4 opens onto the desk board without inventing a book or leftover line", () => {
    const remaining = [
      { fixtureId: "espn:eng.1:401879281", home: "Crystal Palace", away: "Ipswich Town" },
      { fixtureId: "espn:eng.1:401879284", home: "Aston Villa", away: "Nottingham Forest" },
      { fixtureId: "espn:eng.1:401879285", home: "Bournemouth", away: "Brentford" },
      { fixtureId: "espn:eng.1:401879277", home: "Tottenham", away: "Everton" },
      { fixtureId: "espn:eng.1:401878779", home: "Sunderland", away: "Arsenal" },
      { fixtureId: "espn:eng.1:401879282", home: "Coventry City", away: "Brighton" },
      { fixtureId: "espn:eng.1:401879280", home: "Leeds United", away: "Newcastle" },
    ] as const;
    for (const row of remaining) {
      const board = deskBoardFromGrounding(matchGrounding({
        fixtureId: row.fixtureId,
        home: row.home,
        away: row.away,
        pHome: 0.48,
        pDraw: 0.26,
        pAway: 0.26,
        pOver2_5: 0.5,
        pUnder2_5: 0.5,
        pBttsYes: 0.47,
        pBttsNo: 0.53,
        topScores: [
          { score: "1-0", probability: 0.11 },
          { score: "1-1", probability: 0.1 },
          { score: "2-1", probability: 0.09 },
        ],
        oddsSources: [],
        pricing: pricing({
          fixtureId: row.fixtureId,
          home: row.home,
          away: row.away,
          model: {
            home: { p: 0.48, fairOdds: 2.08 },
            draw: { p: 0.26, fairOdds: 3.85 },
            away: { p: 0.26, fairOdds: 3.85 },
          },
          userLine: null,
        }),
      }));
      assert.equal(board.oneXTwo.home, row.home);
      assert.equal(board.oneXTwo.away, row.away);
      assert.equal(board.oneXTwo.fairHome, 2.08);
      assert.equal(board.userLine, null);
      assert.equal(board.markets.length, 0);
      assert.deepEqual(board.topScores.map((s) => s.score), ["1-0", "1-1", "2-1"]);
    }
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

describe("labelled Consensus presentation", () => {
  it("keeps Fundamental 1X2 on the forecast row and labels Consensus separately", () => {
    const withoutMarket = matchGrounding();
    const rowsWithout = marketRowsFromGrounding(withoutMarket);
    assert.equal(rowsWithout.some((row) => row.provenance === "consensus"), false);
    assert.equal(deskBoardFromGrounding(withoutMarket).consensus, null);
    assert.equal(rowsWithout[0]?.label, PUNDIT_FUNDAMENTAL_ROW_LABEL);
    assert.equal(rowsWithout[0]?.pHome, withoutMarket.pHome);

    const withConsensus = matchGrounding({
      consensus: {
        label: PUNDIT_CONSENSUS_ROW_LABEL,
        fundamentalLabel: "Pundit Fundamental",
        marketSource: "kalshi",
        marketLabel: "Kalshi market (no-vig)",
        observedAt: "2026-09-09T10:00:00.000Z",
        marketWeight: 0.5,
        pHome: 0.4,
        pDraw: 0.28,
        pAway: 0.32,
        pOver2_5: 0.51,
        pUnder2_5: 0.49,
        pBttsYes: 0.48,
        pBttsNo: 0.52,
        topScores: [],
      },
    });
    const rows = marketRowsFromGrounding(withConsensus);
    const forecast = rows.find((row) => row.provenance === "forecast");
    const consensus = rows.find((row) => row.provenance === "consensus");
    assert.equal(forecast?.pHome, 0.3);
    assert.equal(forecast?.label, PUNDIT_FUNDAMENTAL_ROW_LABEL);
    assert.equal(consensus?.label, PUNDIT_CONSENSUS_ROW_LABEL);
    assert.equal(consensus?.pHome, 0.4);
    assert.notEqual(consensus?.pHome, forecast?.pHome);
    const board = deskBoardFromGrounding(withConsensus);
    assert.equal(board.oneXTwo.pHome, 0.3);
    assert.equal(board.consensus?.label, PUNDIT_CONSENSUS_ROW_LABEL);
    assert.equal(board.consensus?.pHome, 0.4);
  });
});
