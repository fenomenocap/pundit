import { describe, expect, it } from "vitest";
import { matrixTo1x2, matrixToBtts, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { anchorScoreGridTo1x2 } from "./outcome-anchored-score-grid";

const target = [0.6, 0.25, 0.15] as const;
const source = [[0.2, 0.1], [0.4, 0.3]];

function checkGrid(matrix: number[][], expected: readonly number[]): void {
  expect(matrix.every(row => row.every(value => Number.isFinite(value) && value >= 0))).toBe(true);
  expect(Math.abs(matrix.flat().reduce((sum, value) => sum + value, 0) - 1)).toBeLessThanOrEqual(1e-12);
  matrixTo1x2(matrix).forEach((value, index) => {
    expect(Math.abs(value - expected[index])).toBeLessThanOrEqual(1e-12);
  });
}

describe("outcome-anchored score grid", () => {
  it("uses home rows and away columns and preserves conditional score ratios", () => {
    const result = anchorScoreGridTo1x2(source, target);
    checkGrid(result.matrix, target);
    expect(result.matrix[1][0]).toBeCloseTo(0.6, 15);
    expect(result.matrix[0][1]).toBeCloseTo(0.15, 15);
    expect(result.matrix[0][0]).toBeCloseTo(0.1, 15);
    expect(result.matrix[1][1]).toBeCloseTo(0.15, 15);
    expect(result.matrix[0][0] / result.matrix[1][1]).toBeCloseTo(2 / 3, 15);
  });

  it("derives expected goals from anchored probabilities, not unanchored shape means", () => {
    const result = anchorScoreGridTo1x2(source, target);
    expect(result.expectedHomeGoals).toBeCloseTo(0.75, 15);
    expect(result.expectedAwayGoals).toBeCloseTo(0.3, 15);
    expect(result.expectedHomeGoals).not.toBeCloseTo(0.7, 12);
    expect(result.expectedAwayGoals).not.toBeCloseTo(0.4, 12);
  });

  it("preserves the full tail, totals and BTTS as one coherent grid", () => {
    const original = scoreMatrix(2.8, 1.2, -0.05, 30);
    const result = anchorScoreGridTo1x2(original, target);
    checkGrid(result.matrix, target);
    expect(result.matrix).toHaveLength(31);
    expect(result.matrix[30][29]).toBeGreaterThan(0);
    expect(result.matrix[29][30]).toBeGreaterThan(0);
    expect(result.matrix[30][30]).toBeGreaterThan(0);
    const ratios = target.map((value, index) => value / matrixTo1x2(original)[index]);
    expect(result.matrix[30][29] / original[30][29]).toBeCloseTo(ratios[0], 12);
    expect(result.matrix[29][30] / original[29][30]).toBeCloseTo(ratios[2], 12);
    expect(result.matrix[30][30] / original[30][30]).toBeCloseTo(ratios[1], 12);
    const over = result.matrix.flatMap((row, home) => row.filter((_, away) => home + away > 2.5)).reduce((sum, value) => sum + value, 0);
    const btts = result.matrix.slice(1).flatMap(row => row.slice(1)).reduce((sum, value) => sum + value, 0);
    expect(matrixToTotals(result.matrix, 2.5)[0]).toBeCloseTo(over, 14);
    expect(matrixToBtts(result.matrix)[0]).toBeCloseTo(btts, 14);
    const homeMean = result.matrix.reduce((sum, row, home) => sum + home * row.reduce((rowSum, value) => rowSum + value, 0), 0);
    const awayMean = result.matrix.reduce((sum, row) => sum + row.reduce((rowSum, value, away) => rowSum + away * value, 0), 0);
    expect(result.expectedHomeGoals).toBeCloseTo(homeMean, 13);
    expect(result.expectedAwayGoals).toBeCloseTo(awayMean, 13);
    expect(result.expectedHomeGoals).not.toBeCloseTo(2.8, 3);
  });

  it("keeps identity targets unchanged within floating precision and returns a fresh grid", () => {
    const original = scoreMatrix(1.7, 0.8);
    const before = structuredClone(original);
    const desired = matrixTo1x2(original);
    const result = anchorScoreGridTo1x2(original, desired);
    checkGrid(result.matrix, desired);
    result.matrix.forEach((row, home) => row.forEach((value, away) => expect(value).toBeCloseTo(before[home][away], 15)));
    expect(original).toEqual(before);
    expect(result.matrix).not.toBe(original);
    expect(result.matrix[0]).not.toBe(original[0]);
  });

  it("accepts frozen inputs and does not mutate target or cells", () => {
    const frozen = Object.freeze(source.map(row => Object.freeze([...row])));
    const desired = Object.freeze([...target]) as readonly [number, number, number];
    anchorScoreGridTo1x2(frozen, desired);
    expect(frozen).toEqual(source);
    expect(desired).toEqual(target);
  });

  it("handles tiny positive original outcome masses without scaling-factor overflow", () => {
    const tiny = [[1, 1e-320], [1e-320, 0]];
    const result = anchorScoreGridTo1x2(tiny, target);
    checkGrid(result.matrix, target);
    expect(result.matrix[1][0]).toBeCloseTo(0.6, 15);
    expect(result.matrix[0][1]).toBeCloseTo(0.15, 15);
  });

  it("retains subnormal target mass even when per-cell products underflow", () => {
    const original = [[0.25, 0.1, 0.1], [0.1, 0.15, 0.1], [0.1, 0.1, 0]];
    const desired = [Number.MIN_VALUE, 0.5, 0.5] as const;
    const result = anchorScoreGridTo1x2(original, desired);
    checkGrid(result.matrix, desired);
    expect(matrixTo1x2(result.matrix)[0]).toBe(Number.MIN_VALUE);
  });

  it("supports strongly asymmetric square shapes without swapping home and away", () => {
    const result = anchorScoreGridTo1x2(scoreMatrix(0.2, 4.8, 0, 20), [0.8, 0.1, 0.1]);
    checkGrid(result.matrix, [0.8, 0.1, 0.1]);
    expect(result.expectedHomeGoals).toBeGreaterThan(0.2);
  });

  it.each([
    [], [[1]], [[0.5, 0.5]], [[0.2, 0.1], [0.4]],
    [[0.2, 0.1], [0.4, 0.2]], [[0.2, 0.1], [0.4, -0.1]],
    [[0.2, NaN], [0.4, 0.3]], [[0.2, Infinity], [0.4, 0.3]],
    [[0.5, 0], [0, 0.5]], [[0.5, 0.5], [0, 0]], [[0.5, 0], [0.5, 0]],
    [[0, 0.5], [0.5, 0]],
  ].map(matrix => ({ matrix })))("rejects invalid or zero-outcome grid %#", ({ matrix }) => {
    expect(() => anchorScoreGridTo1x2(matrix, target)).toThrow(RangeError);
  });

  it.each([
    [0, 0.5, 0.5], [-0.1, 0.6, 0.5], [NaN, 0.5, 0.5],
    [Infinity, 0.5, 0.5], [0.6, 0.3, 0.2], [0.3, 0.3], [0.3, 0.3, 0.2, 0.2],
  ].map(desired => ({ desired })))("rejects invalid target %#", ({ desired }) => {
    expect(() => anchorScoreGridTo1x2(source, desired as [number, number, number])).toThrow(RangeError);
  });
});
