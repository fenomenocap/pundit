import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RatingProfile } from "../config/competitions";

export const CLUB_STRENGTH_ARTIFACT_SCHEMA_VERSION = 1;
export const CLUB_STRENGTH_CONTRIBUTOR_ID = "clubelo";
export const CLUB_STRENGTH_CONTRIBUTOR_VERSION = "1";
export const CLUB_STRENGTH_MAX_AGE_DAYS = 30;
export const CLUB_STRENGTH_MAX_AGE_MS = CLUB_STRENGTH_MAX_AGE_DAYS * 86_400_000;
export const CLUB_STRENGTH_MAX_FUTURE_SKEW_MS = 86_400_000;
export const CLUB_STRENGTH_MIN_PLAUSIBLE_RATING = 500;
export const CLUB_STRENGTH_MAX_PLAUSIBLE_RATING = 3000;
export const CLUB_STRENGTH_SELECTED_ARTIFACT = "model-artifacts/clubelo/production.json";

export type SerializedClubStrengths = Record<RatingProfile, Record<string, number>>;

export interface ClubStrengthArtifactPayload {
  snapshotAt: string;
  byProfile: SerializedClubStrengths;
}

export interface ClubStrengthArtifact {
  schemaVersion: 1;
  artifactId: string;
  payloadSha256: string;
  contributor: {
    id: "clubelo";
    version: "1";
    methodId: "clubelo-elo-to-goals-dixon-coles";
  };
  source: {
    providerId: "clubelo";
    name: "ClubElo";
    snapshotAt: string;
    retrievedAt: string;
    citation: "clubelo-about";
    rightsStatus: "citation-required-use-review";
  };
  manifest: {
    payloadFormat: "pundit-club-strengths-v1";
    ratingUnit: "elo-points";
    profileCounts: Record<RatingProfile, number>;
    uniqueClubCount: number;
  };
  payload: ClubStrengthArtifactPayload;
}

export interface ClubStrengthArtifactSelector {
  schemaVersion: 1;
  artifactId: string;
  payloadSha256: string;
  artifactPath: string;
}

export interface ValidatedClubStrengthArtifact {
  artifact: ClubStrengthArtifact;
  snapshotAt: Date;
  ageDays: number;
  byProfile: Record<RatingProfile, Map<string, number>>;
}

export class ClubStrengthArtifactError extends Error {}

export function clubStrengthSnapshotIsCurrent(snapshotAt: Date, now = new Date()): boolean {
  const ageMs = now.getTime() - snapshotAt.getTime();
  return Number.isFinite(ageMs)
    && ageMs >= -CLUB_STRENGTH_MAX_FUTURE_SKEW_MS
    && ageMs <= CLUB_STRENGTH_MAX_AGE_MS;
}

export function clubStrengthPayloadSha256(payload: ClubStrengthArtifactPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildClubStrengthArtifact(
  payload: ClubStrengthArtifactPayload
): ClubStrengthArtifact {
  const payloadSha256 = clubStrengthPayloadSha256(payload);
  const profileCounts = {
    world: Object.keys(payload.byProfile.world).length,
    "eng-clubs": Object.keys(payload.byProfile["eng-clubs"]).length,
    "uefa-clubs": Object.keys(payload.byProfile["uefa-clubs"]).length,
  };
  return {
    schemaVersion: CLUB_STRENGTH_ARTIFACT_SCHEMA_VERSION,
    artifactId: `${CLUB_STRENGTH_CONTRIBUTOR_ID}@${CLUB_STRENGTH_CONTRIBUTOR_VERSION}:${payloadSha256}`,
    payloadSha256,
    contributor: {
      id: CLUB_STRENGTH_CONTRIBUTOR_ID,
      version: CLUB_STRENGTH_CONTRIBUTOR_VERSION,
      methodId: "clubelo-elo-to-goals-dixon-coles",
    },
    source: {
      providerId: "clubelo",
      name: "ClubElo",
      snapshotAt: payload.snapshotAt,
      retrievedAt: payload.snapshotAt,
      citation: "clubelo-about",
      rightsStatus: "citation-required-use-review",
    },
    manifest: {
      payloadFormat: "pundit-club-strengths-v1",
      ratingUnit: "elo-points",
      profileCounts,
      uniqueClubCount: new Set(Object.values(payload.byProfile).flatMap((ratings) => Object.keys(ratings))).size,
    },
    payload,
  };
}

function assertPlainRatings(value: unknown, profile: RatingProfile): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClubStrengthArtifactError(`Rating profile ${profile} is not an object.`);
  }
  const ratings = value as Record<string, unknown>;
  for (const [club, rating] of Object.entries(ratings)) {
    if (!club.trim() || typeof rating !== "number" || !Number.isFinite(rating)
      || rating < CLUB_STRENGTH_MIN_PLAUSIBLE_RATING
      || rating > CLUB_STRENGTH_MAX_PLAUSIBLE_RATING) {
      throw new ClubStrengthArtifactError(`Rating profile ${profile} contains an invalid row.`);
    }
  }
  return ratings as Record<string, number>;
}

