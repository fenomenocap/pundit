import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { canonicalClubName } from "../packages/api/src/lib/team-names";
import { fitHistoricalGoalRates, GOAL_CALIBRATION_CANDIDATES,
  type HistoricalGoalRow } from "../packages/api/src/services/historical-goal-calibration";
import { selectGoalCandidate, type HistoricalGoalPrediction } from "../packages/api/src/services/historical-goal-evaluation";

// Offline, reviewed October 7 build. It never fetches providers or activates a pin.
const BASE = "artifacts/historical-calibration-2026-10-07";
const ORIGIN = "2026-10-07T00:00:00.000Z";
const CUTOFF = Date.parse(ORIGIN) - 86_400_000;
const METHOD = "outcome-anchored-shrunk-goals-v2";
interface EvidenceRef { path: string; sha256: string }
const source: EvidenceRef[] = [], training: EvidenceRef[] = [], evaluation: EvidenceRef[] = [];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function repoPath(path: string): string {
  const local = relative(process.cwd(), resolve(path));
  if (!local || isAbsolute(local) || local === ".." || local.startsWith("../")) throw new Error("Evidence outside repository");
  return local;
}
function bound(path: string, expected: string, refs: EvidenceRef[]): Buffer {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Missing expected evidence hash");
  const local = repoPath(path), bytes = readFileSync(local);
  if (sha(bytes) !== expected) throw new Error(`Changed reviewed evidence: ${local}`);
  if (!refs.some((r) => r.path === local)) refs.push({ path: local, sha256: expected });
  return bytes;
}
function checked(path: string, expected: string, refs: EvidenceRef[]) {
  return JSON.parse(bound(path, expected, refs).toString("utf8"));
}
const protocol = checked(`${BASE}/protocol-outcome-anchored-v2.json`, "dc1cb0d73d863793cbce1ed385ea80099c87c19ff1cbfb05f689e54812e6d6b4", evaluation);
checked(`${BASE}/protocol-outcome-anchored-v2-tolerance-amendment.json`, "7567953114f5f46f1142bbfb46dc7454ba879532aec07e013580ee848871048c", evaluation);
for (const ref of protocol.bindings as EvidenceRef[]) bound(ref.path, ref.sha256, source);
const capture = checked(`${BASE}/historical-capture-manifest.json`, "f54155f87bb0eea54c4d044ec602230f787b336cf396d07ec43029ca498295d2", training);
const joins = checked(`${BASE}/elo-join-manifest-v3.json`, "c332a9abdafcd9a681b2aa4592e939351099d1139ca38b46069da74c679c7fa1", training);
for (const ref of joins.sourceBindings as EvidenceRef[]) bound(ref.path, ref.sha256, training);
for (const [path, hash] of [
  ["packages/api/src/services/historical-goal-evaluation.ts", "914a55145957e1d25ec2d823df1f0836976db7ca728f54678049a7f2c4ba4dea"],
  ["packages/api/src/services/outcome-anchored-score-grid.ts", "c397be1487fb70ff1a98a41598562cbf6e1792535014de13390719d434def07a"],
]) bound(path, hash, source);
const builder = "scripts/build-epl-goal-calibration.ts";
source.push({ path: builder, sha256: sha(readFileSync(builder)) });
const reportHash = "5e16c8adbb2f9c3669038c141fc1aef79babb680d957fc06b061162989893de0";
const report = checked(`${BASE}/replay-anchored-v2-first.json`, reportHash, evaluation);
bound(`${BASE}/replay-anchored-v2-second.json`, reportHash, evaluation);
for (const [path, hash] of [
  ["elo-v2-report-independent-review.json", "2143913787294a49fc8527008c81f1131dac32f5081c9f222e763e9a51f57958"],
  ["elo-v2-training-binding-review.json", "9141e94b402d7bf84f5114d01b37b279e3328317395fada3ec3581c379d53c97"],
]) checked(`${BASE}/${path}`, hash, evaluation);
if (protocol.experimentId !== "outcome-anchored-goal-rates-v2" || report.experimentId !== protocol.experimentId
  || report.historicalEligibility !== "PASS_PENDING_INDEPENDENT_REVIEW"
  || Object.values(report.gates).some((v) => v !== true)) throw new Error("Historical review did not pass");
for (const ref of report.sourceBindings as EvidenceRef[]) bound(ref.path, ref.sha256, evaluation);

