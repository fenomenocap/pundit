import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalClubName } from "../src/lib/team-names";
import { RatingProfile } from "../src/config/competitions";
import type { ClubStrengthCaptureRecord } from "../src/services/club-strength-artifact";
import {
  EPL_CLUB_PAGE_SLUGS,
  parseClubEloClubPageHtml,
  parseClubEloCsv,
  parseClubEloRankingHtml,
  rankingDateFromClubEloRankingHtml,
  type ClubEloCaptureRow,
} from "../src/services/clubelo-capture-parsers";

/**
 * Offline reviewed-release capture. Runtime model code must never import this
 * file or contact ClubElo.
 *
 * Usage:
 *   capture-clubelo-snapshot <ratings-snapshot.json>
 *   capture-clubelo-snapshot --club-pages <ratings-snapshot.json>
 *   capture-clubelo-snapshot --club-pages --verify-staging <staging.json> <ratings-snapshot.json>
 */
const CLUBELO_CSV_BASE = "http://api.clubelo.com";
const CLUBELO_SITE = "https://clubelo.com";
const LOOKBACK_DAYS = 14;
const MIN_ROWS = 10;
const USER_AGENT = "Mozilla/5.0 (compatible; pundit-release-capture/1.0)";
const STAGING_ELO_TOLERANCE = 0.5;

type ClubEloRow = ClubEloCaptureRow;

interface RatingsSnapshotFile {
  fetchedAt: string;
  clubEloRankingDate: string;
  byProfile: Record<RatingProfile, Record<string, number>>;
  capture?: {
    rankingPage?: ClubStrengthCaptureRecord;
    clubPages?: ClubStrengthCaptureRecord[];
  };
}

interface StagingClubCapture {
  slug: string;
  name: string;
  url: string;
  fetchedAt: string;
  pageSha256: string;
  elo: number;
}

function parseArgs(argv: string[]): {
  outputPath: string;
  clubPages: boolean;
  verifyStagingPath: string | null;
} {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const clubPages = flags.includes("--club-pages");
  const verifyStagingPath = flags.includes("--verify-staging")
    ? positional.shift() ?? null
    : null;
  const outputPath = positional[0] ?? "";
  return { outputPath, clubPages, verifyStagingPath };
}

function formatClubEloDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildProfileMaps(rows: ClubEloRow[]): Record<RatingProfile, Record<string, number>> {
  const engClubs: Record<string, number> = {};
  const uefaClubs: Record<string, number> = {};
  for (const row of rows) {
    const name = canonicalClubName(row.club);
    uefaClubs[name] = row.elo;
    if (row.country === "ENG") engClubs[name] = row.elo;
  }
  return {
    world: {},
    "eng-clubs": engClubs,
    "uefa-clubs": uefaClubs,
  };
}

function pageSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function captureFromCsv(referenceDate: Date): Promise<{ rankingDate: string; rows: ClubEloRow[] } | null> {
  let lastError = "";
  for (let offset = 0; offset < LOOKBACK_DAYS; offset += 1) {
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() - offset);
    const rankingDate = formatClubEloDate(date);
    try {
      const response = await fetchText(`${CLUBELO_CSV_BASE}/${rankingDate}`);
      if (!response.ok) {
        lastError = `ClubElo CSV ${response.status} for ${rankingDate}`;
        continue;
      }
      const rows = parseClubEloCsv(response.text);
      if (rows.length >= MIN_ROWS) return { rankingDate, rows };
      lastError = `ClubElo CSV ${rankingDate} returned only ${rows.length} clubs`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  console.warn(`[capture] CSV API unavailable (${lastError}); falling back to published ranking page.`);
  return null;
}

async function captureFromHtml(referenceDate: Date): Promise<{
  rankingDate: string;
  rows: ClubEloRow[];
  rankingPage: ClubStrengthCaptureRecord;
}> {
  const candidates = [
    `${CLUBELO_SITE}/Ranking`,
    ...Array.from({ length: LOOKBACK_DAYS }, (_, offset) => {
      const date = new Date(referenceDate);
      date.setUTCDate(date.getUTCDate() - offset);
      return `${CLUBELO_SITE}/${formatClubEloDate(date)}/Ranking`;
    }),
  ];
  let lastError: Error | null = null;
  for (const url of candidates) {
    try {
      const response = await fetchText(url);
      if (!response.ok) {
        lastError = new Error(`ClubElo HTML ${response.status} for ${url}`);
        continue;
      }
      const rows = parseClubEloRankingHtml(response.text);
      const rankingDate = rankingDateFromClubEloRankingHtml(response.text) ?? formatClubEloDate(referenceDate);
      if (rows.length >= MIN_ROWS) {
        return {
          rankingDate,
          rows,
          rankingPage: {
            url,
            fetchedAt: new Date().toISOString(),
            method: "clubelo-ranking-html",
            pageSha256: pageSha256(response.text),
            httpStatus: response.status,
          },
        };
      }
      lastError = new Error(`ClubElo HTML ${url} returned only ${rows.length} clubs`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("ClubElo published ranking is unavailable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function captureEplClubPages(): Promise<{ overrides: Map<string, number>; clubPages: ClubStrengthCaptureRecord[]; rankingDates: string[] }> {
  const overrides = new Map<string, number>();
  const clubPages: ClubStrengthCaptureRecord[] = [];
  const rankingDates: string[] = [];
  for (let index = 0; index < EPL_CLUB_PAGE_SLUGS.length; index += 1) {
    const entry = EPL_CLUB_PAGE_SLUGS[index]!;
    if (index > 0) await sleep(1000);
    const url = `${CLUBELO_SITE}/${entry.slug}`;
    const fetchedAt = new Date().toISOString();
    const response = await fetchText(url);
    if (!response.ok) {
      throw new Error(`ClubElo club page ${response.status} for ${url}`);
    }
    const parsed = parseClubEloClubPageHtml(response.text);
    if (parsed.elo == null || !Number.isFinite(parsed.elo)) {
      throw new Error(`ClubElo club page missing Elo for ${url}`);
    }
    const name = canonicalClubName(entry.name);
    overrides.set(name, parsed.elo);
    if (parsed.rankingDate) rankingDates.push(parsed.rankingDate);
    clubPages.push({
      url,
      fetchedAt,
      method: "clubelo-club-page-html",
      pageSha256: pageSha256(response.text),
      httpStatus: response.status,
    });
  }
  return { overrides, clubPages, rankingDates };
}

function applyClubPageOverrides(
  byProfile: Record<RatingProfile, Record<string, number>>,
  overrides: Map<string, number>,
): void {
  for (const [club, elo] of overrides) {
    if (byProfile["eng-clubs"][club] != null) {
      byProfile["eng-clubs"][club] = elo;
    }
    if (byProfile["uefa-clubs"][club] != null) {
      byProfile["uefa-clubs"][club] = elo;
    }
  }
}

function verifyAgainstStaging(
  overrides: Map<string, number>,
  stagingPath: string,
): void {
  const staging = JSON.parse(fs.readFileSync(stagingPath, "utf8")) as { clubs?: StagingClubCapture[] };
  const clubs = staging.clubs ?? [];
  if (clubs.length === 0) {
    throw new Error(`Staging capture ${stagingPath} has no clubs to verify.`);
  }
  for (const row of clubs) {
    const name = canonicalClubName(row.name);
    const live = overrides.get(name);
    if (live == null) {
      throw new Error(`Staging club ${row.name} not found in live club-page capture.`);
    }
    if (Math.abs(live - row.elo) > STAGING_ELO_TOLERANCE) {
      throw new Error(
        `Staging mismatch for ${row.name}: staging ${row.elo} vs live ${live} (tolerance ${STAGING_ELO_TOLERANCE}).`,
      );
    }
  }
}

async function main(): Promise<void> {
  const { outputPath, clubPages, verifyStagingPath } = parseArgs(process.argv.slice(2));
  if (!outputPath) {
    throw new Error("Usage: capture-clubelo-snapshot [--club-pages] [--verify-staging <staging.json>] <ratings-snapshot.json>");
  }
  const retrievedAt = new Date();
  const fetchedAt = retrievedAt.toISOString();
  const captured = await captureFromCsv(retrievedAt);
  let rankingDate: string;
  let rows: ClubEloRow[];
  let rankingPage: ClubStrengthCaptureRecord | undefined;
  if (captured) {
    rankingDate = captured.rankingDate;
    rows = captured.rows;
  } else {
    const htmlCapture = await captureFromHtml(retrievedAt);
    rankingDate = htmlCapture.rankingDate;
    rows = htmlCapture.rows;
    rankingPage = htmlCapture.rankingPage;
  }

  const byProfile = buildProfileMaps(rows);
  let clubPageRecords: ClubStrengthCaptureRecord[] | undefined;
  if (clubPages) {
    const { overrides, clubPages: pages, rankingDates } = await captureEplClubPages();
    applyClubPageOverrides(byProfile, overrides);
    clubPageRecords = pages;
    if (rankingDates.length > 0) {
      rankingDate = rankingDates.sort().at(-1) ?? rankingDate;
    }
    if (verifyStagingPath) {
      verifyAgainstStaging(overrides, verifyStagingPath);
    }
  }

  const snapshot: RatingsSnapshotFile = {
    fetchedAt,
    clubEloRankingDate: rankingDate,
    byProfile,
    ...(rankingPage || clubPageRecords
      ? {
        capture: {
          ...(rankingPage ? { rankingPage } : {}),
          ...(clubPageRecords ? { clubPages: clubPageRecords } : {}),
        },
      }
      : {}),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, outputPath);
  console.log(JSON.stringify({
    outputPath,
    fetchedAt: snapshot.fetchedAt,
    clubEloRankingDate: rankingDate,
    sourceRows: rows.length,
    engClubs: Object.keys(byProfile["eng-clubs"]).length,
    uefaClubs: Object.keys(byProfile["uefa-clubs"]).length,
    clubPages: clubPageRecords?.length ?? 0,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
