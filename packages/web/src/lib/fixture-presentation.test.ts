import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MatchGrounding, PricingObject } from "./api";
import {
  canRenderDeskBoard,
  deskBoardFromGrounding,
  deskChipCopy,
  espnStatusByIdentity,
  fixtureChipCopy,
  formatEdgeBand,
  formatFairOdds,
  formatKickoffTime,
  formatKickoffDay,
  formatSignedEvPct,
  isFutureScheduledFixture,
  marketEvFromPricing,
  marketRowSource,
  modelFixtureStatusLabel,
  NO_COMPARISON_MARKET,
  parseDeskUserLine,
  passOrPlayChipCopy,
  priceThisChipCopy,
  PULL_CHIP_DECIMAL,
  PULL_CHIP_OUTCOME,
  pullModeChipCopy,
  SHARED_TOTAL_XG_SENTENCE,
  CALIBRATED_GOALS_SENTENCE,
  goalForecastDisclosure,
  userLinePayloadForAsk,
} from "./fixture-presentation.ts";
import { deskNumbersFromModelRow, samplePaperScore, sampleScoreGrid, type ModelRowLambdas } from "../desk/lib/grid.ts";

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
    assert.equal(formatEdgeBand("fat-and-fragile"), "large price gap; sensitive to forecast error");
    assert.equal(formatEdgeBand("noise"), "negligible price gap");
    assert.equal(formatEdgeBand("thin"), "small price gap; error could erase it");
    assert.equal(formatEdgeBand("real"), "material price gap; depends on forecast accuracy");
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
      "I use a fixed total-goals assumption, so these totals cannot tell me whether this particular match will be more open or tighter."
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

function matchGrounding(over: Partial<MatchGrounding> = {}): MatchGrounding {
  return {
    kind: "match",
    fixtureId: "espn:eng.1:1",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-13",
    stage: "match",
    home: "Arsenal",
    away: "Coventry City",
    pHome: 0.72,
    pDraw: 0.18,
    pAway: 0.1,
    pOver2_5: 0.506,
    pUnder2_5: 0.494,
    pBttsYes: 0.4,
    pBttsNo: 0.6,
    topScores: [
      { score: "2-0", probability: 0.12 },
      { score: "1-0", probability: 0.11 },
      { score: "2-1", probability: 0.09 },
    ],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    pricing: pricing(),
    ...over,
  };
}

describe("desk board presentation", () => {
  it("posts structured userLine only on +EV / pass-or-play copy, never from a typed decimal alone", () => {
    assert.deepEqual(parseDeskUserLine("away", "2.10"), { outcome: "away", decimalOdds: 2.1 });
    assert.equal(parseDeskUserLine("away", "1"), undefined);
    assert.equal(userLinePayloadForAsk("Tactical matchup", "away", "2.10"), undefined);
    assert.deepEqual(userLinePayloadForAsk("+EV", "away", "2.10"), {
      outcome: "away",
      decimalOdds: 2.1,
    });
    assert.equal(userLinePayloadForAsk("+EV", "away", ""), undefined);
  });

  it("copies server fair odds onto the board and does not invent a comparison market", () => {
    const board = deskBoardFromGrounding(matchGrounding());
    assert.equal(board.oneXTwo.fairHome, 1 / 0.72);
    assert.equal(formatFairOdds(board.oneXTwo.fairHome), (1 / 0.72).toFixed(2));
    assert.equal(board.markets.length, 0);
    assert.equal(NO_COMPARISON_MARKET, "No comparison market");
    assert.equal(board.totalsHonesty, SHARED_TOTAL_XG_SENTENCE);
    assert.equal(canRenderDeskBoard(matchGrounding({ pricing: undefined as never })), false);
  });

  it("surfaces server userLine EV% without recomputing it", () => {
    const board = deskBoardFromGrounding(matchGrounding({
      pricing: pricing({
        userLine: {
          outcome: "away",
          decimalOdds: 2.1,
          evPct: 0.1 * 2.1 - 1,
          edgeBand: "thin",
          passPrice: 1.2,
          playPrice: 1.4,
          riskBand: "high",
        },
      }),
    }));
    assert.equal(board.userLine?.outcomeLabel, "Coventry City");
    assert.equal(board.userLine?.decimalOdds, 2.1);
    assert.equal(board.userLine?.evPct, 0.1 * 2.1 - 1);
    assert.equal(formatSignedEvPct(board.userLine!.evPct), "-79.0%");
  });
});


describe("UK kickoff clock", () => {
  it("uses the same competition date and time across DST boundaries and reader timezones", () => {
    assert.equal(formatKickoffTime("2026-10-10T11:30:00Z"), "12:30");
    assert.equal(formatKickoffDay("2026-10-10T11:30:00Z"), "10 Oct");
    assert.equal(formatKickoffTime("2026-12-10T12:30:00Z"), "12:30");
    assert.equal(formatKickoffDay("2026-08-01T23:30:00Z"), "2 Aug");
  });
});