export function validateClubStrengthArtifact(
  value: unknown,
  now = new Date()
): ValidatedClubStrengthArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClubStrengthArtifactError("Club strength artifact is not an object.");
  }
  const artifact = value as ClubStrengthArtifact;
  if (artifact.schemaVersion !== CLUB_STRENGTH_ARTIFACT_SCHEMA_VERSION
    || artifact.contributor?.id !== CLUB_STRENGTH_CONTRIBUTOR_ID
    || artifact.contributor?.version !== CLUB_STRENGTH_CONTRIBUTOR_VERSION
    || artifact.contributor?.methodId !== "clubelo-elo-to-goals-dixon-coles") {
    throw new ClubStrengthArtifactError("Club strength artifact identity is unsupported.");
  }
  if (artifact.source?.providerId !== "clubelo"
    || artifact.source?.name !== "ClubElo"
    || artifact.source?.snapshotAt !== artifact.payload?.snapshotAt
    || artifact.source?.retrievedAt !== artifact.payload?.snapshotAt
    || artifact.source?.citation !== "clubelo-about"
    || artifact.source?.rightsStatus !== "citation-required-use-review") {
    throw new ClubStrengthArtifactError("Club strength artifact source provenance is inconsistent.");
  }
  const parsedSnapshot = Date.parse(artifact.payload?.snapshotAt ?? "");
  if (!Number.isFinite(parsedSnapshot)) {
    throw new ClubStrengthArtifactError("Club strength artifact snapshot timestamp is invalid.");
  }
  const ageMs = now.getTime() - parsedSnapshot;
  if (ageMs < -CLUB_STRENGTH_MAX_FUTURE_SKEW_MS) {
    throw new ClubStrengthArtifactError("Club strength artifact snapshot is implausibly future-dated.");
  }
  const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
  if (!clubStrengthSnapshotIsCurrent(new Date(parsedSnapshot), now)) {
    throw new ClubStrengthArtifactError(
      `Club strength artifact exceeds the exact ${CLUB_STRENGTH_MAX_AGE_DAYS}-day freshness limit.`
    );
  }
  const byProfile = {
    world: assertPlainRatings(artifact.payload?.byProfile?.world, "world"),
    "eng-clubs": assertPlainRatings(artifact.payload?.byProfile?.["eng-clubs"], "eng-clubs"),
    "uefa-clubs": assertPlainRatings(artifact.payload?.byProfile?.["uefa-clubs"], "uefa-clubs"),
  };
  if (Object.keys(byProfile["eng-clubs"]).length < 20
    || Object.keys(byProfile["uefa-clubs"]).length < 100) {
    throw new ClubStrengthArtifactError("Club strength artifact has implausibly low coverage.");
  }
  const profileCounts = {
    world: Object.keys(byProfile.world).length,
    "eng-clubs": Object.keys(byProfile["eng-clubs"]).length,
    "uefa-clubs": Object.keys(byProfile["uefa-clubs"]).length,
  };
  const uniqueClubCount = new Set(Object.values(byProfile).flatMap((ratings) => Object.keys(ratings))).size;
  if (artifact.manifest?.payloadFormat !== "pundit-club-strengths-v1"
    || artifact.manifest?.ratingUnit !== "elo-points"
    || artifact.manifest?.profileCounts?.world !== profileCounts.world
    || artifact.manifest?.profileCounts?.["eng-clubs"] !== profileCounts["eng-clubs"]
    || artifact.manifest?.profileCounts?.["uefa-clubs"] !== profileCounts["uefa-clubs"]
    || artifact.manifest?.uniqueClubCount !== uniqueClubCount) {
    throw new ClubStrengthArtifactError("Club strength artifact manifest is inconsistent.");
  }
  const expectedHash = clubStrengthPayloadSha256(artifact.payload);
  if (artifact.payloadSha256 !== expectedHash
    || artifact.artifactId !== `${CLUB_STRENGTH_CONTRIBUTOR_ID}@${CLUB_STRENGTH_CONTRIBUTOR_VERSION}:${expectedHash}`) {
    throw new ClubStrengthArtifactError("Club strength artifact hash does not match its payload.");
  }
  return {
    artifact,
    snapshotAt: new Date(parsedSnapshot),
    ageDays,
    byProfile: {
      world: new Map(Object.entries(byProfile.world)),
      "eng-clubs": new Map(Object.entries(byProfile["eng-clubs"])),
      "uefa-clubs": new Map(Object.entries(byProfile["uefa-clubs"])),
    },
  };
}

