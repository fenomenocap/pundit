import { describe, expect, it } from "vitest";
import {
  BASE_GOALS,
  LAMBDA_CAP,
  MAX_GOALS,
  RHO,
  computeMatchModel,
  dixonColesTau,
  eloToLambdas,
  matrixTo1x2,
  matrixToBtts,
  matrixToCorrectScores,
  matrixToScorelines,
  matrixToTotals,
  sampleScoreFromMatrix,
  scoreMatrix,
  simulateMatch,
} from "./dixon-coles";

describe("local Dixon-Coles model", () => {
  it("preserves the calibrated Elo-to-goal constants and cap", () => {
    expect(eloToLambdas(1800, 1800)).toEqual([BASE_GOALS, BASE_GOALS]);
    const [stronger, weaker] = eloToLambdas(3000, 1000);
    expect(stronger).toBeLessThan(LAMBDA_CAP);
    expect(stronger + weaker).toBeCloseTo(2 * BASE_GOALS, 12);
    expect(weaker).toBeLessThan(stronger);
  });

  it("uses the four Dixon-Coles low-score corrections", () => {
    expect(dixonColesTau(0, 0, 1.7, 0.9, RHO)).toBe(1 - 1.7 * 0.9 * RHO);
    expect(dixonColesTau(0, 1, 1.7, 0.9, RHO)).toBe(1 + 1.7 * RHO);
    expect(dixonColesTau(1, 0, 1.7, 0.9, RHO)).toBe(1 + 0.9 * RHO);
    expect(dixonColesTau(1, 1, 1.7, 0.9, RHO)).toBe(1 - RHO);
    expect(dixonColesTau(2, 1, 1.7, 0.9, RHO)).toBe(1);
  });

  it("normalizes 1X2, totals, BTTS, and ordered scorelines", () => {
    const matrix = scoreMatrix(...eloToLambdas(1950, 1750));
    expect(matrix.flat().reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(matrixTo1x2(matrix).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(matrixToTotals(matrix, 2.5).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(matrixToBtts(matrix).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    const scores = matrixToCorrectScores(matrix, 5);
    expect(scores).toHaveLength(5);
    expect(scores.map(([, probability]) => probability)).toEqual(
      [...scores.map(([, probability]) => probability)].sort((a, b) => b - a)
    );
  });

  it("keeps every scoreline above the floor, ordered, alongside the top-5 contract", () => {
    const matrix = scoreMatrix(...eloToLambdas(1950, 1750));
    const scorelines = matrixToScorelines(matrix);
    expect(scorelines.length).toBeGreaterThan(5);
    expect(scorelines.every(([, probability]) => probability >= 0.001)).toBe(true);
    expect(scorelines.map(([, probability]) => probability)).toEqual(
      [...scorelines.map(([, probability]) => probability)].sort((a, b) => b - a)
    );
    const model = computeMatchModel(1950, 1750);
    expect(model.topScores).toHaveLength(5);
    expect(model.scorelines.slice(0, 5)).toEqual(model.topScores);
  });

  it("pins the fixed-total Elo mapping for a representative Elo pair", () => {
    const matrix = scoreMatrix(...eloToLambdas(2050, 1750));
    const [home, draw, away] = matrixTo1x2(matrix);
    expect(home).toBeCloseTo(0.7964736124811775, 12);
    expect(draw).toBeCloseTo(0.15885878061181752, 12);
    expect(away).toBeCloseTo(0.044667606907005795, 12);
  });

  it("keeps Hull vs United at 2.70 xG and a rating-faithful 1X2", () => {
    const [hullXg, unitedXg] = eloToLambdas(1532.9, 1915.3, 42);
    expect(hullXg + unitedXg).toBeCloseTo(2.7, 12);
    expect(hullXg + unitedXg).toBeLessThan(3);
    const model = computeMatchModel(1532.9, 1915.3, 42);
    expect(model.pAway).toBeCloseTo(0.825, 2);
    expect(model.pDraw).toBeCloseTo(0.142, 2);
    expect(model.pHome).toBeCloseTo(0.033, 2);
    expect(model.pOver2_5).toBeCloseTo(0.506, 2);
  });

  it("shifts home win probability upward with home-field advantage Elo", () => {
    const neutral = computeMatchModel(1800, 1800, 0);
    const withHfa = computeMatchModel(1800, 1800, 42);
    expect(withHfa.pHome).toBeGreaterThan(neutral.pHome);
    expect(withHfa.pAway).toBeLessThan(neutral.pAway);
  });

  it("samples 90-minute scores from the Dixon-Coles grid with one uniform", () => {
    const matrix = scoreMatrix(1.35, 1.35);
    expect(sampleScoreFromMatrix(matrix, () => 0)).toEqual([0, 0]);
    let calls = 0;
    const score = simulateMatch(1.35, 1.35, false, () => {
      calls += 1;
      return 0;
    });
    expect(score).toEqual([0, 0]);
    expect(calls).toBe(1);
    expect(simulateMatch(1.35, 1.35, false, () => 0.999999999)[0]).toBeLessThanOrEqual(MAX_GOALS);
    expect(sampleScoreFromMatrix(matrix, () => 1)).toEqual([MAX_GOALS, MAX_GOALS]);
  });

  it("keeps knockout extra time on a Dixon-Coles extra-time grid before penalties", () => {
    const draws = [0, 0, 0.6];
    let index = 0;
    const [home, away] = simulateMatch(1.35, 1.35, true, () => draws[index++] ?? 0);
    expect(index).toBe(3);
    expect(home).not.toBe(away);
    expect(home + away).toBeGreaterThan(0);
  });
});
