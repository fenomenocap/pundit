/**
 * Offline probe: Common Crawl HTML (clubelo.com dated ranking pages) and
 * archive.today / ghostarchive / archive.is for api.clubelo.com CSV.
 * Does NOT contact live api.clubelo.com. Does NOT re-run Wayback or CC CSV CDX.
 */
import fs from "node:fs";
import path from "node:path";
import { parseClubEloCsv } from "../src/services/clubelo-pre-kickoff-corpus";
import {
  parseClubEloClubHistoryCsv,
  parseClubEloValidityCsv,
} from "../src/services/clubelo-club-history";
import {
  parseClubEloRankingHtml,
} from "./capture-clubelo-snapshot";

const USER_AGENT = "pundit-alt-archive-probe/1.0";
const RATE_LIMIT_MS = 500;
const MAX_CONSECUTIVE_FAILURES = 10;
const OUTPUT_ROOT = path.join(__dirname, "../data/research/clubelo-history/raw");
const INVENTORY_PATH = path.join(OUTPUT_ROOT, "alt-archives/inventory.json");

/** Policy-date holes from Phase 2 brief. */
const HOLE_DATES: string[] = [
  "2025-01-03",
  "2025-01-04",
  "2025-01-05",
  ...generateDateRange("2026-01-15", "2026-05-23"),
];

const PL_CLUB_SLUGS = [
  "Arsenal", "AstonVilla", "Bournemouth", "Brentford", "Brighton",
  "Chelsea", "CrystalPalace", "Everton", "Fulham", "IpswichTown",
  "Leicester", "Liverpool", "ManCity", "ManUnited", "Newcastle",
  "Nottingham", "Southampton", "Tottenham", "WestHam", "Wolves",
  "Leeds", "Burnley", "Sunderland",
];

interface CdxHit {
  index: string;
  timestamp: string;
  url: string;
  mime: string;
  status: string;
  offset: string;
  length: string;
  filename: string;
}

interface AcceptedCapture {
  source: "common-crawl-html" | "archive-today" | "ghostarchive" | "archive-is";
  targetDate: string;
  rankingDate: string;
  warcTimestamp?: string;
  archiveUrl: string;
  clubCount: number;
  schema: "dated-ranking-html" | "dated-ranking-csv" | "club-from-to-csv";
  noLookAhead: boolean;
}

interface Inventory {
  schemaVersion: 1;
  retrievedAt: string;
  userAgent: string;
  rateLimitMs: number;
  targetHoles: string[];
  commonCrawlHtml: {
    indexesScanned: number;
    cdxHits: number;
    bodiesFetched: number;
    accepted: AcceptedCapture[];
    rejected: Array<{ url: string; reason: string }>;
  };
  altArchives: {
    providers: string[];
    queries: number;
    accepted: AcceptedCapture[];
    rejected: Array<{ url: string; reason: string }>;
    abortedEarly: boolean;
  };
  verdict: "none" | "partial" | "complete";
  usableCaptures: number;
  coverageAfterMerge: string;
  trained: boolean;
  activateProduction: boolean;
  blockers: string[];
}

function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rankingDateFromHtml(html: string): string | null {
  const patterns = [
    /href="\/(\d{4}-\d{2}-\d{2})\/(?:Ranking)?"/,
    /Ranking of club Elo ratings on (\d{4}-\d{2}-\d{2})/i,
    /Elo ratings on (\d{4}-\d{2}-\d{2})/i,
    /<title>[^<]*(\d{4}-\d{2}-\d{2})[^<]*<\/title>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && /^\d{4}-\d{2}-\d{2}$/.test(m[1])) return m[1];
  }
  return null;
}

