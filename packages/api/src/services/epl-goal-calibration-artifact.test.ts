import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidatedEplGoalCalibrationArtifact, EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN,
  EPL_GOAL_CALIBRATION_METHOD_ID, getEplGoalCalibrationReadiness, loadEplGoalCalibrationArtifact,
  validateEplGoalCalibrationArtifact, type EplGoalCalibrationArtifact,
  type ValidatedEplGoalCalibrationArtifact } from "./epl-goal-calibration-artifact";

const now = new Date("2026-10-08T00:00:00Z");
function artifact(): EplGoalCalibrationArtifact {
  const ref = { path: "reviewed/evidence.json", sha256: "a".repeat(64) };
  return { schemaVersion: 1, methodId: EPL_GOAL_CALIBRATION_METHOD_ID, competitionId: "eng.1",
    fit: { methodId: "shrunk-event-rate-elo-allocation-v1", origin: EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN,
      options: { decayDays: 180, teamPrecision: 100 }, intercept: Math.log(3.1),
      teamEffects: { Arsenal: 0.02, Leeds: -0.03, "Man United": 0.04 }, allocationSlope: 1.1,
      homeOffset: 0.25, rho: -0.1, trainingCount: 120, allocationTrainingCount: 40,
      trainingThrough: "2026-10-06T00:00:00Z", trainingSha256: "b".repeat(64), converged: true, gradientNorm: 1e-8 },
    review: { experimentId: "outcome-anchored-goal-rates-v2", source: [ref], training: [ref], evaluation: [ref] } };
}
function bytes(value: EplGoalCalibrationArtifact | string) {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return { raw, sha: createHash("sha256").update(raw).digest("hex") };
}
function validate(value = artifact(), clock = now) {
  const { raw, sha } = bytes(value);
  return validateEplGoalCalibrationArtifact(raw, sha, clock);
}

