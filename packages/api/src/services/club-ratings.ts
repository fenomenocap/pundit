import { canonicalClubName } from "../lib/team-names";
import { RatingProfile } from "../config/competitions";

const CLUBELO_BASE = "http://api.clubelo.com";
const CLUBELO_TIMEOUT_MS = 8_000;
export const CLUB_RATINGS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const CLUB_RATINGS_COLD_RETRY_MS = 5 * 60 * 1000;

// A club can be correctly named and still absent from the daily snapshot:
// ClubElo only lists a club while it holds a rating window covering that date,
// so a club whose last window has lapsed (Olympiakos, whose latest window ended
// 2026-07-03) disappears entirely. Its own per-club feed still carries the last
// published rating, which is real data rather than an invented one, so we fall
// back to it rather than leave the fixture unpriced. Past this age the rating is
// too old to price a match honestly and the club stays missing.
export const CLUB_RATING_FALLBACK_MAX_AGE_DAYS = 120;
// A per-club feed is the club's entire history -- ~275KB and a measured 19-21s
// for Olympiakos, against ~33KB for a daily snapshot. The snapshot's 8s budget
// aborts it every time, so the fallback gets its own.
export const CLUB_RATING_FALLBACK_TIMEOUT_MS = 30_000;
// Bounds a cold start: these run one at a time, so an unusually broken round
// must not turn into minutes of fetching before the model builds at all.
export const CLUB_RATING_FALLBACK_MAX_CLUBS = 8;

export interface StaleClubRating {
  club: string;
  elo: number;
  /** Last date ClubElo published this rating for, ISO yyyy-mm-dd. */
  asOf: string;
  ageDays: number;
}

export interface ClubRatingsCache {
  byProfile: Record<RatingProfile, Map<string, number>>;
  fetchedAt: Date | null;
  error: string | null;
  /**
   * Ratings served from a lapsed per-club window rather than today's snapshot.
   * Surfaced so readiness can admit the model is pricing these off stale data.
   */
  staleRatings: StaleClubRating[];
}

const cache: ClubRatingsCache = {
  byProfile: {
    world: new Map(),
    "eng-clubs": new Map(),
    "uefa-clubs": new Map(),
  },
  fetchedAt: null,
  error: null,
  staleRatings: [],
};

export function getCachedClubRatings(): ClubRatingsCache {
  return {
    byProfile: {
      world: new Map(cache.byProfile.world),
      "eng-clubs": new Map(cache.byProfile["eng-clubs"]),
      "uefa-clubs": new Map(cache.byProfile["uefa-clubs"]),
    },
    fetchedAt: cache.fetchedAt,
    error: cache.error,
    staleRatings: cache.staleRatings.map((entry) => ({ ...entry })),
  };
}

function formatClubEloDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseClubEloCsv(text: string): Array<{
  club: string;
  country: string;
  elo: number;
}> {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: Array<{ club: string; country: string; elo: number }> = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const club = parts[1]?.trim();
    const country = parts[2]?.trim();
    const elo = Number.parseFloat(parts[4]);
    if (!club || !country || !Number.isFinite(elo)) continue;
    rows.push({ club, country, elo });
  }
  return rows;
}

function buildProfileMaps(rows: ReturnType<typeof parseClubEloCsv>): Record<RatingProfile, Map<string, number>> {
  const engClubs = new Map<string, number>();
  const uefaClubs = new Map<string, number>();
  for (const row of rows) {
    const name = canonicalClubName(row.club);
    uefaClubs.set(name, row.elo);
    if (row.country === "ENG") engClubs.set(name, row.elo);
  }
  return {
    world: new Map(),
    "eng-clubs": engClubs,
    "uefa-clubs": uefaClubs,
  };
}

class ClubEloDateUnavailableError extends Error {}

