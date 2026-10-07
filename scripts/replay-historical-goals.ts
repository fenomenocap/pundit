import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { replayHistoricalGoalCalibration, summarizeGoalPredictions,
  type EvaluationGoalRow } from "../packages/api/src/services/historical-goal-evaluation";
import { anchorScoreGridTo1x2 } from "../packages/api/src/services/outcome-anchored-score-grid";
import { matrixTo1x2 } from "../packages/api/src/services/dixon-coles";

// Run from the repository root using Node's tsx loader. No provider or production requests.
const base = "artifacts/historical-calibration-2026-10-07";
const anchored = process.argv.includes("--anchored");
const protocolPath = `${base}/${anchored ? "protocol-outcome-anchored-v2" : "protocol-shrunk-goal-rates-v1"}.json`;
const protocol = JSON.parse(readFileSync(protocolPath, "utf8"));
const manifestPath = `${base}/elo-join-manifest-v3.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bindings: Array<{ path: string; sha256: string }> = [];
function bound(path: string, sha256?: string) {
  const bytes = readFileSync(resolve(path));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (sha256 && hash !== sha256) throw new Error(`Changed historical source: ${path}`);
  bindings.push({ path, sha256: hash });
  return bytes;
}
function checked(path: string, sha256?: string) { return JSON.parse(bound(path, sha256).toString("utf8")); }
for (const ref of protocol.bindings) bound(ref.path, ref.sha256);
bound(protocolPath);
bound(manifestPath);
for (const path of ["scripts/replay-historical-goals.ts", "packages/api/src/services/historical-goal-evaluation.ts"]) bound(path);
if (anchored) bound("packages/api/src/services/outcome-anchored-score-grid.ts");
interface Fixture { sourceEventId: string; seasonId: string; kickoff: string;
  home: { canonicalName: string }; away: { canonicalName: string }; homeGoals: number; awayGoals: number }
const fixtures: Fixture[] = [];
const capture = checked(`${base}/historical-capture-manifest.json`);
for (let year = 2018; year <= 2023; year += 1) {
  const season = `${year}-${String(year + 1).slice(2)}`;
  const ref = capture.seasons.find((s: { spec: { seasonId: string } }) => s.spec.seasonId === season);
  if (!ref || ref.validation.status !== "pass") throw new Error("Incomplete captured season");
  fixtures.push(...checked(`${base}/fixtures-${season}.json`, ref.parsedSha256));
}
for (const season of ["2024-25", "2025-26"]) {
  const path = `${base}/elo-fixtures-${season}.json`;
  const ref = manifest.sourceBindings.find((r: { path: string }) => r.path === path);
  if (!ref) throw new Error("Missing exposed fixture binding");
  fixtures.push(...checked(path, ref.sha256));
}
const ratings = new Map<string, { homeElo: number; awayElo: number; rankingDate: string; freshPublicationLe14Days: boolean;
  homeCanonicalName: string; awayCanonicalName: string; kickoff: string; seasonId: string }>();
for (const ref of manifest.results) {
  const packet = checked(ref.path, ref.sha256);
  for (const row of packet.rows) {
    if (ratings.has(row.sourceEventId)) throw new Error("Duplicate strict rating join");
    const policy = new Date(Date.parse(row.kickoff.slice(0, 10)) - 86_400_000).toISOString().slice(0, 10);
    if (row.policyDate !== policy || [row.homeRatingProvenance, row.awayRatingProvenance]
      .some((p) => p.scrapeDate > policy || p.retrievalCalendarDate > policy || p.from > policy)
      || row.freshPublicationLe14Days !== (row.maxPublicationAgeDays <= 14)) {
      throw new Error("Unproved historical rating availability/freshness");
    }
    ratings.set(row.sourceEventId, row);
  }
}
const rows: EvaluationGoalRow[] = fixtures.map((r) => {
  const rated = ratings.get(r.sourceEventId);
  if (rated && (rated.homeCanonicalName !== r.home.canonicalName || rated.awayCanonicalName !== r.away.canonicalName
    || rated.kickoff !== r.kickoff || rated.seasonId !== r.seasonId)) throw new Error("Conflicting oriented historical identity");
  return { sourceEventId: r.sourceEventId, kickoff: r.kickoff, seasonId: r.seasonId,
    homeCanonicalName: r.home.canonicalName, awayCanonicalName: r.away.canonicalName,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals, homeElo: rated?.homeElo, awayElo: rated?.awayElo,
    ratingDate: rated?.rankingDate, freshRating: rated?.freshPublicationLe14Days ?? false };
});
if (rows.length !== 3040 || ratings.size !== 1215) throw new Error("Changed complete historical denominator");
let weekCount = 0;
const predictions = replayHistoricalGoalCalibration(rows, (origin) => {
  weekCount += 1;
  if (weekCount % 10 === 0) process.stderr.write(`Completed historical week ${weekCount}: ${origin}\n`);
}, anchored ? (grid, champion) => anchorScoreGridTo1x2(grid, matrixTo1x2(champion)) : undefined);
const summarize = (seasons: string[], fresh: boolean) => summarizeGoalPredictions(predictions.filter((r) => seasons.includes(r.seasonId) && r.freshRating === fresh));
const primary = summarize(["2023-24"], true), staleReserve = summarize(["2023-24"], false);
const exposed = summarize(["2024-25", "2025-26"], true), staleExposed = summarize(["2024-25", "2025-26"], false);
const gates = {
  primaryDenominator: primary.count === 341 && primary.utcWeeks >= 20,
  primaryImprovement: primary.metrics.scoreline.interval95[1] < 0,
  otherMarkets: ["oneXTwo", "totalsBrier", "bttsBrier"].every((key) => {
    const m = primary.metrics[key]; return m.delta <= (anchored && key === "oneXTwo" ? 1e-12 : 0)
      && m.interval95[1] <= (key === "oneXTwo" ? 0.01 : 0.005);
  }) && ["totalsLog", "bttsLog"].every((key) => primary.metrics[key].delta <= 0),
  exposedConsistency: exposed.metrics.scoreline.delta < 0
    && ["oneXTwo", "totalsBrier", "bttsBrier"].every((key) => exposed.metrics[key].delta <= (anchored && key === "oneXTwo" ? 1e-12 : 0)),
  fallback: primary.fallbacks / primary.count <= 0.05,
};
const report = { schemaVersion: 1, experimentId: protocol.experimentId, sourceBindings: bindings,
  scoreComparison: "candidate minus exact shipped champion", availabilityLimit: protocol.availability.ratingCaveat,
  primary, staleReserve, exposed, staleExposed, gates,
  historicalEligibility: Object.values(gates).every(Boolean) ? "PASS_PENDING_INDEPENDENT_REVIEW" : "FAIL_CONTINUE_RESEARCH",
  predictionCount: predictions.length, predictions };
const path = process.argv[2];
if (!path || !path.startsWith(`${base}/`) || path.includes("..")) throw new Error("Output must stay in this experiment artifact directory");
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ path, historicalEligibility: report.historicalEligibility, primary, exposed, gates }, null, 2));
