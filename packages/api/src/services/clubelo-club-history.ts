import { canonicalClubName } from "../lib/team-names";
import { rankingDateFromClubEloApiUrl } from "./clubelo-wayback";

/**
 * Offline per-club ClubElo history (From/To time-series).
 * Separate from dated ranking snapshots. Runtime model/chat must never import
 * this module or contact ClubElo / Wayback.
 *
 * Pre-kickoff Elo is the unique window covering the UTC day BEFORE kickoff.
 * Missing or overlapping windows fail closed. Ratings are not invented from
 * match results.
 */
export const CLUBELO_CLUB_HISTORY_MIN_WINDOWS = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKED_SLUGS = new Set([
  "",
  "yyyy-mm-dd",
  "clubname",
  "fixtures",
  "favicon.ico",
  "robots.txt",
]);

export interface ClubEloHistoryWindow {
  club: string;
  country: string;
  elo: number;
  from: string;
  to: string;
}

/** Stacked daily ranking row with ClubElo's own From/To window and optional scrape date. */
export interface ClubEloValidityRow extends ClubEloHistoryWindow {
  scrapeDate?: string;
}

export interface ClubEloValidityLookup {
  elo: number;
  windowFrom: string;
  windowTo: string;
  scrapeDate?: string;
}

/** Round ClubElo float32 scrape noise without merging real rating updates. */
export const CLUBELO_VALIDITY_ELO_DECIMALS = 2;

export function clubSlugFromClubEloApiUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^api\.clubelo\.com$/i.test(parsed.hostname)) return null;
  const slug = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug || BLOCKED_SLUGS.has(slug.toLowerCase())) return null;
  if (rankingDateFromClubEloApiUrl(url)) return null;
  if (DATE_RE.test(slug)) return null;
  return slug;
}

export function isClubEloClubHistoryUrl(url: string): boolean {
  return clubSlugFromClubEloApiUrl(url) !== null;
}

function parseValidityLine(parts: string[]): ClubEloValidityRow | null {
  if (parts.length < 7) return null;
  const club = parts[1]?.trim();
  const country = parts[2]?.trim();
  const elo = Number.parseFloat(parts[4]);
  const from = parts[5]?.trim();
  const to = parts[6]?.trim();
  if (!club || !country || !Number.isFinite(elo)) return null;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return null;
  const scrapeDate = parts[7]?.trim();
  return {
    club,
    country,
    elo,
    from,
    to,
    ...(scrapeDate && DATE_RE.test(scrapeDate) ? { scrapeDate } : {}),
  };
}

export function parseClubEloClubHistoryCsv(text: string): ClubEloHistoryWindow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0] ?? "";
  if (!/^Rank,Club,Country,Level,Elo,From,To$/i.test(header)) return [];
  const rows: ClubEloHistoryWindow[] = [];
  for (const line of lines.slice(1)) {
    const parsed = parseValidityLine(line.split(","));
    if (parsed) rows.push({
      club: parsed.club,
      country: parsed.country,
      elo: parsed.elo,
      from: parsed.from,
      to: parsed.to,
    });
  }
  return rows;
}

/**
 * Official ClubElo header, optionally followed by scrape `date` / `updated_at`
 * (tonyelhabr stacked daily rankings). Multi-club files are allowed.
 */
export function parseClubEloValidityCsv(text: string): ClubEloValidityRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0] ?? "";
  if (!/^Rank,Club,Country,Level,Elo,From,To(?:,|$)/i.test(header)) return [];
  const rows: ClubEloValidityRow[] = [];
  for (const line of lines.slice(1)) {
    const parsed = parseValidityLine(line.split(","));
    if (parsed) rows.push(parsed);
  }
  return rows;
}

export function indexClubEloValidityRows(
  rows: readonly ClubEloValidityRow[]
): Map<string, ClubEloValidityRow[]> {
  const byClub = new Map<string, ClubEloValidityRow[]>();
  for (const row of rows) {
    const key = canonicalClubName(row.club);
    const list = byClub.get(key);
    if (list) list.push(row);
    else byClub.set(key, [row]);
  }
  return byClub;
}