async function fetchClubEloForDate(date: string): Promise<ReturnType<typeof parseClubEloCsv>> {
  const response = await fetch(`${CLUBELO_BASE}/${date}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pundit/1.0)" },
    signal: AbortSignal.timeout(CLUBELO_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new ClubEloDateUnavailableError(`ClubElo ${response.status} for ${date}`);
    }
    throw new Error(`ClubElo ${response.status} for ${date}`);
  }
  return parseClubEloCsv(await response.text());
}

export async function fetchClubRatings(referenceDate = new Date()): Promise<Record<RatingProfile, Map<string, number>>> {
  let lastError: Error | null = null;
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() - offset);
    const formatted = formatClubEloDate(date);
    try {
      const rows = await fetchClubEloForDate(formatted);
      if (rows.length >= 10) return buildProfileMaps(rows);
      lastError = new Error(`ClubElo ${formatted} returned only ${rows.length} clubs`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Only a reachable-host "no snapshot for this date" response should
      // advance to the previous date. Retrying fourteen dates cannot recover
      // from a host/network timeout and turns one outage into a multi-minute
      // cold start.
      if (!(error instanceof ClubEloDateUnavailableError)) throw lastError;
    }
  }
  throw lastError ?? new Error("ClubElo ratings unavailable");
}

export function lookupClubRating(
  team: string,
  profile: RatingProfile,
  ratings: Record<RatingProfile, Map<string, number>>
): number | undefined {
  const name = canonicalClubName(team);
  return ratings[profile]?.get(name);
}

/** ClubElo addresses a club's own history by its canonical name minus spaces. */
export function clubEloClubPath(canonicalName: string): string {
  return canonicalName.replace(/\s+/g, "");
}

/**
 * Latest rating in a per-club feed. Rows are chronological and the final one
 * carries ClubElo's current (or last published) rating for the club.
 */
export function parseLatestClubEloRating(
  text: string
): { elo: number; asOf: string } | null {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return null;
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const parts = lines[index].split(",");
    if (parts.length < 7) continue;
    const elo = Number.parseFloat(parts[4]);
    const to = parts[6]?.trim();
    if (!Number.isFinite(elo) || !to) continue;
    return { elo, asOf: to };
  }
  return null;
}

function ratingAgeDays(asOf: string, referenceDate: Date): number {
  const parsed = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  // A forward-dated window is ClubElo's current rating, not a stale one.
  return Math.max(0, Math.floor((referenceDate.getTime() - parsed) / 86_400_000));
}

async function fetchLatestClubRating(
  canonicalName: string
): Promise<{ elo: number; asOf: string } | null> {
  const response = await fetch(`${CLUBELO_BASE}/${clubEloClubPath(canonicalName)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; pundit/1.0)",
      "Accept": "*/*",
      // Not optional. With Node's default Accept-Encoding the host never
      // finishes this response -- measured hanging past 60s, while the same
      // request with identity returns in ~9-11s. The daily snapshot is small
      // enough that it never hit this.
      "Accept-Encoding": "identity",
    },
    signal: AbortSignal.timeout(CLUB_RATING_FALLBACK_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return parseLatestClubEloRating(await response.text());
}

/**
 * Backfills clubs absent from the daily snapshot from their own feeds, writing
 * into the live cache so the next model build can price their fixtures. Returns
 * the clubs it could not recover. Best-effort by design: a per-club feed that
 * fails or is too old leaves that club missing and costs only its own fixtures.
 */
export async function backfillMissingClubRatings(
  teams: ReadonlyArray<{ team: string; profile: RatingProfile }>,
  referenceDate = new Date()
): Promise<string[]> {
  const unresolved: string[] = [];
  let attempted = 0;
  for (const { team, profile } of teams) {
    const name = canonicalClubName(team);
    if (cache.byProfile[profile]?.get(name) !== undefined) continue;
    if (attempted >= CLUB_RATING_FALLBACK_MAX_CLUBS) {
      unresolved.push(team);
      continue;
    }
    attempted += 1;
    let latest: { elo: number; asOf: string } | null = null;
    try {
      latest = await fetchLatestClubRating(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[ClubRatings] Fallback fetch failed for ${name}: ${message}`);
    }
    if (!latest) {
      unresolved.push(team);
      continue;
    }
    const ageDays = ratingAgeDays(latest.asOf, referenceDate);
    if (ageDays > CLUB_RATING_FALLBACK_MAX_AGE_DAYS) {
      console.warn(
        `[ClubRatings] Fallback for ${name} rejected — last rated ${latest.asOf} `
        + `(${ageDays}d old, limit ${CLUB_RATING_FALLBACK_MAX_AGE_DAYS}d).`
      );
      unresolved.push(team);
      continue;
    }
    cache.byProfile[profile].set(name, latest.elo);
    cache.staleRatings = [
      ...cache.staleRatings.filter((entry) => entry.club !== name),
      { club: name, elo: latest.elo, asOf: latest.asOf, ageDays },
    ].sort((a, b) => a.club.localeCompare(b.club));
    console.log(
      `[ClubRatings] ${name} priced from its lapsed window: `
      + `${latest.elo.toFixed(1)} as of ${latest.asOf} (${ageDays}d old).`
    );
  }
  return unresolved;
}

export async function refreshClubRatings(): Promise<void> {
  console.log("[ClubRatings] Refreshing ClubElo ratings...");
  try {
    const profiles = await fetchClubRatings();
    cache.byProfile = profiles;
    cache.fetchedAt = new Date();
    cache.error = null;
    // A fresh snapshot may well name a club whose window had lapsed, so stale
    // entries are dropped here and re-established only if still needed.
    cache.staleRatings = [];
    console.log(
      `[ClubRatings] ${profiles["eng-clubs"].size} ENG clubs, `
      + `${profiles["uefa-clubs"].size} UEFA clubs cached.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cache.error = message;
    console.error(`[ClubRatings] Refresh error: ${message}`);
  }
}

export function clubRatingsRefreshDelay(cacheState: ClubRatingsCache): number {
  return cacheState.fetchedAt === null && cacheState.error !== null
    ? CLUB_RATINGS_COLD_RETRY_MS
    : CLUB_RATINGS_REFRESH_INTERVAL_MS;
}

let cronTimer: ReturnType<typeof setTimeout> | null = null;
let cronEnabled = false;

function scheduleClubRatingsRefresh(): void {
  if (!cronEnabled) return;
  const delay = clubRatingsRefreshDelay(cache);
  cronTimer = setTimeout(() => {
    cronTimer = null;
    void refreshClubRatings().finally(() => {
      if (cronEnabled) scheduleClubRatingsRefresh();
    });
  }, delay);
}

export async function startClubRatingsCron(): Promise<void> {
  cronEnabled = true;
  if (cronTimer) clearTimeout(cronTimer);
  await refreshClubRatings();
  scheduleClubRatingsRefresh();
  console.log(
    `[ClubRatings] Cron started — next refresh in ${clubRatingsRefreshDelay(cache) / 1000}s`
  );
}

export function stopClubRatingsCron(): void {
  cronEnabled = false;
  if (cronTimer) clearTimeout(cronTimer);
  cronTimer = null;
}