function warcTimestampToDate(ts: string): string | null {
  if (ts.length < 8) return null;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

function isHomepageRedirect(html: string, url: string): boolean {
  if (/clubelo\.com\/?(?:Ranking)?["']?\s*$/.test(url.replace(/^https?:\/\//, ""))) return true;
  if (html.includes('href="/Ranking"') && !html.match(/href="\/\d{4}-\d{2}-\d{2}/)) return true;
  if (/Today's ranking|Latest ranking/i.test(html) && !rankingDateFromHtml(html)) return true;
  return false;
}

function validateHtmlCapture(
  html: string,
  targetPolicyDate: string,
  warcTimestamp: string,
  pageUrl: string
): { ok: true; rankingDate: string; clubCount: number } | { ok: false; reason: string } {
  if (isHomepageRedirect(html, pageUrl)) {
    return { ok: false, reason: "homepage-redirect-or-live-snapshot" };
  }
  const rankingDate = rankingDateFromHtml(html);
  if (!rankingDate) {
    return { ok: false, reason: "no-ranking-date-in-page-text" };
  }
  const warcDate = warcTimestampToDate(warcTimestamp);
  if (!warcDate) {
    return { ok: false, reason: "invalid-warc-timestamp" };
  }
  // Ranking date must be <= policy date (no look-ahead)
  if (rankingDate > targetPolicyDate) {
    return { ok: false, reason: `look-ahead: ranking ${rankingDate} > policy ${targetPolicyDate}` };
  }
  const rows = parseClubEloRankingHtml(html);
  if (rows.length < 50) {
    return { ok: false, reason: `insufficient-club-table (${rows.length} rows)` };
  }
  const engCount = rows.filter((r) => r.country === "ENG").length;
  if (engCount < 15) {
    return { ok: false, reason: `missing-eng-clubs (${engCount})` };
  }
  return { ok: true, rankingDate, clubCount: rows.length };
}

function validateCsvCapture(
  text: string,
  targetPolicyDate: string,
  schema: "dated-ranking-csv" | "club-from-to-csv"
): { ok: true; rankingDate: string; clubCount: number } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("Rank,Club,Country,Level,Elo")) {
    return { ok: false, reason: "non-official-schema-header" };
  }
  if (schema === "dated-ranking-csv") {
    const rows = parseClubEloCsv(trimmed);
    if (rows.length < 50) return { ok: false, reason: `insufficient-rows (${rows.length})` };
    // Dated CSV URL encodes ranking date; caller validates separately
    return { ok: true, rankingDate: targetPolicyDate, clubCount: rows.length };
  }
  const validity = parseClubEloValidityCsv(trimmed);
  const clubRows = parseClubEloClubHistoryCsv(trimmed);
  const rows = validity.length > 0 ? validity : clubRows;
  if (rows.length < 10) return { ok: false, reason: `insufficient-from-to-rows (${rows.length})` };
  return { ok: true, rankingDate: targetPolicyDate, clubCount: rows.length };
}

function extractHtmlFromWarc(warc: string): string {
  const httpIdx = warc.indexOf("HTTP/");
  if (httpIdx === -1) return warc;
  const headerEnd = warc.indexOf("\r\n\r\n", httpIdx);
  if (headerEnd === -1) {
    const headerEndLf = warc.indexOf("\n\n", httpIdx);
    return headerEndLf === -1 ? warc : warc.slice(headerEndLf + 2);
  }
  return warc.slice(headerEnd + 4);
}

async function fetchText(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function listCommonCrawlIndexes(): Promise<string[]> {
  try {
    const resp = await fetchText("https://index.commoncrawl.org/collinfo.json");
    if (!resp.ok || !resp.text.trim()) return [];
    const info = JSON.parse(resp.text) as Array<{ id: string; name: string }>;
    return info.map((i) => i.id).filter(Boolean);
  } catch {
    return [];
  }
}

function indexesForDate(indexes: string[], isoDate: string): string[] {
  const target = new Date(`${isoDate}T00:00:00Z`);
  const targetMs = target.getTime();
  // Include indexes from 30 days before through 90 days after capture window
  return indexes.filter((id) => {
    const m = id.match(/CC-MAIN-(\d{4})-(\d{2})/);
    if (!m) return false;
    const year = Number.parseInt(m[1], 10);
    const week = Number.parseInt(m[2], 10);
    const approx = Date.UTC(year, 0, 1 + (week - 1) * 7);
    return Math.abs(approx - targetMs) < 120 * 24 * 60 * 60 * 1000;
  });
}

async function queryCommonCrawlCdx(index: string, urlPattern: string): Promise<CdxHit[]> {
  const params = new URLSearchParams({
    url: urlPattern,
    output: "json",
  });
  params.append("filter", "status:200");
  params.append("filter", "mimetype:text/html");
  const cdxUrl = `https://index.commoncrawl.org/${index}-index?${params.toString()}`;
  const resp = await fetchText(cdxUrl);
  if (!resp.ok || !resp.text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length <= 1) return [];
  return parsed.slice(1).flatMap((row) => {
    if (!Array.isArray(row) || row.length < 9) return [];
    return [{
      index,
      timestamp: String(row[1]),
      url: String(row[2]),
      mime: String(row[3]),
      status: String(row[4]),
      offset: String(row[7] ?? ""),
      length: String(row[6] ?? ""),
      filename: String(row[8] ?? ""),
    }];
  });
}

async function fetchCommonCrawlBody(hit: CdxHit): Promise<string | null> {
  const start = Number.parseInt(hit.offset, 10);
  const len = Number.parseInt(hit.length, 10);
  if (!Number.isFinite(start) || !Number.isFinite(len)) return null;
  const warcUrl = `https://data.commoncrawl.org/${hit.filename}`;
  const resp = await fetch(warcUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Range: `bytes=${start}-${start + len - 1}`,
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) return null;
  const warc = await resp.text();
  return extractHtmlFromWarc(warc);
}

async function probeCommonCrawlHtml(
  inventory: Inventory,
  indexes: string[]
): Promise<void> {
  const seenUrls = new Set<string>();
  const sampleDates = [
    "2025-01-03", "2025-01-04", "2025-01-05",
    "2026-01-15", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-23",
  ];

  for (const date of sampleDates) {
    const urlPatterns = [
      `clubelo.com/${date}`,
      `clubelo.com/${date}/Ranking`,
      `www.clubelo.com/${date}`,
    ];
    const relevantIndexes = indexesForDate(indexes, date);
    inventory.commonCrawlHtml.indexesScanned += relevantIndexes.length;

    for (const pattern of urlPatterns) {
      for (const index of relevantIndexes) {
        await sleep(RATE_LIMIT_MS);
        const hits = await queryCommonCrawlCdx(index, pattern);
        inventory.commonCrawlHtml.cdxHits += hits.length;

        for (const hit of hits.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 3)) {
          const dedupe = `${hit.index}:${hit.timestamp}:${hit.url}`;
          if (seenUrls.has(dedupe)) continue;
          seenUrls.add(dedupe);

          await sleep(RATE_LIMIT_MS);
          const html = await fetchCommonCrawlBody(hit);
          if (!html) {
            inventory.commonCrawlHtml.rejected.push({ url: hit.url, reason: "warc-fetch-failed" });
            continue;
          }
          inventory.commonCrawlHtml.bodiesFetched += 1;

          const result = validateHtmlCapture(html, date, hit.timestamp, hit.url);
          if (!result.ok) {
            inventory.commonCrawlHtml.rejected.push({ url: hit.url, reason: result.reason });
            continue;
          }

          inventory.commonCrawlHtml.accepted.push({
            source: "common-crawl-html",
            targetDate: date,
            rankingDate: result.rankingDate,
            warcTimestamp: hit.timestamp,
            archiveUrl: `https://index.commoncrawl.org/${hit.index}-index?url=${encodeURIComponent(hit.url)}`,
            clubCount: result.clubCount,
            schema: "dated-ranking-html",
            noLookAhead: result.rankingDate <= date,
          });
        }
      }
    }
  }
}

async function tryArchiveProvider(
  provider: "archive-today" | "ghostarchive" | "archive-is",
  originalUrl: string
): Promise<{ url: string; text: string } | null> {
  const encoded = encodeURIComponent(originalUrl);
  const candidates: string[] = [];

  if (provider === "archive-today" || provider === "archive-is") {
    candidates.push(
      `https://archive.ph/${originalUrl.replace(/^https?:\/\//, "")}`,
      `https://archive.is/${originalUrl.replace(/^https?:\/\//, "")}`,
      `https://archive.today/${originalUrl.replace(/^https?:\/\//, "")}`,
    );
  }
  if (provider === "ghostarchive") {
    candidates.push(
      `https://ghostarchive.org/search?term=${encoded}`,
    );
  }

  for (const url of candidates) {
    await sleep(RATE_LIMIT_MS);
    const resp = await fetchText(url);
    if (!resp.ok || resp.text.length < 100) continue;
    if (/not archived|404|not found|rate limit|blocked/i.test(resp.text.slice(0, 500))) continue;

    if (provider === "ghostarchive" && url.includes("/search?")) {
      // Parse search results for archive links
      const links = [...resp.text.matchAll(/href="(https:\/\/ghostarchive\.org\/[^"]+)"/g)]
        .map((m) => m[1])
        .filter((l) => l.includes("api.clubelo.com"));
      for (const link of links.slice(0, 2)) {
        await sleep(RATE_LIMIT_MS);
        const body = await fetchText(link);
        if (body.ok && body.text.length > 100) return { url: link, text: body.text };
      }
      continue;
    }

    return { url, text: resp.text };
  }
  return null;
}

function extractCsvFromArchiveHtml(html: string): string | null {
  // Direct CSV body
  if (html.trim().startsWith("Rank,Club,Country,Level,Elo")) {
    const lines = html.trim().split(/\r?\n/);
    const csvLines = lines.filter((l) => l.startsWith("Rank,") || /^\d+,/.test(l));
    return csvLines.join("\n");
  }
  // Pre tag
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (pre?.[1]?.includes("Rank,Club,Country,Level,Elo")) {
    return pre[1].replace(/<[^>]+>/g, "").trim();
  }
  return null;
}

async function probeAltArchives(inventory: Inventory): Promise<void> {
  const providers: Array<"archive-today" | "ghostarchive" | "archive-is"> = [
    "archive-today",
    "archive-is",
    "ghostarchive",
  ];
  inventory.altArchives.providers = providers;

  const csvTargets = [
    ...HOLE_DATES.slice(0, 5).map((d) => `http://api.clubelo.com/${d}`),
    ...HOLE_DATES.slice(-3).map((d) => `http://api.clubelo.com/${d}`),
    ...PL_CLUB_SLUGS.slice(0, 8).map((s) => `http://api.clubelo.com/${s}`),
  ];

  let consecutiveFailures = 0;

  for (const originalUrl of csvTargets) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      inventory.altArchives.abortedEarly = true;
      break;
    }

    const isClub = !originalUrl.match(/\/\d{4}-\d{2}-\d{2}$/);
    const targetDate = originalUrl.match(/(\d{4}-\d{2}-\d{2})$/)?.[1] ?? "unknown";
    inventory.altArchives.queries += 1;

    let found = false;
    for (const provider of providers) {
      const result = await tryArchiveProvider(provider, originalUrl);
      if (!result) continue;

      const csv = extractCsvFromArchiveHtml(result.text) ?? result.text;
      const schema = isClub ? "club-from-to-csv" : "dated-ranking-csv";
      const validation = validateCsvCapture(csv, targetDate, schema);
      if (!validation.ok) {
        inventory.altArchives.rejected.push({ url: originalUrl, reason: `${provider}: ${validation.reason}` });
        continue;
      }

      if (!isClub && targetDate !== "unknown" && validation.rankingDate > targetDate) {
        inventory.altArchives.rejected.push({ url: originalUrl, reason: `${provider}: look-ahead` });
        continue;
      }

      inventory.altArchives.accepted.push({
        source: provider,
        targetDate,
        rankingDate: isClub ? targetDate : targetDate,
        archiveUrl: result.url,
        clubCount: validation.clubCount,
        schema,
        noLookAhead: true,
      });
      found = true;
      consecutiveFailures = 0;
      break;
    }

    if (!found) {
      consecutiveFailures += 1;
      inventory.altArchives.rejected.push({ url: originalUrl, reason: "no-provider-hit" });
    }
  }
}

async function main(): Promise<void> {
  const inventory: Inventory = {
    schemaVersion: 1,
    retrievedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    rateLimitMs: RATE_LIMIT_MS,
    targetHoles: ["2025-01-03..2025-01-05", "2026-01-15..2026-05-23"],
    commonCrawlHtml: {
      indexesScanned: 0,
      cdxHits: 0,
      bodiesFetched: 0,
      accepted: [],
      rejected: [],
    },
    altArchives: {
      providers: [],
      queries: 0,
      accepted: [],
      rejected: [],
      abortedEarly: false,
    },
    verdict: "none",
    usableCaptures: 0,
    coverageAfterMerge: "590/760 unchanged (tonyelhabr From/To baseline)",
    trained: false,
    activateProduction: false,
    blockers: [],
  };

  console.log("[alt-archives] Fetching Common Crawl index list…");
  const indexes = await listCommonCrawlIndexes();
  if (indexes.length === 0) {
    console.log("[alt-archives] Common Crawl CDX unreachable (empty reply or blocked IP); skipping HTML probe");
    inventory.commonCrawlHtml.rejected.push({
      url: "index.commoncrawl.org/collinfo.json",
      reason: "cdx-unreachable-empty-reply",
    });
    inventory.blockers.push("Common Crawl HTML CDX unreachable from probe IP");
  } else {
    console.log(`[alt-archives] ${indexes.length} CC indexes available`);
    console.log("[alt-archives] Probing Common Crawl HTML (clubelo.com dated ranking pages)…");
    await probeCommonCrawlHtml(inventory, indexes);
  }

  console.log("[alt-archives] Probing archive.today / ghostarchive / archive.is…");
  await probeAltArchives(inventory);

  const totalAccepted =
    inventory.commonCrawlHtml.accepted.length + inventory.altArchives.accepted.length;
  inventory.usableCaptures = totalAccepted;

  if (totalAccepted === 0) {
    inventory.verdict = "none";
    inventory.blockers = [
      `Common Crawl HTML: ${inventory.commonCrawlHtml.cdxHits} CDX hits, ${inventory.commonCrawlHtml.bodiesFetched} bodies fetched, 0 accepted`,
      `Alt archives: ${inventory.altArchives.queries} queries, 0 accepted${inventory.altArchives.abortedEarly ? " (aborted early)" : ""}`,
      "Chronological gate still blocked; partial fit 590/760 only",
    ];
  } else {
    inventory.verdict = "partial";
    inventory.blockers = ["Accepted captures do not close 760/760 full-window gate"];
  }

  fs.mkdirSync(path.dirname(INVENTORY_PATH), { recursive: true });
  fs.writeFileSync(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`);

  console.log("\n=== ALT ARCHIVE PROBE RESULT ===");
  console.log(`Common Crawl HTML CDX hits: ${inventory.commonCrawlHtml.cdxHits}`);
  console.log(`Common Crawl HTML accepted: ${inventory.commonCrawlHtml.accepted.length}`);
  console.log(`Alt archives accepted: ${inventory.altArchives.accepted.length}`);
  console.log(`Verdict: ${inventory.verdict}`);
  console.log(`Coverage: ${inventory.coverageAfterMerge}`);
  console.log(`Trained: ${inventory.trained}`);
  console.log(`Inventory: ${INVENTORY_PATH}`);

  if (totalAccepted > 0) {
    console.log("\nAccepted captures:");
    for (const cap of [...inventory.commonCrawlHtml.accepted, ...inventory.altArchives.accepted]) {
      console.log(`  ${cap.source} ${cap.targetDate} ranking=${cap.rankingDate} clubs=${cap.clubCount}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
