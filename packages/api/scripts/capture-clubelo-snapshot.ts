import fs from "node:fs";
import path from "node:path";
import { canonicalClubName } from "../src/lib/team-names";
import { RatingProfile } from "../src/config/competitions";

/**
 * Offline reviewed-release capture. Runtime model code must never import this
 * file or contact ClubElo.
 *
 * Usage: capture-clubelo-snapshot <ratings-snapshot.json>
 *
 * Prefers the documented CSV API. When that endpoint is unavailable, falls
 * back to ClubElo's published ranking page for the same dated snapshot.
 *
 * This script is one calendar snapshot for the production strength artifact.
 * Chronological pre-kickoff ratings are a separate reviewed pipeline:
 * capture-clubelo-history + build-clubelo-pre-kickoff-corpus. Do not use
 * today's ranking HTML as a historical ranking.
 */
const CLUBELO_CSV_BASE = "http://api.clubelo.com";
const CLUBELO_SITE = "https://clubelo.com";
const LOOKBACK_DAYS = 14;
const MIN_ROWS = 10;
const USER_AGENT = "Mozilla/5.0 (compatible; pundit-release-capture/1.0)";

interface ClubEloRow {
  club: string;
  country: string;
  elo: number;
}

const outputPath = process.argv[2];

function formatClubEloDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugToClubEloName(slug: string): string {
  if (slug.includes("-") && slug === slug.toLowerCase()) return slug;
  return slug.replace(/(?<=[a-z])(?=[A-Z])/g, " ");
}

export function parseClubEloCsv(text: string): ClubEloRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  const rows: ClubEloRow[] = [];
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

export function parseClubEloRankingHtml(html: string): ClubEloRow[] {
  const vegaByName = new Map<string, number>();
  const objectPattern = /\{\s*"Colour"[\s\S]*?"Name":\s*"((?:\\.|[^"\\])*)"[\s\S]*?\}/g;
  for (const match of html.matchAll(objectPattern)) {
    const blob = match[0];
    const nameMatch = blob.match(/"Name":\s*"((?:\\.|[^"\\])*)"/);
    const eloMatch = blob.match(/"Elo":\s*([0-9.]+)/);
    if (!nameMatch || !eloMatch) continue;
    const name = JSON.parse(`"${nameMatch[1]}"`) as string;
    vegaByName.set(name, Number.parseFloat(eloMatch[1]));
  }

  const rows: ClubEloRow[] = [];
  const seen = new Set<string>();
  for (const fragment of html.split("<tr")) {
    const flagMatch = fragment.match(/<img alt="([A-Z]{3})"/);
    const clubMatch = fragment.match(
      /href="\/([^"]+)"><span class="NonAst">[^<]*<\/span><span class="Ast">([^<]+)<\/span><\/a><\/td><td class="r">(\d+)<\/td>/
    );
    if (!flagMatch || !clubMatch) continue;
    const country = flagMatch[1];
    const slug = clubMatch[1];
    const astName = clubMatch[2]
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .trim();
    const integerElo = Number.parseInt(clubMatch[3], 10);
    const club = canonicalClubName(slugToClubEloName(slug)) || astName;
    const precise = vegaByName.get(club)
      ?? vegaByName.get(astName)
      ?? vegaByName.get(slugToClubEloName(slug));
    const elo = precise ?? integerElo;
    if (!club || !Number.isFinite(elo) || seen.has(`${country}:${club}`)) continue;
    seen.add(`${country}:${club}`);
    rows.push({ club, country, elo });
  }
  return rows;
}

function rankingDateFromHtml(html: string): string | null {
  const match = html.match(/href="\/(\d{4}-\d{2}-\d{2})\/(?:Ranking)?"/);
  return match?.[1] ?? null;
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

async function captureFromHtml(referenceDate: Date): Promise<{ rankingDate: string; rows: ClubEloRow[] }> {
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
      const rankingDate = rankingDateFromHtml(response.text) ?? formatClubEloDate(referenceDate);
      if (rows.length >= MIN_ROWS) return { rankingDate, rows };
      lastError = new Error(`ClubElo HTML ${url} returned only ${rows.length} clubs`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("ClubElo published ranking is unavailable");
}

async function main(): Promise<void> {
  if (!outputPath) {
    throw new Error("Usage: capture-clubelo-snapshot <ratings-snapshot.json>");
  }
  const retrievedAt = new Date();
  const captured = await captureFromCsv(retrievedAt) ?? await captureFromHtml(retrievedAt);
  const byProfile = buildProfileMaps(captured.rows);
  const snapshot = {
    fetchedAt: retrievedAt.toISOString(),
    clubEloRankingDate: captured.rankingDate,
    byProfile,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, outputPath);
  console.log(JSON.stringify({
    outputPath,
    fetchedAt: snapshot.fetchedAt,
    clubEloRankingDate: captured.rankingDate,
    sourceRows: captured.rows.length,
    engClubs: Object.keys(byProfile["eng-clubs"]).length,
    uefaClubs: Object.keys(byProfile["uefa-clubs"]).length,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
