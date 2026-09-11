import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { sha256 } from "../src/services/club-history-corpus";
import type { HistoricalFixture } from "../src/services/club-history-corpus";
import {
  asPointInTimeValidityRows,
  parseClubEloValidityCsv,
  type ClubEloValidityRow,
} from "../src/services/clubelo-club-history";
import {
  CLUBELO_FROM_TO_LOOKUP_POLICY,
  CLUBELO_PRE_KICKOFF_LOOKUP_POLICY,
  CLUBELO_PRE_KICKOFF_SCHEMA_VERSION,
  ClubEloDailyRanking,
  PreKickoffEloFixtureInput,
  buildClubEloProfileMaps,
  joinFixturesWithFromToElo,
  joinFixturesWithPreKickoffElo,
  parseClubEloCsv,
  preKickoffCoverageBySeason,
  validatePreKickoffCorpus,
} from "../src/services/clubelo-pre-kickoff-corpus";

/**
 * Offline join of the ESPN club-history corpus with ClubElo From/To windows
 * (tonyelhabr dump) and optional point-in-time dated rankings. Does not
 * contact ClubElo. Does not invent ratings. Does not use post-corpus
 * production snapshots (2026-08-12 / 2026-09-07).
 */
const HISTORY_ROOT = path.join(__dirname, "../data/research/club-history");
const OUTPUT_ROOT = path.join(__dirname, "../data/research/clubelo-history");
const TONYELHABR_CSV = path.join(OUTPUT_ROOT, "raw/tonyelhabr/clubelo-club-rankings.csv");
const BLOCKED_PRODUCTION_SNAPSHOTS = new Set(["2026-08-12", "2026-09-06", "2026-09-07"]);

function atomicWrite(filePath: string, value: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filePath);
}

function loadHistoryFixtures(): {
  fixtures: HistoricalFixture[];
  datasetSha256: string | null;
} {
  const latestPath = path.join(HISTORY_ROOT, "latest.json");
  if (!fs.existsSync(latestPath)) {
    throw new Error(
      "Club-history latest.json is missing. Run `pnpm --filter @sports-predict/api build:club-history` first."
    );
  }
  const latest = JSON.parse(fs.readFileSync(latestPath, "utf8")) as {
    manifestPath: string;
    datasetSha256?: string;
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(HISTORY_ROOT, latest.manifestPath), "utf8")) as {
    datasetPath: string;
    datasetSha256: string;
  };
  const dataset = JSON.parse(fs.readFileSync(path.join(HISTORY_ROOT, manifest.datasetPath), "utf8")) as {
    seasons: Array<{ fixtures: HistoricalFixture[] }>;
  };
  return {
    fixtures: dataset.seasons.flatMap((season) => season.fixtures),
    datasetSha256: latest.datasetSha256 ?? manifest.datasetSha256,
  };
}

function loadCapturedRankingsSafe(): Map<string, ClubEloDailyRanking> {
  const indexPath = path.join(OUTPUT_ROOT, "index.json");
  if (!fs.existsSync(indexPath)) {
    return new Map();
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
    rankings: Array<{
      rankingDate: string;
      sourceUrl: string;
      retrievedAt: string;
      rawSha256: string;
      rawPath: string;
    }>;
  };
  const rankings = new Map<string, ClubEloDailyRanking>();
  for (const entry of index.rankings) {
    const rawPath = path.join(OUTPUT_ROOT, entry.rawPath);
    const csv = gunzipSync(fs.readFileSync(rawPath)).toString("utf8");
    rankings.set(entry.rankingDate, {
      rankingDate: entry.rankingDate,
      retrievedAt: entry.retrievedAt,
      sourceUrl: entry.sourceUrl,
      sourceSha256: entry.rawSha256,
      byProfile: buildClubEloProfileMaps(parseClubEloCsv(csv)),
    });
  }
  return rankings;
}

function toInputs(fixtures: HistoricalFixture[]): PreKickoffEloFixtureInput[] {
  return fixtures.map((fixture) => ({
    sourceEventId: fixture.sourceEventId,
    competitionId: fixture.competitionId,
    seasonId: fixture.seasonId,
    kickoff: fixture.kickoff,
    homeCanonicalName: fixture.home.canonicalName,
    awayCanonicalName: fixture.away.canonicalName,
    trainingEligible: fixture.trainingEligible,
  }));
}

function loadTonyelhabrValidityRows(): ClubEloValidityRow[] {
  if (!fs.existsSync(TONYELHABR_CSV)) return [];
  return parseClubEloValidityCsv(fs.readFileSync(TONYELHABR_CSV, "utf8"));
}

function pointInTimeRowsFromRankings(
  rankingsByDate: ReadonlyMap<string, ClubEloDailyRanking>
): ClubEloValidityRow[] {
  const rows: ClubEloValidityRow[] = [];
  for (const [rankingDate, ranking] of rankingsByDate) {
    if (BLOCKED_PRODUCTION_SNAPSHOTS.has(rankingDate)) continue;
    const clubs = ranking.byProfile["uefa-clubs"];
    const eng = ranking.byProfile["eng-clubs"];
    rows.push(...asPointInTimeValidityRows(
      rankingDate,
      Object.entries(clubs).map(([club, elo]) => ({
        club,
        country: club in eng ? "ENG" : "UEFA",
        elo,
      }))
    ));
  }
  return rows;
}

