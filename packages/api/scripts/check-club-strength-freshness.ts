import fs from "node:fs";
import path from "node:path";
import {
  CLUB_STRENGTH_MAX_AGE_DAYS,
  CLUB_STRENGTH_WARN_AGE_DAYS,
  clubStrengthSnapshotIsCurrent,
  clubStrengthSnapshotNeedsRefresh,
  selectedClubStrengthArtifactPath,
  type ClubStrengthArtifact,
  type ClubStrengthArtifactSelector,
} from "../src/services/club-strength-artifact";

/**
 * Offline pin-age check. Does not contact ClubElo. Scheduled CI uses this as
 * the 7-day refresh alarm; it must not run on every pull request.
 *
 * Usage: check-club-strength-freshness [production.json]
 * Exit 0: younger than 7 days
 * Exit 2: refresh due, still inside the 30-day serving gate
 * Exit 1: expired, unreadable, or invalid
 */
const repoDataDir = path.join(__dirname, "../data");
const selectorPath = process.argv[2] ?? selectedClubStrengthArtifactPath(repoDataDir);

function readSelector(filePath: string): ClubStrengthArtifactSelector {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ClubStrengthArtifactSelector;
}

function readArtifact(filePath: string): ClubStrengthArtifact {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ClubStrengthArtifact;
}

function main(): void {
  const selector = readSelector(selectorPath);
  const artifactPath = path.resolve(path.dirname(selectorPath), selector.artifactPath);
  const artifact = readArtifact(artifactPath);
  const snapshotAt = new Date(artifact.payload?.snapshotAt ?? "");
  if (Number.isNaN(snapshotAt.getTime())) {
    throw new Error("Club strength artifact snapshot timestamp is invalid.");
  }
  const now = new Date();
  const ageDays = Math.max(0, Math.floor((now.getTime() - snapshotAt.getTime()) / 86_400_000));
  const current = clubStrengthSnapshotIsCurrent(snapshotAt, now);
  const refreshDue = clubStrengthSnapshotNeedsRefresh(snapshotAt, now);
  const report = {
    artifactId: artifact.artifactId ?? selector.artifactId,
    snapshotAt: snapshotAt.toISOString(),
    ageDays,
    refreshDue,
    current,
    warnAgeDays: CLUB_STRENGTH_WARN_AGE_DAYS,
    maxAgeDays: CLUB_STRENGTH_MAX_AGE_DAYS,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!current) process.exit(1);
  if (refreshDue) process.exit(2);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
