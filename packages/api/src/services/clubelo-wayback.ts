import { parseClubEloCsv } from "./clubelo-pre-kickoff-corpus";

/**
 * Offline reviewed retrieval of dated ClubElo CSVs via Internet Archive.
 * Runtime model/chat code must never import this module or contact ClubElo
 * or Wayback.
 *
 * Live `http://api.clubelo.com/YYYY-MM-DD` is preferred. Wayback is only a
 * fallback for that same calendar date. Homepage HTML, ranking HTML, club
 * time-series CSVs, and the literal `YYYY-MM-DD` placeholder are rejected.
 */
export const CLUBELO_CSV_BASES = [
  "http://api.clubelo.com",
  "https://api.clubelo.com",
] as const;
export const WAYBACK_CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
export const WAYBACK_WEB_ORIGIN = "https://web.archive.org";
export const INTERNET_ARCHIVE_WAYBACK_CITATION = "internet-archive-wayback" as const;
export const CLUBELO_HISTORY_USER_AGENT = "Mozilla/5.0 (compatible; pundit-release-capture/1.0)";
export const CLUBELO_CSV_MIN_ROWS = 10;

const RANKING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CDX_TIMESTAMP_RE = /^\d{8,14}$/;

export type ClubEloCsvCaptureSource = "clubelo-live-api" | "internet-archive-wayback";

export interface WaybackCdxRow {
  timestamp: string;
  original: string;
  statusCode: string;
  mimeType: string;
  length: string;
}

export interface ClubEloCsvFetchResult {
  rankingDate: string;
  raw: Buffer;
  text: string;
  sourceUrl: string;
  originalUrl: string;
  captureSource: ClubEloCsvCaptureSource;
  waybackTimestamp?: string;
}

export type WaybackInventoryStatus = "ok" | "unavailable" | "empty";

export interface WaybackDatedCsvInventory {
  status: WaybackInventoryStatus;
  reason?: string;
  captures: Map<string, WaybackCdxRow>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function clubEloDatedCsvUrls(rankingDate: string): string[] {
  if (!RANKING_DATE_RE.test(rankingDate)) {
    throw new Error(`Invalid ClubElo ranking date ${rankingDate}`);
  }
  return CLUBELO_CSV_BASES.map((base) => `${base}/${rankingDate}`);
}

export function rankingDateFromClubEloApiUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^api\.clubelo\.com$/i.test(parsed.hostname)) return null;
  const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!RANKING_DATE_RE.test(path)) return null;
  return path;
}

export function isClubEloDatedCsvUrl(url: string, rankingDate: string): boolean {
  return rankingDateFromClubEloApiUrl(url) === rankingDate;
}

export function waybackCdxQueryUrl(originalUrl: string): string {
  const params = new URLSearchParams({
    url: originalUrl,
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,length",
    filter: "statuscode:200",
  });
  return `${WAYBACK_CDX_ENDPOINT}?${params.toString()}`;
}

export function waybackHostCsvCdxUrl(): string {
  const params = new URLSearchParams({
    url: "api.clubelo.com",
    matchType: "host",
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,length",
    filter: "mimetype:text/csv",
  });
  return `${WAYBACK_CDX_ENDPOINT}?${params.toString()}`;
}

export function waybackIdentityUrl(row: Pick<WaybackCdxRow, "timestamp" | "original">): string {
  return `${WAYBACK_WEB_ORIGIN}/web/${row.timestamp}id_/${row.original}`;
}

function isCsvMime(mimeType: string): boolean {
  const mime = mimeType.trim().toLowerCase();
  return mime === "text/csv" || mime.startsWith("text/csv;") || mime === "application/csv";
}

export function parseWaybackCdxPayload(text: string): WaybackCdxRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("<") || /temporarily offline/i.test(trimmed)) {
    throw new Error("wayback-cdx-unavailable");
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error("wayback-cdx-unavailable");
    const rows = parsed.filter((row) => Array.isArray(row)) as unknown[][];
    const start = rows[0]?.[0] === "timestamp" ? 1 : 0;
    return rows.slice(start).flatMap((row) => {
      const timestamp = String(row[0] ?? "");
      const original = String(row[1] ?? "");
      const statusCode = String(row[2] ?? "");
      const mimeType = String(row[3] ?? "");
      const length = String(row[4] ?? "");
      if (!CDX_TIMESTAMP_RE.test(timestamp) || !original) return [];
      return [{ timestamp, original, statusCode, mimeType, length }];
    });
  }
  return trimmed.split("\n").flatMap((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[0] === "timestamp") return [];
    const [timestamp, original, statusCode, mimeType = "", length = ""] = parts;
    if (!CDX_TIMESTAMP_RE.test(timestamp) || !original) return [];
    return [{ timestamp, original, statusCode, mimeType, length }];
  });
}

export function selectLatestWaybackCsvCapture(
  rows: readonly WaybackCdxRow[],
  rankingDate: string
): WaybackCdxRow | null {
  const eligible = rows.filter((row) => (
    row.statusCode === "200"
    && isCsvMime(row.mimeType)
    && isClubEloDatedCsvUrl(row.original, rankingDate)
  ));
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1) ?? null;
}

