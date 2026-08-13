import fs from "node:fs";
import path from "node:path";
import {
  buildClubStrengthArtifact,
  buildClubStrengthArtifactSelector,
  ClubStrengthArtifactPayload,
} from "../src/services/club-strength-artifact";

interface LegacyRatingsSnapshot {
  fetchedAt: string;
  byProfile: ClubStrengthArtifactPayload["byProfile"];
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error("Usage: build-club-strength-artifact <ratings-snapshot.json> <production.json>");
}

const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as LegacyRatingsSnapshot;
const artifact = buildClubStrengthArtifact({
  snapshotAt: input.fetchedAt,
  byProfile: input.byProfile,
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const artifactPath = path.join(path.dirname(outputPath), `${artifact.payloadSha256}.json`);
const artifactTempPath = `${artifactPath}.${process.pid}.tmp`;
if (!fs.existsSync(artifactPath)) {
  fs.writeFileSync(artifactTempPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.renameSync(artifactTempPath, artifactPath);
}
const selector = buildClubStrengthArtifactSelector(artifact);
const selectorTempPath = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(selectorTempPath, `${JSON.stringify(selector, null, 2)}\n`, "utf8");
fs.renameSync(selectorTempPath, outputPath);
console.log(JSON.stringify({
  artifactId: artifact.artifactId,
  snapshotAt: artifact.payload.snapshotAt,
  outputPath,
  artifactPath,
}, null, 2));
