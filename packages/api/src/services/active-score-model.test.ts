import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getResolvedActiveScoreModel, resolveActiveScoreModel, type ActiveScoreModelInput } from "./active-score-model";
import { computeMatchModel, matrixTo1x2, matrixToBtts, matrixToCorrectScores, matrixToScorelines, matrixToTotals } from "./dixon-coles";
import * as artifacts from "./epl-goal-calibration-artifact";
import { historicalGoalLambdas } from "./historical-goal-calibration";

const now = new Date("2026-10-08T00:00:00Z");
const fixture: ActiveScoreModelInput = { home: "Arsenal", away: "Leeds", competitionId: "eng.1",
  homeStrength: 1935.123456, awayStrength: 1650.654321, homeAdvantageElo: 42, kickoff: "2026-10-10T12:00:00Z" };
function validated() {
  const ref = { path: "reviewed/evidence.json", sha256: "a".repeat(64) };
  const artifact: artifacts.EplGoalCalibrationArtifact = { schemaVersion: 1,
    methodId: artifacts.EPL_GOAL_CALIBRATION_METHOD_ID, competitionId: "eng.1",
    fit: { methodId: "shrunk-event-rate-elo-allocation-v1", origin: artifacts.EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN,
      options: { decayDays: 180, teamPrecision: 100 }, intercept: Math.log(3.1), teamEffects: { Arsenal: 0.08, Leeds: -0.02 },
      allocationSlope: 1.1, homeOffset: 0.25, rho: -0.1, trainingCount: 120, allocationTrainingCount: 40,
      trainingThrough: "2026-10-06T00:00:00Z", trainingSha256: "b".repeat(64), converged: true, gradientNorm: 1e-8 },
    review: { experimentId: "outcome-anchored-goal-rates-v2", source: [ref], training: [ref], evaluation: [ref] } };
  const raw = JSON.stringify(artifact);
  return artifacts.validateEplGoalCalibrationArtifact(raw, createHash("sha256").update(raw).digest("hex"), now);
}
afterEach(() => vi.restoreAllMocks());