export function readClubStrengthArtifact(
  filePath: string,
  now = new Date()
): ValidatedClubStrengthArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ClubStrengthArtifactError(`Could not read ${filePath}: ${message}`);
  }
  return validateClubStrengthArtifact(parsed, now);
}

export function buildClubStrengthArtifactSelector(
  artifact: ClubStrengthArtifact
): ClubStrengthArtifactSelector {
  return {
    schemaVersion: CLUB_STRENGTH_ARTIFACT_SCHEMA_VERSION,
    artifactId: artifact.artifactId,
    payloadSha256: artifact.payloadSha256,
    artifactPath: `${artifact.payloadSha256}.json`,
  };
}

export function readSelectedClubStrengthArtifact(
  selectorPath: string,
  now = new Date()
): ValidatedClubStrengthArtifact {
  let selector: ClubStrengthArtifactSelector;
  try {
    selector = JSON.parse(fs.readFileSync(selectorPath, "utf8")) as ClubStrengthArtifactSelector;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ClubStrengthArtifactError(`Could not read selector ${selectorPath}: ${message}`);
  }
  if (selector.schemaVersion !== CLUB_STRENGTH_ARTIFACT_SCHEMA_VERSION
    || !/^[a-f0-9]{64}$/.test(selector.payloadSha256 ?? "")
    || selector.artifactPath !== `${selector.payloadSha256}.json`
    || selector.artifactId !== `${CLUB_STRENGTH_CONTRIBUTOR_ID}@${CLUB_STRENGTH_CONTRIBUTOR_VERSION}:${selector.payloadSha256}`) {
    throw new ClubStrengthArtifactError("Club strength artifact selector is invalid.");
  }
  const selectedPath = path.join(path.dirname(selectorPath), selector.artifactPath);
  const validated = readClubStrengthArtifact(selectedPath, now);
  if (validated.artifact.artifactId !== selector.artifactId
    || validated.artifact.payloadSha256 !== selector.payloadSha256) {
    throw new ClubStrengthArtifactError("Club strength artifact selector does not match its target.");
  }
  return validated;
}

export function selectedClubStrengthArtifactPath(repoDataDir: string): string {
  return path.join(repoDataDir, CLUB_STRENGTH_SELECTED_ARTIFACT);
}