interface Fixture {
  sourceEventId: string; competitionId: string; seasonId: string; kickoff: string;
  home: { sourceTeamId: string; canonicalName: string }; away: { sourceTeamId: string; canonicalName: string };
  homeGoals: number; awayGoals: number; finalStatusName: string; regulationTimeScore: boolean;
  trainingEligible: boolean; wasSuspended: boolean; neutralSite: boolean | null;
  resultAvailableAt?: string; resultAvailabilityPolicy?: string;
}
const fixtures: Fixture[] = [];
for (let year = 2018; year <= 2023; year += 1) {
  const season = `${year}-${String(year + 1).slice(2)}`;
  const ref = capture.seasons.find((r: { spec: { seasonId: string } }) => r.spec.seasonId === season);
  if (!ref || ref.validation.status !== "pass") throw new Error("Incomplete historical season");
  const rows = checked(`${BASE}/fixtures-${season}.json`, ref.parsedSha256, training);
  if (rows.length !== 380 || rows.some((r: Fixture) => r.seasonId !== season)) throw new Error("Historical season denominator changed");
  fixtures.push(...rows);
}
for (const season of ["2024-25", "2025-26"]) {
  const path = `${BASE}/elo-fixtures-${season}.json`;
  const ref = joins.sourceBindings.find((r: EvidenceRef) => r.path === path);
  if (!ref) throw new Error("Missing exposed season binding");
  const rows = checked(path, ref.sha256, training);
  if (rows.length !== 380 || rows.some((r: Fixture) => r.seasonId !== season)) throw new Error("Exposed season denominator changed");
  fixtures.push(...rows);
}
const currentReceipt = checked(`${BASE}/current/current-capture-receipt.json`, "b0ae79f9bb538c72ddef49f1e8fb05c3a2a7545ba2b0e4811e81b1ae8103302d", training);
const currentReview = checked(`${BASE}/current/independent-source-review.json`, "4b031d864585360cb3f2954a7bcdee8bf98464346a40e17ad5cada02cc41b06c", training);
const currentCapture = checked(`${BASE}/current/source-capture.json`, "e355917d7c1a6d282d3507730a7689ff1981199ae3158d56422c75e89968bf02", training);
const raw = bound(currentCapture.rawPath, currentCapture.rawGzipSha256, training);
if (sha(gunzipSync(raw)) !== currentCapture.rawSha256) throw new Error("Current raw source hash changed");
for (const key of ["parser", "normalizationScript"])
  bound(currentReceipt[key].path, currentReceipt[key].sha256, training);
const current: Fixture[] = checked(`${BASE}/current/fixtures-2026-27.json`, "549a916eb08c6e0babf80c7c7d08dc05d29a62b9654943c2128de4c62fdf85ff", training);
if (current.length !== 50 || currentReceipt.cutoff !== ORIGIN || currentReceipt.ratingsIncluded !== false
  || currentReceipt.completeness.status !== "PASS_PROVIDER_COMPLETED_SUBSET"
  || currentReview.productionChanged === true) throw new Error("Unreviewed current FT subset");
const expectedIds = currentReceipt.completeness.expectedSourceIds;
if (JSON.stringify([...current.map((r) => r.sourceEventId)].sort()) !== JSON.stringify(expectedIds)) throw new Error("Incomplete current FT identities");
for (const row of current) {
  if (row.seasonId !== "2026-27" || row.resultAvailabilityPolicy !== "kickoff-plus-24h-conservative-research-proxy"
    || row.resultAvailableAt !== new Date(Date.parse(row.kickoff) + 86_400_000).toISOString()
    || Date.parse(row.resultAvailableAt!) > Date.parse(ORIGIN)) throw new Error("Unavailable current result");
}
fixtures.push(...current);
const seen = new Set<string>();
for (const row of fixtures) {
  if (!row.sourceEventId || seen.has(row.sourceEventId) || row.competitionId !== "eng.1"
    || !Number.isFinite(Date.parse(row.kickoff)) || Date.parse(row.kickoff) > CUTOFF
    || row.finalStatusName !== "STATUS_FULL_TIME" || row.regulationTimeScore !== true
    || row.trainingEligible !== true || row.wasSuspended !== false || row.neutralSite === true
    || ![row.homeGoals, row.awayGoals].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 30)
    || !row.home.sourceTeamId || !row.away.sourceTeamId || row.home.sourceTeamId === row.away.sourceTeamId
    || ![row.home.canonicalName, row.away.canonicalName].every((n) => n && canonicalClubName(n) === n)
    || row.home.canonicalName === row.away.canonicalName) throw new Error("Invalid/duplicate/unavailable EPL FT input");
  seen.add(row.sourceEventId);
}
const ratings = new Map<string, { homeElo: number; awayElo: number; rankingDate: string; kickoff: string;
  seasonId: string; homeCanonicalName: string; awayCanonicalName: string; freshPublicationLe14Days: boolean }>();
