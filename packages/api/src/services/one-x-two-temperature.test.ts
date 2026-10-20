import { describe, expect, it } from "vitest";
import {
  ONE_X_TWO_TEMPERATURE,
  ONE_X_TWO_TEMPERATURE_ENABLED,
  scaleOneXTwoProbabilities,
} from "./one-x-two-temperature";

describe("one-x-two temperature scaling", () => {
  it("ships disabled by default", () => {
    expect(ONE_X_TWO_TEMPERATURE_ENABLED).toBe(false);
    expect(ONE_X_TWO_TEMPERATURE).toBe(1.286);
  });

  it("is identity at temperature 1 for a normalized triple", () => {
    const input: [number, number, number] = [0.52, 0.24, 0.24];
    expect(scaleOneXTwoProbabilities(input, 1)).toEqual(input);
  });

  it("softens an overconfident favourite at T > 1", () => {
    const input: [number, number, number] = [0.72, 0.16, 0.12];
    const [home, draw, away] = scaleOneXTwoProbabilities(input, ONE_X_TWO_TEMPERATURE);
    expect(home).toBeLessThan(input[0]);
    expect(draw).toBeGreaterThan(input[1]);
    expect(away).toBeGreaterThan(input[2]);
    expect(home + draw + away).toBeCloseTo(1, 12);
  });
});