describe("active score model resolver", () => {
  it("anchors the EPL calibrated shape to exact-rating champion 1X2 and derives every output from one grid", () => {
    const artifact = validated();
    const result = resolveActiveScoreModel(fixture, artifact, now);
    const baseline = computeMatchModel(fixture.homeStrength, fixture.awayStrength, fixture.homeAdvantageElo);
    expect(result.method).toBe("calibrated");
    expect(result.methodId).toBe(artifacts.EPL_GOAL_CALIBRATION_METHOD_ID);
    expect(result.artifactId).toBe(artifact.artifactId);
    expect(result.artifactSha256).toBe(artifact.artifactSha256);
    expect(result.unknownTeamEffects).toEqual([]);
    for (const field of ["pHome", "pDraw", "pAway"] as const) {
      expect(Math.abs(result[field] - baseline[field])).toBeLessThanOrEqual(1e-12);
    }
    expect(result.pOver2_5).not.toBeCloseTo(baseline.pOver2_5, 3);
    expect([result.pHome, result.pDraw, result.pAway]).toEqual(matrixTo1x2(result.matrix));
    expect([result.pOver2_5, result.pUnder2_5]).toEqual(matrixToTotals(result.matrix, 2.5));
    expect([result.pBttsYes, result.pBttsNo]).toEqual(matrixToBtts(result.matrix));
    expect(result.topScores).toEqual(matrixToCorrectScores(result.matrix, 5));
    expect(result.scorelines).toEqual(matrixToScorelines(result.matrix));
    let homeMean = 0, awayMean = 0;
    result.matrix.forEach((row, home) => row.forEach((probability, away) => { homeMean += home * probability; awayMean += away * probability; }));
    expect(result.expectedHomeGoals).toBe(homeMean);
    expect(result.expectedAwayGoals).toBe(awayMean);
    const [rawHome, rawAway] = historicalGoalLambdas(artifact.artifact.fit, { homeCanonicalName: fixture.home,
      awayCanonicalName: fixture.away, homeElo: fixture.homeStrength, awayElo: fixture.awayStrength });
    expect(Math.abs(result.expectedHomeGoals - rawHome) + Math.abs(result.expectedAwayGoals - rawAway)).toBeGreaterThan(1e-3);
    expect(result.matrix.every(row => row.every(p => Number.isFinite(p) && p >= 0))).toBe(true);
  });

  it("does not round the exact Elo source inputs before anchoring", () => {
    const artifact = validated();
    const exact = resolveActiveScoreModel(fixture, artifact, now);
    const rounded = resolveActiveScoreModel({ ...fixture, homeStrength: Math.round(fixture.homeStrength), awayStrength: Math.round(fixture.awayStrength) }, artifact, now);
    expect(exact.pHome).not.toBe(rounded.pHome);
  });

  it("accepts ESPN minute-precision kickoffs with the same finite calibrated output", () => {
    const artifact = validated();
    expect(resolveActiveScoreModel({ ...fixture, kickoff: "2026-10-10T12:00Z" }, artifact, now))
      .toEqual(resolveActiveScoreModel(fixture, artifact, now));
  });

  it("exposes zero-effect extrapolation for an unknown canonical club and resolves known aliases", () => {
    const artifact = validated();
    const unknown = resolveActiveScoreModel({ ...fixture, home: "New Club" }, artifact, now);
    expect(unknown.unknownTeamEffects).toEqual(["New Club"]);
    const alias = resolveActiveScoreModel({ ...fixture, home: "Manchester United" }, artifact, now);
    const canonical = resolveActiveScoreModel({ ...fixture, home: "Man United" }, artifact, now);
    expect(alias.matrix).toEqual(canonical.matrix);
    expect(alias.unknownTeamEffects).toEqual(["Man United"]);
  });

  it.each([
    { changes: { competitionId: "uefa.champions_qual" }, status: "baseline-competition" },
    { changes: { homeAdvantageElo: 0 }, status: "baseline-neutral" },
    { changes: { kickoff: "2026-09-20T12:00:00Z" }, status: "baseline-before-calibration-origin" },
  ])("preserves a tagged baseline for $status without reading an artifact", ({ changes, status }) => {
    const input = { ...fixture, ...changes };
    const spy = vi.spyOn(artifacts, "loadEplGoalCalibrationArtifact");
    const result = getResolvedActiveScoreModel(input, now);
    const baseline = computeMatchModel(input.homeStrength, input.awayStrength, input.homeAdvantageElo);
    expect(result.method).toBe("baseline"); expect(result.calibrationStatus).toBe(status);
    expect(result.artifactId).toBeNull(); expect(result.artifactSha256).toBeNull();
    expect(result.pHome).toBe(baseline.pHome); expect(result.pOver2_5).toBe(baseline.pOver2_5);
    expect(result.pBttsYes).toBe(baseline.pBttsYes); expect(result.topScores).toEqual(baseline.topScores);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails closed for missing, unvalidated, future and expired EPL artifacts", () => {
    expect(() => resolveActiveScoreModel(fixture, null, now)).toThrow(/fallback is disabled/);
    const artifact = validated();
    expect(() => resolveActiveScoreModel(fixture, { ...artifact }, now)).toThrow(/validated/);
    expect(() => resolveActiveScoreModel(fixture, artifact, new Date("2026-10-06T23:59:59Z"))).toThrow(/future/);
    expect(() => resolveActiveScoreModel(fixture, artifact, new Date("2026-11-07T00:00:00Z"))).toThrow(/30 days/);
    vi.spyOn(artifacts, "loadEplGoalCalibrationArtifact").mockImplementation(() => { throw new Error("controlled missing reviewed artifact"); });
    expect(() => getResolvedActiveScoreModel(fixture, now)).toThrow(/controlled missing/);
  });

  it("the convenience path forwards the clock and same reviewed artifact to the resolver", () => {
    const artifact = validated();
    const spy = vi.spyOn(artifacts, "loadEplGoalCalibrationArtifact").mockReturnValue(artifact);
    expect(getResolvedActiveScoreModel(fixture, now)).toEqual(resolveActiveScoreModel(fixture, artifact, now));
    expect(spy).toHaveBeenCalledWith({ now });
  });

  it.each([
    { home: "" }, { home: " Arsenal" }, { home: "constructor" }, { home: "Arsenal<script>" },
    { away: "Arsenal" }, { away: "ARSENAL" }, { homeStrength: NaN }, { awayStrength: Infinity },
    { homeStrength: 499 }, { awayStrength: 3001 }, { homeAdvantageElo: 1 }, { competitionId: "unknown" },
    { competitionId: "fifa.world" }, { kickoff: "2026-10-32T12:00:00Z" }, { kickoff: "2026-10-10" },
  ])("rejects invalid fixture/source inputs %#", changes => {
    expect(() => resolveActiveScoreModel({ ...fixture, ...changes }, validated(), now)).toThrow();
  });

  it("rejects invalid request clocks even on a baseline path", () => {
    expect(() => resolveActiveScoreModel({ ...fixture, homeAdvantageElo: 0 }, null, new Date(NaN))).toThrow(/Invalid active/);
  });
});
