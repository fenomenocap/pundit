import { canonicalClubName } from "../lib/team-names";
import { RatingProfile } from "../config/competitions";

const CLUBELO_BASE = "http://api.clubelo.com";

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

async function fetchClubEloForDate(date: string): Promise<ReturnType<typeof parseClubEloCsv>> {
  const response = await fetch(`${CLUBELO_BASE}/${date}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pundit/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ClubElo ${response.status} for ${date}`);
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

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startClubRatingsCron(): Promise<void> {
  await refreshClubRatings();
  cronTimer = setInterval(refreshClubRatings, REFRESH_INTERVAL_MS);
  console.log("[ClubRatings] Cron started — refreshing every hour");
}

export function stopClubRatingsCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
