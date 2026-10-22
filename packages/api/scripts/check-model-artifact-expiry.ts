import fs from "node:fs";
import path from "node:path";
import { CLUB_STRENGTH_MAX_AGE_MS, selectedClubStrengthArtifactPath } from "../src/services/club-strength-artifact";
import { EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN, EPL_GOAL_CALIBRATION_MAX_AGE_MS } from "../src/services/epl-goal-calibration-artifact";
import { modelArtifactExpiryReport } from "../src/services/model-artifact-expiry";

/**
 * Daily expiry alarm for the two hard-expiring model pins. Offline; reads
 * only committed files. Exit 0: both pins have more than 7 days left.
 * Exit 1: a pin expires within 7 days, has expired, or cannot be read.
 */
function main(): void {
  const dataDir = path.join(__dirname, "../data");
  const selectorPath = selectedClubStrengthArtifactPath(dataDir);
  const selector = JSON.parse(fs.readFileSync(selectorPath, "utf8")) as { artifactPath: string };
  const artifact = JSON.parse(fs.readFileSync(path.resolve(path.dirname(selectorPath), selector.artifactPath), "utf8"));
  const report = modelArtifactExpiryReport([
    { id: "epl-goal-calibration", issuedAt: EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN, maxAgeMs: EPL_GOAL_CALIBRATION_MAX_AGE_MS },
    { id: "clubelo-pin", issuedAt: String(artifact.payload?.snapshotAt ?? ""), maxAgeMs: CLUB_STRENGTH_MAX_AGE_MS },
  ], new Date());
  console.log(JSON.stringify(report, null, 2));
  for (const pin of report.pins) {
    if (pin.alert) console.log(`::error title=Model pin expiry::${pin.id} expires ${pin.expiresAt} (${pin.daysLeft} days left). Re-fit/refresh and re-pin before then.`);
  }
  if (report.alert) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
