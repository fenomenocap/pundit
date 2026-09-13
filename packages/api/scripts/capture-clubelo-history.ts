import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { HISTORICAL_SEASON_SPECS } from "../src/services/club-history-corpus";
import {
  iterateUtcDates,
  parseClubEloCsv,
  uniqueRankingDatesForFixtures,
} from "../src/services/clubelo-pre-kickoff-corpus";
import type { HistoricalFixture } from "../src/services/club-history-corpus";
import {
  CLUBELO_CSV_MIN_ROWS,
  CLUBELO_HISTORY_USER_AGENT,
  fetchLiveClubEloCsv,
  fetchWaybackClubEloCsv,
  listWaybackDatedCsvInventory,
  type ClubEloCsvFetchResult,
  type WaybackCdxRow,
} from "../src/services/clubelo-wayback";

/**
 * Offline reviewed ClubElo history capture. Runtime model code must never
 * import this file or contact ClubElo or Wayback.
 *
 * Dated CSV only. Prefers the live `api.clubelo.com/YYYY-MM-DD` API, then
 * Internet Archive Wayback for that same calendar date. The live ranking HTML
 * page is today's snapshot and must not be used as a historical ranking.
 *
 * Usage:
 *   capture-clubelo-history --from 2024-07-31 --to 2026-06-30
 *   capture-clubelo-history --dates-from-specs
 *   capture-clubelo-history --dates-from-corpus
 *   capture-clubelo-history --dates-from-corpus --limit 12
 *   capture-clubelo-history --dates-from-corpus --delay-ms 1000
 */
const OUTPUT_ROOT = path.join(__dirname, "../data/research/clubelo-history");
const FETCH_TIMEOUT_MS = 30_000;
const WAYBACK_INVENTORY_RETRIES = 3;

interface CaptureIndex {
  schemaVersion: 1;
  provider: "clubelo";
  lookupPolicy: "latest-ranking-strictly-before-kickoff-utc-date";
  citation: "clubelo-about";
  retrievalCitation?: "internet-archive-wayback";
  rightsStatus: "citation-required-use-review";
  rankings: Array<{
    rankingDate: string;
    sourceUrl: string;
    originalUrl?: string;
    retrievedAt: string;
    rawSha256: string;
    rawPath: string;
    clubCount: number;
    captureSource?: ClubEloCsvFetchResult["captureSource"];
    waybackTimestamp?: string;
  }>;
  missingDates: string[];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function argInt(flag: string, fallback: number): number {
  const raw = argValue(flag);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function atomicWrite(filePath: string, value: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filePath);
}

function readIndex(): CaptureIndex {
  const indexPath = path.join(OUTPUT_ROOT, "index.json");
  if (!fs.existsSync(indexPath)) {
    return {
      schemaVersion: 1,
      provider: "clubelo",
      lookupPolicy: "latest-ranking-strictly-before-kickoff-utc-date",
      citation: "clubelo-about",
      retrievalCitation: "internet-archive-wayback",
      rightsStatus: "citation-required-use-review",
      rankings: [],
      missingDates: [],
    };
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as CaptureIndex;
}

function loadClubHistoryFixtures(): HistoricalFixture[] {
  const latestPath = path.join(__dirname, "../data/research/club-history/latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error("Club-history latest.json is missing. Run build:club-history first.");
  }
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8")) as {
    manifestPath: string;
  };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/research/club-history", latest.manifestPath), "utf8")
  ) as { datasetPath: string };
  const dataset = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/research/club-history", manifest.datasetPath), "utf8")
  ) as { seasons: Array<{ fixtures: HistoricalFixture[] }> };
  return dataset.seasons.flatMap((season) => season.fixtures);
}

