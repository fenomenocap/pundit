import fs from "node:fs";
import path from "node:path";
import { canonicalClubName } from "../lib/team-names";
import { RatingProfile } from "../config/competitions";
import {
  CLUB_STRENGTH_MAX_AGE_DAYS,
  clubStrengthSnapshotIsCurrent,
  ClubStrengthArtifact,
  readClubStrengthArtifact,
  readSelectedClubStrengthArtifact,
  selectedClubStrengthArtifactPath,
  ValidatedClubStrengthArtifact,
} from "./club-strength-artifact";
import {
  getRepoDataDir,
  readJsonFile,
  resolveDataPath,
  writeJsonFileAtomic,
} from "./persistent-store";

const ARTIFACT_CACHE_FILE = "cache/club-strength-artifact.json";
const ARTIFACT_LAST_GOOD_FILE = "cache/club-strength-artifact.json.last-good";
export const CLUB_RATINGS_MAX_PERSISTED_AGE_DAYS = CLUB_STRENGTH_MAX_AGE_DAYS;
export const CLUB_RATINGS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const CLUB_RATINGS_COLD_RETRY_MS = 5 * 60 * 1000;

export interface StaleClubRating {
  club: string;
  elo: number;
  asOf: string;
  ageDays: number;
}

export interface ClubRatingsCache {
  byProfile: Record<RatingProfile, Map<string, number>>;
  fetchedAt: Date | null;
  error: string | null;
  staleRatings: StaleClubRating[];
  /** True only when startup recovered the artifact from /data rather than the release bundle. */
  servingPersisted: boolean;
  artifactId?: string | null;
  artifactSha256?: string | null;
}

const emptyProfiles = (): Record<RatingProfile, Map<string, number>> => ({
  world: new Map(),
  "eng-clubs": new Map(),
  "uefa-clubs": new Map(),
});

const cache: ClubRatingsCache = {
  byProfile: emptyProfiles(),
  fetchedAt: null,
  error: null,
  staleRatings: [],
  servingPersisted: false,
  artifactId: null,
  artifactSha256: null,
};

export function getCachedClubRatings(): ClubRatingsCache {
  return {
    ...cache,
    byProfile: {
      world: new Map(cache.byProfile.world),
      "eng-clubs": new Map(cache.byProfile["eng-clubs"]),
      "uefa-clubs": new Map(cache.byProfile["uefa-clubs"]),
    },
    staleRatings: cache.staleRatings.map((entry) => ({ ...entry })),
  };
}

export function clubRatingsAgeDays(fetchedAt: Date | null, now = new Date()): number | null {
  if (!fetchedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - fetchedAt.getTime()) / 86_400_000));
}

/** Serving gate shared by readiness, model endpoints and chat routing. */
export function clubRatingsAreCurrent(
  state: ClubRatingsCache = getCachedClubRatings(),
  now = new Date()
): boolean {
  const sha = state.artifactSha256;
  return state.fetchedAt !== null
    && clubStrengthSnapshotIsCurrent(state.fetchedAt, now)
    && typeof sha === "string"
    && /^[a-f0-9]{64}$/.test(sha)
    && state.artifactId === `clubelo@1:${sha}`;
}

function adoptArtifact(validated: ValidatedClubStrengthArtifact, persisted: boolean): void {
  cache.byProfile = validated.byProfile;
  cache.fetchedAt = validated.snapshotAt;
  cache.error = null;
  cache.staleRatings = [];
  cache.servingPersisted = persisted;
  cache.artifactId = validated.artifact.artifactId;
  cache.artifactSha256 = validated.artifact.payloadSha256;
}

function persistLastGoodArtifact(artifact: ClubStrengthArtifact): void {
  const currentPath = resolveDataPath(ARTIFACT_CACHE_FILE);
  const current = readJsonFile<ClubStrengthArtifact>(currentPath);
  if (current) writeJsonFileAtomic(resolveDataPath(ARTIFACT_LAST_GOOD_FILE), current);
  writeJsonFileAtomic(currentPath, artifact);
}

