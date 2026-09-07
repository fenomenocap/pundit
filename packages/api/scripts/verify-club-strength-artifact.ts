import path from "node:path";
import {
  readSelectedClubStrengthArtifact,
  selectedClubStrengthArtifactPath,
} from "../src/services/club-strength-artifact";
import {
  readClubStrengthCutoverArtifact,
  readClubStrengthGolden,
  verifyClubStrengthCutover,
} from "../src/services/club-strength-cutover";

const repoDataDir = path.join(__dirname, "../data");
const filePath = process.argv[2] ?? selectedClubStrengthArtifactPath(repoDataDir);
const validated = readSelectedClubStrengthArtifact(filePath);
const golden = readClubStrengthGolden(repoDataDir);
verifyClubStrengthCutover(readClubStrengthCutoverArtifact(repoDataDir), golden);
console.log(JSON.stringify({
  valid: true,
  artifactId: validated.artifact.artifactId,
  snapshotAt: validated.snapshotAt.toISOString(),
  ageDays: validated.ageDays,
  unchangedGoldenFixtures: golden.length,
  profiles: Object.fromEntries(
    Object.entries(validated.byProfile).map(([profile, ratings]) => [profile, ratings.size])
  ),
}, null, 2));