export function datedCsvInventoryFromCdxRows(
  rows: readonly WaybackCdxRow[]
): Map<string, WaybackCdxRow> {
  const latest = new Map<string, WaybackCdxRow>();
  for (const row of rows) {
    if (row.statusCode !== "200" || !isCsvMime(row.mimeType)) continue;
    const rankingDate = rankingDateFromClubEloApiUrl(row.original);
    if (!rankingDate) continue;
    const previous = latest.get(rankingDate);
    if (!previous || row.timestamp > previous.timestamp) latest.set(rankingDate, row);
  }
  return latest;
}

export function looksLikeClubEloRankingCsv(text: string, minRows = CLUBELO_CSV_MIN_ROWS): boolean {
  const header = text.trim().split(/\r?\n/, 1)[0] ?? "";
  if (!/^Rank,Club,Country,Level,Elo(\b|,)/i.test(header)) return false;
  if (/<html/i.test(text) || /temporarily offline/i.test(text)) return false;
  const rows = parseClubEloCsv(text);
  if (rows.length < minRows) return false;
  // A dated ranking snapshot has many clubs. A per-club From/To time-series
  // shares the same header but is one club repeated; that is a different path.
  const uniqueClubs = new Set(rows.map((row) => row.club));
  return uniqueClubs.size >= minRows;
}

function requestInit(): RequestInit {
  return {
    headers: { "User-Agent": CLUBELO_HISTORY_USER_AGENT },
    redirect: "follow",
  };
}

async function readBody(response: Response): Promise<{ raw: Buffer; text: string }> {
  const raw = Buffer.from(await response.arrayBuffer());
  return { raw, text: raw.toString("utf8") };
}

export async function fetchLiveClubEloCsv(
  rankingDate: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<ClubEloCsvFetchResult | null> {
  for (const originalUrl of clubEloDatedCsvUrls(rankingDate)) {
    try {
      const response = await fetchImpl(originalUrl, {
        ...requestInit(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const { raw, text } = await readBody(response);
      if (!looksLikeClubEloRankingCsv(text)) continue;
      return {
        rankingDate,
        raw,
        text,
        sourceUrl: originalUrl,
        originalUrl,
        captureSource: "clubelo-live-api",
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function fetchWaybackClubEloCsv(
  rankingDate: string,
  row: WaybackCdxRow,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<ClubEloCsvFetchResult> {
  if (!isClubEloDatedCsvUrl(row.original, rankingDate)) {
    throw new Error(`wayback-wrong-date:${rankingDate}`);
  }
  const sourceUrl = waybackIdentityUrl(row);
  const response = await fetchImpl(sourceUrl, {
    ...requestInit(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`wayback-http-${response.status}`);
  }
  const { raw, text } = await readBody(response);
  if (!looksLikeClubEloRankingCsv(text)) {
    throw new Error("wayback-invalid-body");
  }
  return {
    rankingDate,
    raw,
    text,
    sourceUrl,
    originalUrl: row.original,
    captureSource: "internet-archive-wayback",
    waybackTimestamp: row.timestamp,
  };
}

export async function listWaybackDatedCsvInventory(
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<WaybackDatedCsvInventory> {
  try {
    const response = await fetchImpl(waybackHostCsvCdxUrl(), {
      ...requestInit(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      return { status: "unavailable", reason: `wayback-cdx-http-${response.status}`, captures: new Map() };
    }
    const rows = parseWaybackCdxPayload(text);
    const captures = datedCsvInventoryFromCdxRows(rows);
    return {
      status: captures.size > 0 ? "ok" : "empty",
      captures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unavailable",
      reason: message === "wayback-cdx-unavailable" ? message : `wayback-cdx-unavailable:${message}`,
      captures: new Map(),
    };
  }
}

export async function fetchClubEloDatedCsv(options: {
  rankingDate: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  inventory?: ReadonlyMap<string, WaybackCdxRow>;
  skipLive?: boolean;
}): Promise<ClubEloCsvFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!options.skipLive) {
    const live = await fetchLiveClubEloCsv(options.rankingDate, fetchImpl, timeoutMs);
    if (live) return live;
  }
  const capture = options.inventory
    ? (options.inventory.get(options.rankingDate) ?? null)
    : await lookupWaybackCaptureForDate(
      options.rankingDate,
      fetchImpl,
      timeoutMs
    );
  if (!capture) {
    throw new Error(`wayback-missing:${options.rankingDate}`);
  }
  return fetchWaybackClubEloCsv(options.rankingDate, capture, fetchImpl, timeoutMs);
}

async function lookupWaybackCaptureForDate(
  rankingDate: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<WaybackCdxRow | null> {
  const rows: WaybackCdxRow[] = [];
  for (const originalUrl of clubEloDatedCsvUrls(rankingDate)) {
    try {
      const response = await fetchImpl(waybackCdxQueryUrl(originalUrl), {
        ...requestInit(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) continue;
      rows.push(...parseWaybackCdxPayload(text));
    } catch {
      continue;
    }
  }
  return selectLatestWaybackCsvCapture(rows, rankingDate);
}
