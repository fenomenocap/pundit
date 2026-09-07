import { describe, expect, it } from "vitest";
import { getRepoDataDir } from "./persistent-store";
import {
  readSelectedClubStrengthArtifact,
  selectedClubStrengthArtifactPath,
} from "./club-strength-artifact";
import {
  CLUB_STRENGTH_CUTOVER_ARTIFACT_FILE,
  readClubStrengthCutoverArtifact,
  readClubStrengthGolden,
  verifyClubStrengthCutover,
} from "./club-strength-cutover";

describe("club-strength artifact cutover golden", () => {
  it("preserves all public model fields for the 18 pre-cutover fixtures", () => {
    const dataDir = getRepoDataDir();
    const artifact = readClubStrengthCutoverArtifact(dataDir);
    const golden = readClubStrengthGolden(dataDir);
    expect(() => verifyClubStrengthCutover(artifact, golden)).not.toThrow();
  });

  it("detects a changed probability or rating", () => {
    const dataDir = getRepoDataDir();
    const artifact = readClubStrengthCutoverArtifact(dataDir);
    const golden = readClubStrengthGolden(dataDir);
    golden[0] = { ...golden[0], pHome: golden[0].pHome + 0.0001 };
    expect(() => verifyClubStrengthCutover(artifact, golden)).toThrow(/changed fixture/);
  });

  it("allows a later production snapshot without rewriting the cutover artifact", () => {
    const dataDir = getRepoDataDir();
    const production = readSelectedClubStrengthArtifact(selectedClubStrengthArtifactPath(dataDir));
    const cutover = readClubStrengthCutoverArtifact(dataDir);
    expect(production.artifact.payloadSha256).not.toBe(cutover.artifact.payloadSha256);
    expect(CLUB_STRENGTH_CUTOVER_ARTIFACT_FILE).toContain(cutover.artifact.payloadSha256);
    expect(production.byProfile["eng-clubs"].size).toBeGreaterThanOrEqual(20);
    expect(production.byProfile["uefa-clubs"].size).toBeGreaterThanOrEqual(100);
    for (const club of ["Arsenal", "Hull", "Man United", "Liverpool", "Chelsea"]) {
      expect(production.byProfile["eng-clubs"].has(club)).toBe(true);
    }
  });
});