export function asPointInTimeValidityRows(
  rankingDate: string,
  rows: readonly Pick<ClubEloValidityRow, "club" | "country" | "elo">[]
): ClubEloValidityRow[] {
  if (!DATE_RE.test(rankingDate)) return [];
  return rows.map((row) => ({
    club: row.club,
    country: row.country,
    elo: row.elo,
    from: rankingDate,
    to: rankingDate,
    scrapeDate: rankingDate,
  }));
}

function roundValidityElo(elo: number): number {
  const scale = 10 ** CLUBELO_VALIDITY_ELO_DECIMALS;
  return Math.round(elo * scale) / scale;
}

function observedOnOrBeforePolicy(row: ClubEloValidityRow, utcDate: string): boolean {
  return !row.scrapeDate || row.scrapeDate <= utcDate;
}

/**
 * ClubElo From/To window covering `utcDate` (inclusive). Does not interpolate,
 * invent Elo, or carry a row past its To date.
 *
 * Stacked scrapes: prefer windows observed on or before the policy date so a
 * later snapshot cannot look ahead. A scrape gap inside an already-open
 * From/To window is accepted. Distinct Elo on the same latest observation
 * fail closed.
 */
export function eloOnUtcDateFromValidityRows(
  rows: readonly ClubEloValidityRow[],
  utcDate: string
): ClubEloValidityLookup | null {
  if (!DATE_RE.test(utcDate)) return null;
  const covering = rows.filter((row) => row.from <= utcDate && utcDate <= row.to);
  if (covering.length === 0) return null;

  const observedBefore = covering.filter((row) => observedOnOrBeforePolicy(row, utcDate));
  const pool = observedBefore.length > 0 ? observedBefore : covering;
  const scrapeDates = pool
    .map((row) => row.scrapeDate)
    .filter((date): date is string => Boolean(date));
  const latestScrape = scrapeDates.length > 0 ? scrapeDates.reduce((a, b) => (a > b ? a : b)) : undefined;
  const atLatest = latestScrape
    ? pool.filter((row) => row.scrapeDate === latestScrape)
    : pool;

  const unique = new Map<number, ClubEloValidityRow>();
  for (const row of atLatest) {
    unique.set(roundValidityElo(row.elo), row);
  }
  if (unique.size !== 1) return null;
  const chosen = [...unique.values()][0];
  return {
    elo: chosen.elo,
    windowFrom: chosen.from,
    windowTo: chosen.to,
    ...(chosen.scrapeDate ? { scrapeDate: chosen.scrapeDate } : {}),
  };
}

export function looksLikeClubEloClubHistoryCsv(
  text: string,
  minWindows = CLUBELO_CLUB_HISTORY_MIN_WINDOWS
): boolean {
  if (/<html/i.test(text) || /temporarily offline/i.test(text)) return false;
  const rows = parseClubEloClubHistoryCsv(text);
  if (rows.length < minWindows) return false;
  const clubs = new Set(rows.map((row) => canonicalClubName(row.club)));
  return clubs.size === 1;
}

/**
 * ClubElo's own history: the unique From/To window covering `utcDate`.
 * Overlaps or gaps return null — do not interpolate or invent Elo.
 */
export function eloOnUtcDateFromClubHistory(
  rows: readonly ClubEloHistoryWindow[],
  utcDate: string
): number | null {
  if (!DATE_RE.test(utcDate)) return null;
  const covering = rows.filter((row) => row.from <= utcDate && utcDate <= row.to);
  if (covering.length !== 1) return null;
  return covering[0].elo;
}

export function clubHistoryDateCoverage(
  rows: readonly ClubEloHistoryWindow[],
  utcDates: readonly string[]
): { covered: string[]; missing: string[] } {
  const covered: string[] = [];
  const missing: string[] = [];
  for (const date of utcDates) {
    if (eloOnUtcDateFromClubHistory(rows, date) == null) missing.push(date);
    else covered.push(date);
  }
  return { covered, missing };
}