for (const ref of joins.results as EvidenceRef[]) {
  const packet = checked(ref.path, ref.sha256, training);
  for (const row of packet.rows) {
    if (ratings.has(row.sourceEventId) || !seen.has(row.sourceEventId)) throw new Error("Duplicate/unmatched historical rating");
    ratings.set(row.sourceEventId, row);
  }
}
const rows: HistoricalGoalRow[] = fixtures.map((r) => {
  const rating = ratings.get(r.sourceEventId);
  if (rating && (rating.kickoff !== r.kickoff || rating.seasonId !== r.seasonId
    || rating.homeCanonicalName !== r.home.canonicalName || rating.awayCanonicalName !== r.away.canonicalName)) throw new Error("Rating identity/orientation conflict");
  const rated = rating?.freshPublicationLe14Days ? rating : undefined;
  return { sourceEventId: r.sourceEventId, kickoff: r.kickoff, homeCanonicalName: r.home.canonicalName,
    awayCanonicalName: r.away.canonicalName, homeGoals: r.homeGoals, awayGoals: r.awayGoals,
    ...(rated ? { homeElo: rated.homeElo, awayElo: rated.awayElo, ratingDate: rated.rankingDate } : {}) };
});
if (rows.length !== 3090 || ratings.size !== 1215 || rows.filter((r) => r.homeElo !== undefined).length !== 996
  || current.some((r) => ratings.has(r.sourceEventId))) throw new Error("Changed deployment training denominator");
const records = (report.predictions as HistoricalGoalPrediction[]).map((r) => {
  if (!r.optionEvidence || r.optionEvidence.length !== 5) throw new Error("Missing earlier option evidence");
  return { kickoff: r.kickoff, freshRating: r.freshRating, losses: r.optionEvidence.map((o) => o.loss) };
});
const selection = selectGoalCandidate(records, Date.parse(ORIGIN));
const fit = fitHistoricalGoalRates(rows, ORIGIN, GOAL_CALIBRATION_CANDIDATES[selection.index]);
if (!fit.converged || !Number.isFinite(fit.gradientNorm) || fit.gradientNorm < 0 || fit.gradientNorm > 1e-7
  || fit.trainingCount !== 3090 || fit.allocationTrainingCount !== 996 || Date.parse(fit.trainingThrough) > CUTOFF)
  throw new Error("Deployment fit failed its convergence/chronology gate");
const artifact = { schemaVersion: 1, methodId: METHOD, competitionId: "eng.1", fit,
  review: { experimentId: protocol.experimentId, source, training, evaluation } };
const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
const artifactSha256 = sha(bytes);
const artifactPath = `packages/api/data/model-artifacts/epl-goal-calibration/${artifactSha256}.json`;
function publishExact(path: string, body: string) {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== body) throw new Error("Existing immutable build differs");
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { flag: "wx" }); }
}
publishExact(artifactPath, bytes);
const receipt = { schemaVersion: 1, artifactPath, artifactSha256, artifactId: `${METHOD}:${artifactSha256}`,
  origin: ORIGIN, selection: { ...selection, options: fit.options,
    reason: selection.count < 60 ? "Predeclared default: fewer than60 fresh earlier OOF rows in26weeks" : "Lowest earlier anchored OOF loss" },
  trainingCount: fit.trainingCount, allocationTrainingCount: fit.allocationTrainingCount,
  currentGoalOnlyCount: current.length, trainingThrough: fit.trainingThrough, trainingSha256: fit.trainingSha256,
  gradientNorm: fit.gradientNorm, review: artifact.review,
  limitations: { historical: protocol.split, uncertainty: protocol.uncertainty.limitation,
    currentAvailability: currentReceipt.availabilityCaveat, coverage: "Reviewed EPL normal-home fixtures only; UCL/neutral forecasts retain baseline" },
  productionChanged: false, prospectiveCandidateChanged: false };
const receiptArg = process.argv.indexOf("--receipt");
const receiptPath = receiptArg < 0 ? `${BASE}/elo-deployment-build.json` : process.argv[receiptArg + 1];
if (!receiptPath || !receiptPath.startsWith(`${BASE}/elo-`) || repoPath(receiptPath) !== receiptPath)
  throw new Error("Receipt must stay in the private experiment directory");
publishExact(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ artifactPath, artifactSha256, receiptPath, selection, gradientNorm: fit.gradientNorm }));
