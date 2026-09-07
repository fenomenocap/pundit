import path from "node:path";
import {
  readSelectedClubStrengthArtifact,
  selectedClubStrengthArtifactPath,
} from "../src/services/club-strength-artifact";
import {
  readClubStrengthGolden,
  rebuildClubStrengthGolden,
  writeClubStrengthGolden,
} from "../src/services/club-strength-cutover";

const repoDataDir = path.join(__dirname, "../data");
const selectorPath = process.argv[2] ?? selectedClubStrengthArtifactPath(repoDataDir);
const artifact = readSelectedClubStrengthArtifact(selectorPath);
const previous = readClubStrengthGolden(repoDataDir);
const rebuilt = rebuildClubStrengthGolden(artifact, previous);
writeClubStrengthGolden(repoDataDir, rebuilt);
console.log(JSON.stringify({
  artifactId: artifact.artifact.artifactId,
  snapshotAt: artifact.snapshotAt.toISOString(),
  fixtures: rebuilt.length,
}, null, 2));