async function main(): Promise<void> {
  const { fixtures, datasetSha256 } = loadHistoryFixtures();
  const rankingsByDate = loadCapturedRankingsSafe();
  const tonyelhabrRows = loadTonyelhabrValidityRows();
  const inputs = toInputs(fixtures);
  const plInputs = inputs.filter((fixture) => fixture.competitionId === "eng.1");

  if (tonyelhabrRows.length === 0 && rankingsByDate.size === 0) {
    throw new Error(
      "No ClubElo From/To dump at raw/tonyelhabr/ and no captured dated rankings in index.json."
    );
  }
  const validityRows = [
    ...tonyelhabrRows,
    ...pointInTimeRowsFromRankings(rankingsByDate),
  ];
  const lookupPolicy = tonyelhabrRows.length > 0
    ? CLUBELO_FROM_TO_LOOKUP_POLICY
    : CLUBELO_PRE_KICKOFF_LOOKUP_POLICY;
  const { rows, missing } = tonyelhabrRows.length > 0
    ? joinFixturesWithFromToElo(inputs, validityRows)
    : joinFixturesWithPreKickoffElo(inputs, rankingsByDate);
  const validation = validatePreKickoffCorpus(rows, inputs, missing, ["eng.1"]);
  const seasonCoverage = preKickoffCoverageBySeason(plInputs, rows.filter((row) => row.competitionId === "eng.1"));
  const plCovered = Object.values(seasonCoverage).reduce((sum, season) => sum + season.covered, 0);
  const plTotal = plInputs.length;

  const dataset = {
    schemaVersion: CLUBELO_PRE_KICKOFF_SCHEMA_VERSION,
    source: "clubelo" as const,
    lookupPolicy,
    clubHistoryDatasetSha256: datasetSha256,
    fixtures: rows,
  };
  const datasetJson = `${JSON.stringify(dataset, null, 2)}\n`;
  const datasetSha = sha256(datasetJson);
  const datasetRelativePath = path.join("datasets", `${datasetSha}.json`);
  atomicWrite(path.join(OUTPUT_ROOT, datasetRelativePath), datasetJson);

  const builtAt = new Date().toISOString();
  const buildId = `${builtAt.replaceAll(":", "-").replaceAll(".", "-")}-${datasetSha.slice(0, 12)}`;
  const manifest = {
    schemaVersion: CLUBELO_PRE_KICKOFF_SCHEMA_VERSION,
    buildId,
    builtAt,
    datasetSha256: datasetSha,
    datasetPath: datasetRelativePath,
    clubHistoryDatasetSha256: datasetSha256,
    lookupPolicy,
    tonyelhabrValidityRows: tonyelhabrRows.length,
    capturedRankingDays: rankingsByDate.size,
    plFixtureCoverage: { covered: plCovered, n: plTotal, bySeason: seasonCoverage },
    corpusStatus: validation.status,
    promotionGate: {
      eligibleForOfflineTraining: validation.status !== "fail" && validation.requiredMissingCount === 0,
      eligibleForPartialOfflineTraining: validation.requiredCoveredCount > 0
        && validation.inventedRatingCount === 0,
      eligibleForCrossCompetitionPromotion: false,
      historicalChampionInputs: validation.requiredMissingCount === 0 ? datasetSha : "incomplete",
      blockers: [
        ...(validation.status === "fail"
          ? validation.errors
          : []),
        "UCL stays out of promotion until expected-count and regulation-time scores exist.",
      ],
    },
    validation,
  };
  const manifestRelativePath = path.join("builds", `${buildId}.json`);
  atomicWrite(path.join(OUTPUT_ROOT, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`);
  atomicWrite(path.join(OUTPUT_ROOT, "latest.json"), `${JSON.stringify({
    schemaVersion: CLUBELO_PRE_KICKOFF_SCHEMA_VERSION,
    buildId,
    manifestPath: manifestRelativePath,
    datasetSha256: datasetSha,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    buildId,
    lookupPolicy,
    corpusStatus: validation.status,
    datasetSha256: datasetSha,
    covered: rows.length,
    missing: missing.length,
    plFixtureCoverage: { covered: plCovered, n: plTotal, bySeason: seasonCoverage },
    requiredMissing: validation.requiredMissingCount,
    inventedRatingCount: validation.inventedRatingCount,
    eligibleForOfflineTraining: manifest.promotionGate.eligibleForOfflineTraining,
    eligibleForPartialOfflineTraining: manifest.promotionGate.eligibleForPartialOfflineTraining,
    trained: false,
    registered: false,
    manifestPath: path.join(OUTPUT_ROOT, manifestRelativePath),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
