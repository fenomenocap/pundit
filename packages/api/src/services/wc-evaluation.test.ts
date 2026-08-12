import { describe, expect, it } from "vitest";
import {
  buildEvaluationFixture,
  computeEvaluationMetrics,
} from "./wc-evaluation";
import {
  buildReconstructedFixtures,
  reconstructPreTournamentRatings,
} from "./wc-evaluation-build";
import { FootballMatch } from "./football-data";

describe("wc evaluation metrics", () => {
  it("reports unavailable scores rather than perfect zero loss for no samples", () => {
    expect(computeEvaluationMetrics([])).toEqual({
      fixtureCount: 0,
      brierScore: null,
      logLoss: null,
      winnerAccuracy: null,
      drawCount: 0,
      calibration: [],
    });
  });

  it("computes multi-class brier and log loss for known outcomes", () => {
    const fixtures = [
      buildEvaluationFixture({
        id: 1,
        utcDate: "2026-06-11T19:00Z",
        stage: "group-stage",
        group: "A",
        home: "Mexico",
        away: "South Africa",
        homeElo: 1600,
        awayElo: 1400,
        homeScore: 2,
        awayScore: 0,
      }),
      buildEvaluationFixture({
        id: 2,
        utcDate: "2026-06-12T19:00Z",
        stage: "group-stage",
        group: "B",
        home: "Canada",
        away: "Switzerland",
        homeElo: 1500,
        awayElo: 1500,
        homeScore: 1,
        awayScore: 1,
      }),
    ];
    const metrics = computeEvaluationMetrics(fixtures);
    expect(metrics.fixtureCount).toBe(2);
    expect(metrics.drawCount).toBe(1);
    expect(metrics.brierScore).toBeGreaterThan(0);
    expect(metrics.logLoss).toBeGreaterThan(0);
    expect(metrics.winnerAccuracy).toBeGreaterThanOrEqual(0);
    expect(metrics.calibration.length).toBeGreaterThan(0);
  });

  it("scores every forecast in the reliability curve, not only the realised one", () => {
    const fixtures = [
      buildEvaluationFixture({
        id: 1,
        utcDate: "2026-06-11T19:00Z",
        stage: "group-stage",
        group: "A",
        home: "Mexico",
        away: "South Africa",
        homeElo: 1600,
        awayElo: 1400,
        homeScore: 2,
        awayScore: 0,
      }),
    ];
    const metrics = computeEvaluationMetrics(fixtures);

    // One fixture carries three forecasts — home, draw and away — and exactly
    // one of them happened.
    const totalForecasts = metrics.calibration.reduce((sum, b) => sum + b.count, 0);
    expect(totalForecasts).toBe(3);
    const occurred = metrics.calibration.reduce((sum, b) => sum + b.actualRate * b.count, 0);
    expect(Math.round(occurred)).toBe(1);

    // The regression: binning only the realised outcome and counting it as
    // having happened made every bucket read 100%, which is what a perfectly
    // calibrated model looks like and is unachievable in practice.
    expect(metrics.calibration.every((bucket) => bucket.actualRate === 1)).toBe(false);
  });
});

describe("wc evaluation reconstruction", () => {
  const finishedMatches: FootballMatch[] = [
    {
      id: 1,
      competitionId: "fifa.world",
      competition: "FIFA World Cup",
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      utcDate: "2026-06-11T19:00Z",
      status: "FINISHED",
      stage: "group-stage",
      matchday: null,
      group: "A",
      score: { home: 2, away: 0 },
      winner: "Mexico",
    },
    {
      id: 2,
      competitionId: "fifa.world",
      competition: "FIFA World Cup",
      homeTeam: "Canada",
      awayTeam: "Switzerland",
      utcDate: "2026-06-12T19:00Z",
      status: "FINISHED",
      stage: "group-stage",
      matchday: null,
      group: "B",
      score: { home: 1, away: 1 },
      winner: null,
    },
  ];

  it("rewinds and replays Elo updates without look-ahead", () => {
    const post = new Map([
      ["Mexico", 1620],
      ["South Africa", 1380],
      ["Canada", 1510],
      ["Switzerland", 1490],
    ]);
    const pre = reconstructPreTournamentRatings(finishedMatches, post);
    expect(pre.get("Mexico")).not.toBe(post.get("Mexico"));

    const fixtures = buildReconstructedFixtures(finishedMatches, pre);
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0].method).toBe("reconstructed");
    expect(fixtures[0].result.winner).toBe("home");
    expect(fixtures[1].result.winner).toBe("draw");
    expect(fixtures[0].pHome + fixtures[0].pDraw + fixtures[0].pAway).toBeCloseTo(1, 4);
  });
});
