import { describe, expect, it } from "vitest";
import { buildClubStrengthArtifact } from "./club-strength-artifact";
import { exposedSealsForTraining } from "./exposed-seal-training";

const eng = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Club${i}`, 1500 + i]));
const uefa = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Club${i}`, 1500 + i]));
const artifact = buildClubStrengthArtifact({ snapshotAt: "2026-09-01T00:00:00Z",
  byProfile: { world: uefa, "eng-clubs": eng, "uefa-clubs": uefa } });
const seal = { schemaVersion: 2, provenanceCompleteness: "complete", competitionId: "eng.1", fixtureId: 1,
  utcDate: "2026-09-10T15:00:00Z", forecastAt: "2026-09-10T13:30:00Z", home: "Club0", away: "Club1",
  checkpointPolicyId: "pre-kickoff-90m-v1", checkpointReason: "scheduled_window",
  inputs: { ratingProfile: "eng-clubs", homeRating: 1500, awayRating: 1501,
    ratingSnapshotAt: artifact.payload.snapshotAt, ratingArtifactId: artifact.artifactId, ratingArtifactSha256: artifact.payloadSha256 },
  result: { homeScore: 2, awayScore: 1 } };
const artifacts = new Map([[artifact.payloadSha256, artifact]]);

describe("exposed official seal training refresh", () => {
  it("uses exact verified historical ratings and labels exposed/incomplete-season training", () => {
    const joined = exposedSealsForTraining([seal], artifacts, "2026-10-05T00:00:00Z");
    expect(joined.rows).toHaveLength(1);
    expect(joined.rows[0].rankingDate).toBe("2026-09-01");
    expect(joined.exposedDevelopment).toBe(true);
    expect(joined.independentBlindTest).toBe(false);
    expect(joined.completeSeasonCoverage).toBe(false);
  });
  it("verifies the public one-decimal serialization and recovers artifact precision", () => {
    const precise = buildClubStrengthArtifact({ snapshotAt: artifact.payload.snapshotAt,
      byProfile: { world: uefa, "eng-clubs": { ...eng, Club0: 1500.75805664, Club1: 1501.4777832 }, "uefa-clubs": uefa } });
    const roundedSeal = { ...seal, inputs: { ...seal.inputs, homeRating: 1500.8, awayRating: 1501.5,
      ratingArtifactId: precise.artifactId, ratingArtifactSha256: precise.payloadSha256 } };
    const store = new Map([[precise.payloadSha256, precise]]);
    const joined = exposedSealsForTraining([roundedSeal], store, "2026-10-05T00:00:00Z");
    expect(joined.rows[0].homeElo).toBe(1500.75805664);
    expect(joined.rows[0].awayElo).toBe(1501.4777832);
    expect(joined.ratingPrecisionPolicy).toBe("verify-sealed-one-decimal-recover-hash-bound-full-precision");
    for (const homeRating of [1500.7, 1500.75805664, 1500.80000001]) {
      const rejected = exposedSealsForTraining([{ ...roundedSeal, inputs: { ...roundedSeal.inputs, homeRating } }], store, "2026-10-05T00:00:00Z");
      expect(rejected.rows).toHaveLength(0);
      expect(rejected.excluded[0].reason).toBe("rating-provenance-mismatch");
    }
  });
  it.each([
    { inputs: { ...seal.inputs, homeRating: 1502 } },
    { inputs: { ...seal.inputs, ratingSnapshotAt: "2026-09-10T00:00:00Z" } },
    { inputs: { ...seal.inputs, ratingArtifactSha256: "0".repeat(64) } },
    { result: { homeScore: -1, awayScore: 1 } },
    { result: { homeScore: 2, awayScore: 0.5 } },
    { forecastAt: "2026-09-10T15:01:00Z" }, { provenanceCompleteness: "legacy_partial" },
  ])("retains rejection reason/denominator for invalid record: %j", (change) => {
    const joined = exposedSealsForTraining([{ ...seal, ...change }], artifacts, "2026-10-05T00:00:00Z");
    expect(joined.rows).toHaveLength(0); expect(joined.excluded).toHaveLength(1);
    expect(joined.attemptedPlSeals).toBe(1);
  });
  it("does not accept a result before the conservative availability lag", () => {
    expect(exposedSealsForTraining([seal], artifacts, "2026-09-10T17:00:00Z").excluded[0].reason).toBe("result-not-yet-available");
  });
  it("retains duplicate exclusions", () => {
    const joined = exposedSealsForTraining([seal, seal], artifacts, "2026-10-05T00:00:00Z");
    expect(joined.rows).toHaveLength(1); expect(joined.excluded[0].reason).toBe("duplicate-fixture");
    expect(joined.attemptedPlSeals).toBe(2);
  });
  it("rejects a tampered rating artifact even if its declared ID matches", () => {
    const broken = { ...artifact, payload: { ...artifact.payload,
      byProfile: { ...artifact.payload.byProfile, "eng-clubs": { ...eng, Club0: 1502 } } } };
    expect(exposedSealsForTraining([seal], new Map([[artifact.payloadSha256, broken]]), "2026-10-05T00:00:00Z").excluded[0].reason)
      .toBe("invalid-rating-artifact");
  });
});