function calibratedRow(): ModelRowLambdas {
  const artifactSha256 = "b".repeat(64);
  return {
    competitionId: "eng.1", fixtureId: 1, utcDate: "2026-10-10T11:30:00Z", home: "Arsenal", away: "Leeds",
    homeElo: 1900, awayElo: 1600, pHome: 0.5, pDraw: 0.3, pAway: 0.2,
    pOver2_5: 0.35, pUnder2_5: 0.65, pBttsYes: 0.45, pBttsNo: 0.55,
    expectedHomeGoals: 1.15, expectedAwayGoals: 0.8,
    scoreGrid: [[0.1, 0.1, 0.05], [0.2, 0.1, 0.05], [0.1, 0.2, 0.1]],
    goalCalibration: { methodId: "outcome-anchored-shrunk-goals-v2", artifactSha256,
      artifactId: `outcome-anchored-shrunk-goals-v2:${artifactSha256}` },
    forecastInputs: { homeStrength: 1900, awayStrength: 1600, homeAdvantageElo: 42,
      fixtureId: 1, competitionId: "eng.1", utcDate: "2026-10-10T11:30:00Z", home: "Arsenal", away: "Leeds",
      ratingArtifactId: "ratings:test", ratingArtifactSha256: "a".repeat(64), ratingSnapshotAt: "2026-10-06T00:00:00Z",
      goalCalibrationArtifactSha256: artifactSha256 },
    forecastProvenance: { homeAdvantageElo: 42, ratingArtifactId: "ratings:test", ratingArtifactSha256: "a".repeat(64),
      ratingSnapshotAt: "2026-10-06T00:00:00Z", goalCalibrationArtifactSha256: artifactSha256,
      config: { baseGoals: 1.35, eloScale: 400, lambdaCap: 5 } },
  };
}

describe("calibrated goal distribution delivery", () => {
  it("uses final server means instead of reconstructing shape or fixed-total lambdas", () => {
    const row = calibratedRow();
    assert.deepEqual(deskNumbersFromModelRow(row), { xg: [1.15, 0.8], over25: 0.35 });
    row.pOver2_5 = 0.35004;
    assert.equal(deskNumbersFromModelRow(row).over25, 0.35004);
    delete row.goalCalibration;
    delete row.forecastInputs!.goalCalibrationArtifactSha256;
    delete row.forecastProvenance!.goalCalibrationArtifactSha256;
    assert.deepEqual(deskNumbersFromModelRow(row).xg, [2.37, 0.33]);
  });

  it("rejects mismatched artifacts, fixture ownership and final-grid arithmetic", () => {
    const mutations: Array<(row: ModelRowLambdas) => void> = [
      row => { row.goalCalibration!.artifactId = "wrong"; },
      row => { row.goalCalibration!.artifactSha256 = "not-a-hash"; },
      row => { row.forecastInputs!.goalCalibrationArtifactSha256 = "a".repeat(64); },
      row => { delete row.forecastProvenance!.goalCalibrationArtifactSha256; },
      row => { row.competitionId = "uefa.champions_qual"; },
      row => { row.forecastInputs!.home = "Chelsea"; },
      row => { row.expectedHomeGoals = 2.22; },
      row => { row.expectedAwayGoals = NaN; },
      row => { row.pOver2_5 = 0.5; },
      row => { row.pBttsYes = 0.5; },
      row => { row.pHome = 0.6; },
      row => { row.pUnder2_5 = 0.7; },
      row => { row.pBttsNo = 0.7; },
      row => { row.scoreGrid![0][0] = -0.1; },
      row => { row.scoreGrid![0][0] = NaN; },
      row => { row.scoreGrid![0][0] = 0.2; },
      row => { row.scoreGrid = [[1, 0], [0]]; },
      row => { delete row.scoreGrid; },
      row => { delete row.goalCalibration; },
    ];
    for (const mutate of mutations) {
      const row = calibratedRow(); mutate(row);
      assert.throws(() => deskNumbersFromModelRow(row));
    }
  });

  it("renders calibrated and baseline disclosures from the actual method", () => {
    assert.equal(goalForecastDisclosure(calibratedRow().goalCalibration), CALIBRATED_GOALS_SENTENCE);
    assert.equal(goalForecastDisclosure(), SHARED_TOTAL_XG_SENTENCE);
    const invalid = { ...calibratedRow().goalCalibration!, artifactId: "wrong" };
    assert.throws(() => goalForecastDisclosure(invalid));
    const grounding: MatchGrounding = { kind: "match", competition: "Premier League", homeFieldAdvantage: true,
      date: "2026-10-10", stage: "match", topScores: [], scorelines: [], stakePHome: null, stakePDraw: null, stakePAway: null, fixtureId: "espn:eng.1:1", competitionId: "eng.1", home: "Arsenal", away: "Leeds",
      pricing: pricing(), oddsSources: [], pHome: 0.5, pDraw: 0.3, pAway: 0.2,
      pOver2_5: 0.35, pUnder2_5: 0.65, pBttsYes: 0.45, pBttsNo: 0.55,
      goalCalibration: calibratedRow().goalCalibration };
    assert.equal(deskBoardFromGrounding(grounding).totalsHonesty, CALIBRATED_GOALS_SENTENCE);
    delete grounding.goalCalibration;
    assert.equal(deskBoardFromGrounding(grounding).totalsHonesty, SHARED_TOTAL_XG_SENTENCE);
  });

  it("paper sampling uses the full joint CDF with one draw and retains a legacy fallback", () => {
    const row = calibratedRow();
    let calls = 0;
    assert.deepEqual(samplePaperScore({ xg: [1.15, 0.8], scoreGrid: row.scoreGrid, goalCalibration: row.goalCalibration },
      () => { calls++; return 0.95; }), [2, 2]);
    assert.equal(calls, 1);
    assert.deepEqual(sampleScoreGrid(row.scoreGrid!, () => 0), [0, 0]);
    assert.deepEqual(sampleScoreGrid(row.scoreGrid!, () => 0.10001), [0, 1]);
    assert.deepEqual(samplePaperScore({ xg: [0, 0] }, () => 0.5), [0, 0]);
    assert.throws(() => samplePaperScore({ xg: [1.15, 0.8], goalCalibration: row.goalCalibration }));
    assert.throws(() => sampleScoreGrid([[0, 0], [0, 0]]));
    assert.throws(() => sampleScoreGrid(row.scoreGrid!, () => 1));
  });
});
