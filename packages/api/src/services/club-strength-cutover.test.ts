import { describe, expect, it } from "vitest";
import { getRepoDataDir } from "./persistent-store";
import {
  readSelectedClubStrengthArtifact,
  selectedClubStrengthArtifactPath,
} from "./club-strength-artifact";
import {
  readClubStrengthGolden,
  verifyClubStrengthCutover,
} from "./club-strength-cutover";

describe("club-strength artifact cutover golden", () => {
  it("preserves all public model fields for the 18 pre-cutover fixtures", () => {
    const dataDir = getRepoDataDir();
    const artifact = readSelectedClubStrengthArtifact(
      selectedClubStrengthArtifactPath(dataDir),
      new Date("2026-08-13T00:00:00Z")
    );
    const golden = readClubStrengthGolden(dataDir);
    expect(() => verifyClubStrengthCutover(artifact, golden)).not.toThrow();
  });

  it("detects a changed probability or rating", () => {
    const dataDir = getRepoDataDir();
    const artifact = readSelectedClubStrengthArtifact(
      selectedClubStrengthArtifactPath(dataDir),
      new Date("2026-08-13T00:00:00Z")
    );
    const golden = readClubStrengthGolden(dataDir);
    golden[0] = { ...golden[0], pHome: golden[0].pHome + 0.0001 };
    expect(() => verifyClubStrengthCutover(artifact, golden)).toThrow(/changed fixture/);
  });
});
