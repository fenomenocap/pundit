import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  HISTORICAL_SEASON_SPECS,
  HistoricalFixture,
  historicalScoreboardUrl,
  parseHistoricalScoreboard,
  sha256,
  validateHistoricalSeason,
} from "../src/services/club-history-corpus";

const OUTPUT_ROOT = path.join(__dirname, "../data/research/club-history");
const FETCH_TIMEOUT_MS = 30_000;

function atomicWrite(filePath: string, value: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, filePath);
}

async function fetchRaw(url: string): Promise<{ raw: Buffer; retrievedAt: string }> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "pundit-offline-research/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ESPN ${response.status} for ${url}`);
  return { raw: Buffer.from(await response.arrayBuffer()), retrievedAt: new Date().toISOString() };
}

async function main(): Promise<void> {
  const seasonArtifacts: Array<{
    spec: typeof HISTORICAL_SEASON_SPECS[number];
    source: {
      url: string;
      retrievedAt: string;
      rawSha256: string;
      rawPath: string;
      sourceEventCount: number;
      rejectedEventIds: string[];
    };
    validation: ReturnType<typeof validateHistoricalSeason>;
    fixtures: HistoricalFixture[];
  }> = [];

  for (const spec of HISTORICAL_SEASON_SPECS) {
    const url = historicalScoreboardUrl(spec);
    const { raw, retrievedAt } = await fetchRaw(url);
    const rawSha256 = sha256(raw);
    const rawRelativePath = path.join(
      "raw",
      "espn",
      spec.competitionId,
      spec.seasonId,
      `${rawSha256}.json.gz`
    );
    const rawPath = path.join(OUTPUT_ROOT, rawRelativePath);
    if (!fs.existsSync(rawPath)) atomicWrite(rawPath, gzipSync(raw, { level: 9 }));

    const parsed = parseHistoricalScoreboard(raw.toString("utf8"), spec);
    const validation = validateHistoricalSeason(
      parsed.fixtures,
      spec,
      parsed.sourceWarnings,
      parsed.rejectedEventIds
    );
    seasonArtifacts.push({
      spec,
      source: {
        url,
        retrievedAt,
        rawSha256,
        rawPath: rawRelativePath,
        sourceEventCount: parsed.sourceEventCount,
        rejectedEventIds: parsed.rejectedEventIds,
      },
      validation,
      fixtures: parsed.fixtures,
    });
  }

  const dataset = {
    schemaVersion: 1,
    source: "espn" as const,
    seasons: seasonArtifacts.map(({ spec, fixtures }) => ({
      competitionId: spec.competitionId,
      seasonId: spec.seasonId,
      fixtures,
    })),
  };
  const datasetJson = `${JSON.stringify(dataset, null, 2)}\n`;
  const datasetSha256 = sha256(datasetJson);
  const datasetRelativePath = path.join("datasets", `${datasetSha256}.json`);
  atomicWrite(path.join(OUTPUT_ROOT, datasetRelativePath), datasetJson);

  const statuses = seasonArtifacts.map((entry) => entry.validation.status);
  const corpusStatus = statuses.includes("fail")
    ? "fail"
    : statuses.includes("inconclusive") ? "inconclusive" : "pass";
  const builtAt = new Date().toISOString();
  const buildId = `${builtAt.replaceAll(":", "-").replaceAll(".", "-")}-${datasetSha256.slice(0, 12)}`;
  const clubEloLatestPath = path.join(__dirname, "../data/research/clubelo-history/latest.json");
  const clubEloLatest = fs.existsSync(clubEloLatestPath)
    ? JSON.parse(fs.readFileSync(clubEloLatestPath, "utf8")) as { datasetSha256?: string }
    : null;
  const manifest = {
    schemaVersion: 1,
    buildId,
    builtAt,
    datasetSha256,
    datasetPath: datasetRelativePath,
    corpusStatus,
    promotionGate: {
      eligibleForOfflineTraining: seasonArtifacts
        .filter((entry) => entry.spec.competitionId === "eng.1")
        .every((entry) => entry.validation.status === "pass"),
      eligibleForCrossCompetitionPromotion: corpusStatus === "pass",
      historicalChampionInputs: clubEloLatest?.datasetSha256 ?? "missing",
      blockers: [
        ...(corpusStatus === "inconclusive"
          ? ["UCL qualifying lacks an independent expected-count manifest and regulation-time scores for AET/penalty ties."]
          : []),
        ...(clubEloLatest
          ? []
          : ["Chronological ClubElo inputs have not yet been captured. See data/research/clubelo-history/README.md."]),
      ],
    },
    seasons: seasonArtifacts.map(({ spec, source, validation }) => ({ spec, source, validation })),
  };
  const manifestRelativePath = path.join("builds", `${buildId}.json`);
  atomicWrite(path.join(OUTPUT_ROOT, manifestRelativePath), `${JSON.stringify(manifest, null, 2)}\n`);
  atomicWrite(path.join(OUTPUT_ROOT, "latest.json"), `${JSON.stringify({
    schemaVersion: 1,
    buildId,
    manifestPath: manifestRelativePath,
    datasetSha256,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    buildId,
    corpusStatus,
    datasetSha256,
    fixtureCount: seasonArtifacts.reduce((sum, entry) => sum + entry.fixtures.length, 0),
    trainingEligibleCount: seasonArtifacts.reduce(
      (sum, entry) => sum + entry.validation.trainingEligibleCount,
      0
    ),
    seasons: seasonArtifacts.map((entry) => ({
      competitionId: entry.spec.competitionId,
      seasonId: entry.spec.seasonId,
      status: entry.validation.status,
      fixtures: entry.validation.fixtureCount,
      trainingEligible: entry.validation.trainingEligibleCount,
    })),
    manifestPath: path.join(OUTPUT_ROOT, manifestRelativePath),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