function readPersistedArtifact(filePath: string, now: Date): ValidatedClubStrengthArtifact | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return readClubStrengthArtifact(filePath, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[ClubRatings] Ignoring invalid persisted artifact at ${filePath}: ${message}`);
    return null;
  }
}

/**
 * Loads the pinned, content-addressed champion artifact without making a network
 * request. The mounted volume copies exist only for last-good recovery if a
 * future release accidentally ships a corrupt selection.
 */
export function loadClubStrengthArtifact(now = new Date()): boolean {
  const bundledPath = selectedClubStrengthArtifactPath(getRepoDataDir());
  try {
    const bundled = readSelectedClubStrengthArtifact(bundledPath, now);
    adoptArtifact(bundled, false);
    try {
      persistLastGoodArtifact(bundled.artifact);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[ClubRatings] Could not persist artifact recovery copies: ${message}`);
    }
    console.log(
      `[ClubRatings] Loaded release artifact ${bundled.artifact.artifactId} `
      + `(${bundled.byProfile["uefa-clubs"].size} UEFA clubs, ${bundled.ageDays}d old).`
    );
    return true;
  } catch (error) {
    const bundledMessage = error instanceof Error ? error.message : "Unknown error";
    for (const relativePath of [ARTIFACT_CACHE_FILE, ARTIFACT_LAST_GOOD_FILE]) {
      const recovered = readPersistedArtifact(resolveDataPath(relativePath), now);
      if (!recovered) continue;
      adoptArtifact(recovered, true);
      cache.error = `Release artifact invalid; recovered from ${path.basename(relativePath)}: ${bundledMessage}`;
      console.warn(`[ClubRatings] ALERT: ${cache.error}`);
      return true;
    }
    cache.byProfile = emptyProfiles();
    cache.fetchedAt = null;
    cache.error = bundledMessage;
    cache.staleRatings = [];
    cache.servingPersisted = false;
    cache.artifactId = null;
    cache.artifactSha256 = null;
    console.error(`[ClubRatings] ALERT: no valid local strength artifact: ${bundledMessage}`);
    return false;
  }
}

/** Backwards-compatible bootstrap name; no vendor refresh is performed. */
export async function refreshClubRatings(now = new Date()): Promise<void> {
  loadClubStrengthArtifact(now);
}

/** Backwards-compatible restore name used by older tests and callers. */
export function loadPersistedClubRatings(now = new Date()): boolean {
  for (const relativePath of [ARTIFACT_CACHE_FILE, ARTIFACT_LAST_GOOD_FILE]) {
    const recovered = readPersistedArtifact(resolveDataPath(relativePath), now);
    if (!recovered) continue;
    adoptArtifact(recovered, true);
    return true;
  }
  return false;
}

/** Artifact coverage is immutable at runtime; unresolved clubs remain unpriced. */
export async function backfillMissingClubRatings(
  teams: ReadonlyArray<{ team: string; profile: RatingProfile }>
): Promise<string[]> {
  return teams
    .filter(({ team, profile }) => lookupClubRating(team, profile, cache.byProfile) === undefined)
    .map(({ team }) => team);
}

export function lookupClubRating(
  team: string,
  profile: RatingProfile,
  ratings: Record<RatingProfile, Map<string, number>>
): number | undefined {
  return ratings[profile]?.get(canonicalClubName(team));
}

export function clubRatingsRefreshDelay(cacheState: ClubRatingsCache): number {
  return cacheState.fetchedAt === null && cacheState.error !== null
    ? CLUB_RATINGS_COLD_RETRY_MS
    : CLUB_RATINGS_REFRESH_INTERVAL_MS;
}

let cronTimer: ReturnType<typeof setTimeout> | null = null;
let cronEnabled = false;

function scheduleArtifactValidation(): void {
  if (!cronEnabled) return;
  cronTimer = setTimeout(() => {
    cronTimer = null;
    void refreshClubRatings().finally(scheduleArtifactValidation);
  }, CLUB_RATINGS_REFRESH_INTERVAL_MS);
}

/**
 * Startup loads once and revalidates locally each hour so a long-running
 * instance also fails closed when the selected snapshot crosses 30 days. New
 * ratings still enter production only through a reviewed release artifact.
 */
export async function startClubRatingsCron(): Promise<void> {
  cronEnabled = true;
  if (cronTimer) clearTimeout(cronTimer);
  await refreshClubRatings();
  scheduleArtifactValidation();
  console.log("[ClubRatings] Local artifact loaded — runtime vendor refresh disabled.");
}

export function stopClubRatingsCron(): void {
  cronEnabled = false;
  if (cronTimer) clearTimeout(cronTimer);
  cronTimer = null;
}
