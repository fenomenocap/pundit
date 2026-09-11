/**
 * Diagnose whether missing PL pre-kickoff joins are true ClubElo holes or join bugs.
 * Does NOT load the full CSV into memory as a string — streams line-by-line.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { canonicalClubName } from "../src/lib/team-names";
import type { HistoricalFixture } from "../src/services/club-history-corpus";
import {
  eloOnUtcDateFromValidityRows,
  indexClubEloValidityRows,
  parseClubEloValidityCsv,
  type ClubEloValidityRow,
} from "../src/services/clubelo-club-history";
import {
  joinFixturesWithFromToElo,
  rankingDateForKickoff,
  type PreKickoffEloFixtureInput,
} from "../src/services/clubelo-pre-kickoff-corpus";

const HISTORY_ROOT = path.join(__dirname, "../data/research/club-history");
const TONYELHABR_CSV = path.join(
  __dirname,
  "../data/research/clubelo-history/raw/tonyelhabr/clubelo-club-rankings.csv"
);

function loadPlFixtures(): PreKickoffEloFixtureInput[] {
  const latest = JSON.parse(
    fs.readFileSync(path.join(HISTORY_ROOT, "latest.json"), "utf8")
  ) as { manifestPath: string };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HISTORY_ROOT, latest.manifestPath), "utf8")
  ) as { datasetPath: string };
  const dataset = JSON.parse(
    fs.readFileSync(path.join(HISTORY_ROOT, manifest.datasetPath), "utf8")
  ) as { seasons: Array<{ fixtures: HistoricalFixture[] }> };
  return dataset.seasons
    .flatMap((s) => s.fixtures)
    .filter((f) => f.competitionId === "eng.1" && f.trainingEligible !== false)
    .map((f) => ({
      sourceEventId: f.sourceEventId,
      competitionId: f.competitionId,
      seasonId: f.seasonId,
      kickoff: f.kickoff,
      homeCanonicalName: f.home.canonicalName,
      awayCanonicalName: f.away.canonicalName,
      trainingEligible: f.trainingEligible,
    }));
}

/** Stream-query: any row for club with From<=policyDate<=To (inclusive). */
async function queryDumpForClub(
  clubRaw: string,
  policyDate: string
): Promise<Array<{ from: string; to: string; elo: number; scrapeDate?: string }>> {
  const canonical = canonicalClubName(clubRaw);
  const matches: Array<{ from: string; to: string; elo: number; scrapeDate?: string }> = [];
  const stream = fs.createReadStream(TONYELHABR_CSV, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 7) continue;
    const club = parts[1]?.trim();
    if (canonicalClubName(club) !== canonical) continue;
    const from = parts[5]?.trim();
    const to = parts[6]?.trim();
    if (!from || !to || from > policyDate || policyDate > to) continue;
    const elo = Number.parseFloat(parts[4]);
    if (!Number.isFinite(elo)) continue;
    const scrapeDate = parts[7]?.trim();
    matches.push({
      from,
      to,
      elo,
      ...(scrapeDate && /^\d{4}-\d{2}-\d{2}$/.test(scrapeDate) ? { scrapeDate } : {}),
    });
  }
  return matches;
}