function datesFromSpecs(): string[] {
  const dates = new Set<string>();
  for (const spec of HISTORICAL_SEASON_SPECS) {
    const [start, end] = spec.dateRange.split("-");
    const startIso = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`;
    const endIso = `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`;
    const rangeStart = new Date(`${startIso}T00:00:00Z`);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
    const captureFrom = `${rangeStart.getUTCFullYear()}-${String(rangeStart.getUTCMonth() + 1).padStart(2, "0")}-${String(rangeStart.getUTCDate()).padStart(2, "0")}`;
    for (const date of iterateUtcDates(captureFrom, endIso)) {
      dates.add(date);
    }
  }
  return [...dates].sort();
}

function requestedDates(): string[] {
  if (hasFlag("dates-from-corpus")) {
    return uniqueRankingDatesForFixtures(loadClubHistoryFixtures().map((fixture) => ({
      sourceEventId: fixture.sourceEventId,
      competitionId: fixture.competitionId,
      seasonId: fixture.seasonId,
      kickoff: fixture.kickoff,
      homeCanonicalName: fixture.home.canonicalName,
      awayCanonicalName: fixture.away.canonicalName,
      trainingEligible: fixture.trainingEligible,
    })));
  }
  if (hasFlag("dates-from-specs")) return datesFromSpecs();
  const from = argValue("from");
  const to = argValue("to");
  if (!from || !to) {
    throw new Error(
      "Usage: capture-clubelo-history --from YYYY-MM-DD --to YYYY-MM-DD"
      + " | --dates-from-specs | --dates-from-corpus"
    );
  }
  return iterateUtcDates(from, to);
}

function persistCapture(rankingDate: string, fetched: ClubEloCsvFetchResult): CaptureIndex["rankings"][number] {
  const rows = parseClubEloCsv(fetched.text);
  const rawSha256 = sha256(fetched.raw);
  const rawRelativePath = path.join("raw", "csv", rankingDate, `${rawSha256}.csv.gz`);
  const rawPath = path.join(OUTPUT_ROOT, rawRelativePath);
  if (!fs.existsSync(rawPath)) atomicWrite(rawPath, gzipSync(fetched.raw, { level: 9 }));
  return {
    rankingDate,
    sourceUrl: fetched.sourceUrl,
    originalUrl: fetched.originalUrl,
    retrievedAt: new Date().toISOString(),
    rawSha256,
    rawPath: rawRelativePath,
    clubCount: rows.length,
    captureSource: fetched.captureSource,
    ...(fetched.waybackTimestamp ? { waybackTimestamp: fetched.waybackTimestamp } : {}),
  };
}

async function loadWaybackInventory(): Promise<{
  captures: Map<string, WaybackCdxRow>;
  status: string;
  reason?: string;
}> {
  for (let attempt = 1; attempt <= WAYBACK_INVENTORY_RETRIES; attempt += 1) {
    const inventory = await listWaybackDatedCsvInventory(fetch, FETCH_TIMEOUT_MS);
    if (inventory.status !== "unavailable") {
      return {
        captures: inventory.captures,
        status: inventory.status,
      };
    }
    console.warn(
      `[capture] Wayback CDX inventory attempt ${attempt}/${WAYBACK_INVENTORY_RETRIES} failed`
      + `${inventory.reason ? ` (${inventory.reason})` : ""}.`
    );
    if (attempt < WAYBACK_INVENTORY_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
    } else {
      return { captures: new Map(), status: "unavailable", reason: inventory.reason };
    }
  }
  return { captures: new Map(), status: "unavailable" };
}

async function main(): Promise<void> {
  const dates = requestedDates();
  const dryRun = hasFlag("dry-run");
  const delayMs = Number.parseInt(argValue("delay-ms") ?? "0", 10);
  const limit = argValue("limit") ? argInt("limit", dates.length) : Number.POSITIVE_INFINITY;
  const maxConsecutiveFailures = argInt("max-consecutive-failures", 10);
  const index = readIndex();
  const captured = new Map(index.rankings.map((entry) => [entry.rankingDate, entry]));
  const missing = new Set(index.missingDates);

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      dateCount: dates.length,
      alreadyCaptured: dates.filter((date) => captured.has(date)).length,
      limit: Number.isFinite(limit) ? limit : null,
      dates: Number.isFinite(limit) ? dates.slice(0, limit) : dates,
      userAgent: CLUBELO_HISTORY_USER_AGENT,
    }, null, 2));
    return;
  }

  const wayback = await loadWaybackInventory();
  const waybackDates = dates.filter((date) => wayback.captures.has(date));
  console.warn(JSON.stringify({
    waybackInventory: wayback.status,
    waybackDatedCsvDays: wayback.captures.size,
    waybackRankingDates: [...wayback.captures.keys()].sort(),
    corpusDatesWithWaybackCsv: waybackDates,
    reason: wayback.reason ?? null,
  }));

  let attempted = 0;
  let consecutiveLiveFailures = 0;
  let consecutiveWaybackFailures = 0;
  let liveDisabled = false;
  let aborted = false;

  for (const rankingDate of dates) {
    if (captured.has(rankingDate)) continue;
    if (attempted >= limit) break;
    attempted += 1;
    let fetched: ClubEloCsvFetchResult | null = null;

    if (!liveDisabled) {
      fetched = await fetchLiveClubEloCsv(rankingDate, fetch, FETCH_TIMEOUT_MS);
      if (fetched) {
        consecutiveLiveFailures = 0;
      } else {
        consecutiveLiveFailures += 1;
        if (consecutiveLiveFailures >= maxConsecutiveFailures) {
          liveDisabled = true;
          console.warn(
            `[capture] disabling remaining live ClubElo requests after ${maxConsecutiveFailures} consecutive failures.`
          );
        }
      }
    }

    const waybackRow = wayback.captures.get(rankingDate);
    if (!fetched && waybackRow) {
      try {
        fetched = await fetchWaybackClubEloCsv(rankingDate, waybackRow, fetch, FETCH_TIMEOUT_MS);
        consecutiveWaybackFailures = 0;
      } catch (error) {
        consecutiveWaybackFailures += 1;
        console.warn(
          `[capture] ${rankingDate} Wayback: ${error instanceof Error ? error.message : String(error)}`
        );
        if (consecutiveWaybackFailures >= maxConsecutiveFailures) {
          aborted = true;
          console.warn(
            `[capture] aborting after ${maxConsecutiveFailures} consecutive Wayback failures. `
            + "Ratings are not invented."
          );
        }
      }
    }

    if (fetched && parseClubEloCsv(fetched.text).length >= CLUBELO_CSV_MIN_ROWS) {
      captured.set(rankingDate, persistCapture(rankingDate, fetched));
      missing.delete(rankingDate);
    } else {
      missing.add(rankingDate);
      if (fetched) {
        console.warn(`[capture] ${rankingDate} returned a body that is not a ClubElo ranking CSV; not inventing ratings.`);
      } else if (!waybackRow && !liveDisabled) {
        console.warn(`[capture] ${rankingDate}: live unavailable; no Wayback CSV for that calendar date.`);
      }
    }

    if (aborted) break;
    const didNetwork = !liveDisabled || Boolean(waybackRow);
    if (delayMs > 0 && didNetwork) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const nextIndex: CaptureIndex = {
    ...index,
    retrievalCitation: "internet-archive-wayback",
    rankings: [...captured.values()].sort((a, b) => a.rankingDate.localeCompare(b.rankingDate)),
    missingDates: [...missing].sort(),
  };
  atomicWrite(path.join(OUTPUT_ROOT, "index.json"), `${JSON.stringify(nextIndex, null, 2)}\n`);
  console.log(JSON.stringify({
    capturedDays: nextIndex.rankings.length,
    waybackCapturedDays: nextIndex.rankings.filter((entry) => entry.captureSource === "internet-archive-wayback").length,
    liveCapturedDays: nextIndex.rankings.filter((entry) => entry.captureSource === "clubelo-live-api").length,
    missingDays: nextIndex.missingDates.length,
    requestedDays: dates.length,
    attemptedThisRun: attempted,
    liveDisabled,
    aborted,
    waybackInventory: wayback.status,
    resumeCommand: "pnpm --filter @sports-predict/api capture:clubelo-history -- --dates-from-corpus --delay-ms 1000",
    indexPath: path.join(OUTPUT_ROOT, "index.json"),
  }, null, 2));
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
