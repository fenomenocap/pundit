import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveActiveScoreModel, type ActiveScoreModelInput } from "./active-score-model";
import { matrixTo1x2, matrixToBtts, matrixToTotals } from "./dixon-coles";
import * as artifacts from "./epl-goal-calibration-artifact";
import { ONE_X_TWO_TEMPERATURE, oneXTwoTemperatureEnabled, scaleOneXTwoProbabilities } from "./one-x-two-temperature";

const now = new Date("2026-10-23T00:00:00Z");
const fixture: ActiveScoreModelInput = { home: "Arsenal", away: "Everton", competitionId: "eng.1",
  homeStrength: 2048, awayStrength: 1816, homeAdvantageElo: 42, kickoff: "2026-10-25T12:00:00Z" };
function validated() {
  const ref = { path: "reviewed/evidence.json", sha256: "a".repeat(64) };
  const artifact: artifacts.EplGoalCalibrationArtifact = { schemaVersion: 1,
    methodId: artifacts.EPL_GOAL_CALIBRATION_METHOD_ID, competitionId: "eng.1",
    fit: { methodId: "shrunk-event-rate-elo-allocation-v1", origin: artifacts.EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN,
      options: { decayDays: 180, teamPrecision: 100 }, intercept: Math.log(2.7), teamEffects: { Arsenal: 0.02, Everton: -0.03 },
      allocationSlope: 0.62, homeOffset: 0.21, rho: -0.11, trainingCount: 120, allocationTrainingCount: 40,
      trainingThrough: "2026-10-21T00:00:00Z", trainingSha256: "b".repeat(64), converged: true, gradientNorm: 1e-8 },
    review: { experimentId: "outcome-anchored-goal-rates-v2", source: [ref], training: [ref], evaluation: [ref] } };
  const raw = JSON.stringify(artifact);
  return artifacts.validateEplGoalCalibrationArtifact(raw, createHash("sha256").update(raw).digest("hex"), now);
}

describe("1X2 temperature flag", () => {
  it("is OFF unless the env flag is exactly 'true'", () => {
    expect(oneXTwoTemperatureEnabled({})).toBe(false);
    for (const value of ["", "1", "TRUE", "yes", "false", " true"]) {
      expect(oneXTwoTemperatureEnabled({ ONE_X_TWO_TEMPERATURE_ENABLED: value })).toBe(false);
    }
    expect(oneXTwoTemperatureEnabled({ ONE_X_TWO_TEMPERATURE_ENABLED: "true" })).toBe(true);
  });

  it("OFF leaves the resolved model byte-identical to the default path", () => {
    const artifact = validated();
    expect(resolveActiveScoreModel(fixture, artifact, now, { oneXTwoTemperature: false }))
      .toEqual(resolveActiveScoreModel(fixture, artifact, now));
  });

  it("ON publishes the tempered 1X2 and keeps every market coherent with one grid", () => {
    const artifact = validated();
    const off = resolveActiveScoreModel(fixture, artifact, now, { oneXTwoTemperature: false });
    const on = resolveActiveScoreModel(fixture, artifact, now, { oneXTwoTemperature: true });
    const expected = scaleOneXTwoProbabilities([off.pHome, off.pDraw, off.pAway], ONE_X_TWO_TEMPERATURE);
    expect(on.pHome).toBeCloseTo(expected[0], 12);
    expect(on.pDraw).toBeCloseTo(expected[1], 12);
    expect(on.pAway).toBeCloseTo(expected[2], 12);
    expect(on.pHome).toBeLessThan(off.pHome);
    const grid1x2 = matrixTo1x2(on.matrix);
    expect(grid1x2[0]).toBeCloseTo(on.pHome, 12);
    expect(matrixToTotals(on.matrix, 2.5)[0]).toBeCloseTo(on.pOver2_5, 12);
    expect(matrixToBtts(on.matrix)[0]).toBeCloseTo(on.pBttsYes, 12);
  });

  it("does not apply outside the EPL", () => {
    const ucl = { ...fixture, competitionId: "uefa.champions_qual", homeAdvantageElo: 42 };
    expect(resolveActiveScoreModel(ucl, null, now, { oneXTwoTemperature: true }))
      .toEqual(resolveActiveScoreModel(ucl, null, now, { oneXTwoTemperature: false }));
  });
});