function diagnoseJoinFailure(
  rows: ClubEloValidityRow[],
  clubName: string,
  policyDate: string
): string {
  const byClub = indexClubEloValidityRows(rows);
  const canonical = canonicalClubName(clubName);
  const clubRows = byClub.get(canonical);
  if (!clubRows || clubRows.length === 0) return `no rows indexed for canonical "${canonical}"`;
  const covering = clubRows.filter((r) => r.from <= policyDate && policyDate <= r.to);
  if (covering.length === 0) {
    const nearest = clubRows
      .map((r) => ({ ...r, gap: policyDate < r.from ? r.from : r.to }))
      .sort((a, b) => Math.abs(Date.parse(`${policyDate}T00:00:00Z`) - Date.parse(`${a.gap}T00:00:00Z`))
        - Math.abs(Date.parse(`${policyDate}T00:00:00Z`) - Date.parse(`${b.gap}T00:00:00Z`)));
    const n = nearest[0];
    return `no covering window; nearest ${n.from}..${n.to} (scrape ${n.scrapeDate ?? "?"})`;
  }
  const result = eloOnUtcDateFromValidityRows(clubRows, policyDate);
  if (result) return `join OK: Elo=${result.elo} window ${result.windowFrom}..${result.windowTo}`;
  const observedBefore = covering.filter((r) => !r.scrapeDate || r.scrapeDate <= policyDate);
  const elos = new Set(covering.map((r) => Math.round(r.elo * 100) / 100));
  if (observedBefore.length === 0 && covering.length > 0) {
    return `covering rows exist but all scrapeDates > policyDate (${covering.length} rows); fallback may conflict`;
  }
  if (elos.size > 1) return `conflicting Elo at latest scrape: ${[...elos].join(", ")} (${covering.length} covering)`;
  return `unknown join failure (${covering.length} covering)`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(TONYELHABR_CSV)) {
    throw new Error(`Missing dump: ${TONYELHABR_CSV}`);
  }

  console.log("Loading dump via parseClubEloValidityCsv (may take ~30s)...");
  const t0 = Date.now();
  const validityRows = parseClubEloValidityCsv(fs.readFileSync(TONYELHABR_CSV, "utf8"));
  console.log(`Parsed ${validityRows.length} validity rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const fixtures = loadPlFixtures();
  const { rows, missing } = joinFixturesWithFromToElo(fixtures, validityRows);
  const coveredIds = new Set(rows.map((r) => r.sourceEventId));
  const missingFixtures = fixtures.filter((f) => !coveredIds.has(f.sourceEventId));

  console.log("\n=== COVERAGE ===");
  console.log(`PL fixtures: ${fixtures.length}, covered: ${rows.length}, missing: ${missingFixtures.length}`);

  const bySeason: Record<string, { n: number; covered: number }> = {};
  for (const f of fixtures) {
    const b = bySeason[f.seasonId] ?? { n: 0, covered: 0 };
    b.n += 1;
    if (coveredIds.has(f.sourceEventId)) b.covered += 1;
    bySeason[f.seasonId] = b;
  }
  for (const [season, stats] of Object.entries(bySeason).sort()) {
    console.log(`  ${season}: ${stats.covered}/${stats.n}`);
  }

  console.log("\n=== MISSING FIXTURES (all) ===");
  for (const f of missingFixtures) {
    const pd = rankingDateForKickoff(f.kickoff)!;
    console.log(`${f.sourceEventId} | ${f.kickoff.slice(0, 10)} kickoff | policyDate=${pd} | ${f.homeCanonicalName} vs ${f.awayCanonicalName}`);
  }

  const christmas = missingFixtures.filter((f) => {
    const pd = rankingDateForKickoff(f.kickoff)!;
    return pd >= "2024-12-20" && pd <= "2025-01-03";
  });
  const postJan14 = missingFixtures.filter((f) => {
    const pd = rankingDateForKickoff(f.kickoff)!;
    return pd >= "2026-01-15" && pd <= "2026-02-08";
  });
  const postFeb08 = missingFixtures.filter((f) => {
    const pd = rankingDateForKickoff(f.kickoff)!;
    return pd > "2026-02-08";
  });

  console.log(`\n=== CLUSTER COUNTS ===`);
  console.log(`Christmas (policy 2024-12-20..2025-01-03): ${christmas.length}`);
  console.log(`Post-scrape through To window (2026-01-15..2026-02-08): ${postJan14.length}`);
  console.log(`After To=2026-02-08 window (policy > 2026-02-08): ${postFeb08.length}`);

  const sampleChristmas = christmas.slice(0, 3);
  const samplePostJan14 = postJan14.slice(0, 5);

  console.log("\n=== CHRISTMAS CLUSTER: dump query + join diagnosis ===");
  for (const f of sampleChristmas) {
    const pd = rankingDateForKickoff(f.kickoff)!;
    console.log(`\nFixture ${f.sourceEventId} (${f.homeCanonicalName} vs ${f.awayCanonicalName}), policyDate=${pd}`);
    for (const club of [f.homeCanonicalName, f.awayCanonicalName]) {
      const dumpRows = await queryDumpForClub(club, pd);
      const diag = diagnoseJoinFailure(validityRows, club, pd);
      console.log(`  ${club}: dump=${dumpRows.length > 0 ? "YES" : "NO"} (${dumpRows.length} rows)`);
      if (dumpRows.length > 0) {
        const sample = dumpRows.slice(0, 2);
        for (const r of sample) {
          console.log(`    From=${r.from} To=${r.to} Elo=${r.elo} scrape=${r.scrapeDate ?? "?"}`);
        }
      }
      console.log(`    join diagnosis: ${diag}`);
    }
  }

  console.log("\n=== POST-2026-01-14 CLUSTER: dump query + join diagnosis ===");
  for (const f of samplePostJan14) {
    const pd = rankingDateForKickoff(f.kickoff)!;
    console.log(`\nFixture ${f.sourceEventId} (${f.homeCanonicalName} vs ${f.awayCanonicalName}), policyDate=${pd}`);
    for (const club of [f.homeCanonicalName, f.awayCanonicalName]) {
      const dumpRows = await queryDumpForClub(club, pd);
      const diag = diagnoseJoinFailure(validityRows, club, pd);
      console.log(`  ${club}: dump=${dumpRows.length > 0 ? "YES" : "NO"} (${dumpRows.length} rows)`);
      if (dumpRows.length > 0) {
        const sample = dumpRows.slice(0, 2);
        for (const r of sample) {
          console.log(`    From=${r.from} To=${r.to} Elo=${r.elo} scrape=${r.scrapeDate ?? "?"}`);
        }
      }
      console.log(`    join diagnosis: ${diag}`);
    }
  }

  // Max To date per PL club in dump
  console.log("\n=== PL CLUB To DATE RANGES IN DUMP ===");
  const plClubs = new Set(fixtures.flatMap((f) => [
    canonicalClubName(f.homeCanonicalName),
    canonicalClubName(f.awayCanonicalName),
  ]));
  const maxToByClub = new Map<string, string>();
  for (const row of validityRows) {
    const c = canonicalClubName(row.club);
    if (!plClubs.has(c)) continue;
    const prev = maxToByClub.get(c);
    if (!prev || row.to > prev) maxToByClub.set(c, row.to);
  }
  const toDates = [...maxToByClub.values()].sort();
  console.log(`Clubs with rows: ${maxToByClub.size}/23`);
  console.log(`Max To across PL clubs: ${toDates.at(-1)}`);
  console.log(`Min max-To across PL clubs: ${toDates[0]}`);
  const clubsWithFeb08 = [...maxToByClub.entries()].filter(([, to]) => to >= "2026-02-08");
  console.log(`Clubs with max To >= 2026-02-08: ${clubsWithFeb08.length}/23`);

  // How many missing would recover if To extended to 2026-02-08 with last known Elo?
  const recoverableToFeb08 = missingFixtures.filter((f) => {
    const pd = rankingDateForKickoff(f.kickoff)!;
    return pd >= "2026-01-15" && pd <= "2026-02-08";
  }).length;
  console.log(`\nMissing with policyDate in 2026-01-15..2026-02-08: ${recoverableToFeb08} (would need From/To windows covering those dates)`);

  console.log("\n=== SUMMARY ===");
  const dumpHasChristmas = sampleChristmas.length > 0
    ? (await Promise.all(sampleChristmas.flatMap((f) => {
      const pd = rankingDateForKickoff(f.kickoff)!;
      return [
        queryDumpForClub(f.homeCanonicalName, pd),
        queryDumpForClub(f.awayCanonicalName, pd),
      ];
    }))).every((rows) => rows.length > 0)
    : null;
  console.log(JSON.stringify({
    bugFound: null,
    coverage: `${rows.length}/${fixtures.length}`,
    bySeason,
    christmasMissing: christmas.length,
    postJan14Missing: postJan14.length,
    postFeb08Missing: postFeb08.length,
    dumpHasRowsForChristmasSamples: dumpHasChristmas,
    clubsWithToGteFeb08: clubsWithFeb08.length,
    extraFixturesIfToFeb08: recoverableToFeb08,
  }, null, 2));
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