describe("reviewed EPL goal calibration artifact", () => {
  it("validates raw bytes and exposes a content-addressed immutable artifact", () => {
    const value = artifact();
    const { raw, sha } = bytes(value);
    const validated = validateEplGoalCalibrationArtifact(Buffer.from(raw), sha, now);
    expect(validated.artifactId).toBe(`${EPL_GOAL_CALIBRATION_METHOD_ID}:${sha}`);
    expect(validated.artifactSha256).toBe(sha);
    expect(validated.ageDays).toBe(1);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.artifact.fit.teamEffects)).toBe(true);
    expect(Object.isFrozen(validated.artifact.fit.options)).toBe(true);
    expect(Object.isFrozen(validated.artifact.review.source[0])).toBe(true);
    expect(() => { validated.artifact.fit.intercept = 99; }).toThrow();
    expect(value.fit.intercept).toBe(Math.log(3.1));
    expect(() => assertValidatedEplGoalCalibrationArtifact(validated, now)).not.toThrow();
    expect(() => assertValidatedEplGoalCalibrationArtifact({ ...validated }, now)).toThrow(/validated/);
  });

  it("hashes the raw file rather than a reparsed JSON payload", () => {
    const { raw, sha } = bytes(artifact());
    expect(() => validateEplGoalCalibrationArtifact(`${raw}\n`, sha, now)).toThrow(/hash mismatch/);
    expect(() => validateEplGoalCalibrationArtifact(raw, "A".repeat(64), now)).toThrow(/pinned/);
    const invalid = bytes("{broken");
    expect(() => validateEplGoalCalibrationArtifact(invalid.raw, invalid.sha, now)).toThrow(/JSON/);
  });

  it("accepts both declared rho boundaries and the convergence threshold", () => {
    for (const rho of [-0.2, 0.15]) {
      const value = artifact(); value.fit.rho = rho; value.fit.gradientNorm = 1e-7;
      expect(validate(value).artifact.fit.rho).toBe(rho);
    }
  });

  it("checks future and 30-day freshness on validation and every subsequent use", () => {
    const validated = validate();
    expect(() => validate(artifact(), new Date("2026-10-06T23:59:59Z"))).toThrow(/future/);
    expect(() => validate(artifact(), new Date("2026-11-06T00:00:00Z"))).not.toThrow();
    expect(() => validate(artifact(), new Date("2026-11-06T00:00:00.001Z"))).toThrow(/30 days/);
    expect(() => assertValidatedEplGoalCalibrationArtifact(validated, new Date("2026-11-06T00:00:00.001Z"))).toThrow(/30 days/);
    expect(() => validate(artifact(), new Date(NaN))).toThrow(/future/);
  });

  it("accepts explicit UTC minute precision for origin and historical training through", () => {
    const value = artifact();
    value.fit.origin = "2026-10-07T00:00Z";
    value.fit.trainingThrough = "2026-09-20T15:30Z";
    expect(validate(value).origin).toBe("2026-10-07T00:00Z");
  });

  it.each([
    (a: EplGoalCalibrationArtifact) => { a.schemaVersion = 2 as 1; },
    (a: EplGoalCalibrationArtifact) => { a.methodId = "other" as typeof EPL_GOAL_CALIBRATION_METHOD_ID; },
    (a: EplGoalCalibrationArtifact) => { a.competitionId = "uefa.champions_qual" as "eng.1"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.methodId = "other" as typeof a.fit.methodId; },
    (a: EplGoalCalibrationArtifact) => { a.fit.origin = "2026-02-30T00:00:00Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.origin = "2026-10-07T24:00:00Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.origin = "2026-10-08T00:00:00Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.origin = "2026-10-07"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.converged = false; },
    (a: EplGoalCalibrationArtifact) => { a.fit.gradientNorm = -1; },
    (a: EplGoalCalibrationArtifact) => { a.fit.gradientNorm = 1e-6; },
    (a: EplGoalCalibrationArtifact) => { a.fit.gradientNorm = NaN; },
    (a: EplGoalCalibrationArtifact) => { a.fit.intercept = Infinity; },
    (a: EplGoalCalibrationArtifact) => { a.fit.intercept = 999; },
    (a: EplGoalCalibrationArtifact) => { a.fit.intercept = Math.log(1.4); },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects.Arsenal = 10; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects.Arsenal = -10; },
    (a: EplGoalCalibrationArtifact) => { a.fit.allocationSlope = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.allocationSlope = -1; },
    (a: EplGoalCalibrationArtifact) => { a.fit.allocationSlope = 1e100; },
    (a: EplGoalCalibrationArtifact) => { a.fit.homeOffset = NaN; },
    (a: EplGoalCalibrationArtifact) => { a.fit.homeOffset = 1e100; },
    (a: EplGoalCalibrationArtifact) => { a.fit.homeOffset = -1e100; },
    (a: EplGoalCalibrationArtifact) => { a.fit.rho = -0.201; },
    (a: EplGoalCalibrationArtifact) => { a.fit.rho = 0.151; },
    (a: EplGoalCalibrationArtifact) => { a.fit.options.decayDays = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.options.teamPrecision = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.options.teamPrecision = 99; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingCount = 99; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingCount = 120.5; },
    (a: EplGoalCalibrationArtifact) => { a.fit.allocationTrainingCount = 29; },
    (a: EplGoalCalibrationArtifact) => { a.fit.allocationTrainingCount = 121; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-10-06T00:00:00.001Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-09-31T00:00:00Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-02-30T15:30Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-09-20T15:30:60Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-09-20T24:00Z"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-09-20T15:30"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingThrough = "2026-09-20T15:30+00:00"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.trainingSha256 = "not-a-hash"; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects = {}; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects.Arsenal = NaN; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects["Manchester United"] = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects[" Arsenal"] = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects["New  Club"] = 0; },
    (a: EplGoalCalibrationArtifact) => { a.fit.teamEffects.ARSENAL = 0; },
    (a: EplGoalCalibrationArtifact) => { a.review.experimentId = "other" as typeof a.review.experimentId; },
    (a: EplGoalCalibrationArtifact) => { a.review.source = []; },
    (a: EplGoalCalibrationArtifact) => { a.review.training[0].sha256 = "x".repeat(64); },
    (a: EplGoalCalibrationArtifact) => { a.review.evaluation[0].path = "../unreviewed.json"; },
  ])("rejects malformed provenance or fit case %#", mutate => {
    const value = artifact(); mutate(value);
    expect(() => validate(value)).toThrow();
  });

  it("caches reviewed file bytes but still expires the cached fit and reports load errors", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "pundit-goal-artifact-"));
    try {
      const { raw, sha } = bytes(artifact());
      const filePath = path.join(folder, `${sha}.json`);
      writeFileSync(filePath, raw);
      const options = { filePath, expectedSha256: sha, now };
      expect(loadEplGoalCalibrationArtifact(options).artifactSha256).toBe(sha);
      rmSync(filePath);
      expect(loadEplGoalCalibrationArtifact(options).artifactSha256).toBe(sha);
      expect(getEplGoalCalibrationReadiness(options).ready).toBe(true);
      const expired = getEplGoalCalibrationReadiness({ ...options, now: new Date("2026-11-07T00:00:00Z") });
      expect(expired.ready).toBe(false); expect(expired.error).toMatch(/30 days/);
      const missing = getEplGoalCalibrationReadiness({ ...options, filePath: path.join(folder, "missing.json") });
      expect(missing.ready).toBe(false); expect(missing.error).toMatch(/unavailable/);
      writeFileSync(filePath, `${raw}\n`);
      expect(getEplGoalCalibrationReadiness({ ...options, expectedSha256: "c".repeat(64) }).error).toMatch(/hash mismatch/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it("rejects an unbranded typed-looking artifact", () => {
    expect(() => assertValidatedEplGoalCalibrationArtifact({ artifact: artifact() } as ValidatedEplGoalCalibrationArtifact, now)).toThrow(/validated/);
  });
});
