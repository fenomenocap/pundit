import { describe, expect, it } from "vitest";
import {
  BASE_GOALS,
  LAMBDA_CAP,
  RHO,
  dixonColesTau,
  eloToLambdas,
  matrixTo1x2,
  matrixToBtts,
  matrixToCorrectScores,
  matrixToTotals,
  scoreMatrix,
} from "./dixon-coles";

describe("local Dixon-Coles model", () => {
  it("preserves the calibrated Elo-to-goal constants and cap", () => {
    expect(eloToLambdas(1800, 1800)).toEqual([BASE_GOALS, BASE_GOALS]);
    const [stronger, weaker] = eloToLambdas(3000, 1000);
    expect(stronger).toBe(LAMBDA_CAP);
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

  it("matches the Python source for a representative Elo pair", () => {
    const matrix = scoreMatrix(...eloToLambdas(2050, 1750));
    const [home, draw, away] = matrixTo1x2(matrix);
    expect(home).toBeCloseTo(0.8700927852674243, 12);
    expect(draw).toBeCloseTo(0.09694632518374494, 12);
    expect(away).toBeCloseTo(0.032960889548830696, 12);
  });
});
