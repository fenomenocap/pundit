import { canonicalClubName } from "../lib/team-names";
import { RatingProfile } from "../config/competitions";

const CLUBELO_BASE = "http://api.clubelo.com";
const CLUBELO_TIMEOUT_MS = 8_000;
export const CLUB_RATINGS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const CLUB_RATINGS_COLD_RETRY_MS = 5 * 60 * 1000;

export interface ClubRatingsCache {
  byProfile: Record<RatingProfile, Map<string, number>>;
  fetchedAt: Date | null;
  error: string | null;
}

const cache: ClubRatingsCache = {
  byProfile: {
    world: new Map(),
    "eng-clubs": new Map(),
    "uefa-clubs": new Map(),
  },
  fetchedAt: null,
  error: null,
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

export async function refreshClubRatings(): Promise<void> {
  console.log("[ClubRatings] Refreshing ClubElo ratings...");
  try {
    const profiles = await fetchClubRatings();
    cache.byProfile = profiles;
    cache.fetchedAt = new Date();
    cache.error = null;
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
