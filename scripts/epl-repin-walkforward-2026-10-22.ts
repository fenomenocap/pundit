/**
 * Walk-forward EPL study for the 6 Nov 2026 goal-calibration re-pin.
 *
 * Protocol, fixed before any holdout number is read:
 * - Ratings: latest ClubElo publication strictly before the kickoff UTC date,
 *   at most 14 days old. api.clubelo.com was HTTP 502; the tonyelhabr mirror
 *   starts 2023-03-27, so 2018-22 rows train totals only.
 * - Parameter searches use walk-forward 2023/24 only.
 * - Keep / reject uses walk-forward 2024/25 and 2025/26 only.
 * - Keep iff the bootstrap 95% interval for (candidate - current) composite
 *   log loss (1X2 + over 2.5 + BTTS) lies entirely below 0, and five-bucket
 *   ECE does not rise by more than 0.01.
 * - 2026/27 is the holdout. It is scored only after decision.json is written,
 *   from a fit whose origin is 2026-07-01. It never enters a keep decision.
 *
 *   pnpm --filter @sports-predict/api exec tsx --tsconfig tsconfig.json \
 *     ../../scripts/epl-repin-walkforward-2026-10-22.ts --phase dev
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalClubName } from "../packages/api/src/lib/team-names";
import { migrateClubSeasonEvaluationArtifact, selectOnePerFixture } from "../packages/api/src/services/club-season-snapshots";
import { DEFAULT_HOME_ADVANTAGE_ELO, RHO, eloToLambdas, matrixTo1x2, matrixToBtts, matrixToTotals,
  scoreMatrix } from "../packages/api/src/services/dixon-coles";
import { attackDefenceLambdas, fitAttackDefence, type AttackDefenceFit } from "../packages/api/src/services/recency-attack-defence";
import { binaryLogLoss, bootstrapMean, bootstrapStatistic, eceFiveBuckets, oneXTwoBrier, oneXTwoLogLoss,
  perMatchCompositeDelta, reliability, summarize, type ScoredMatch } from "../packages/api/src/services/forecast-eval-metrics";
import { fitHistoricalGoalRates, historicalGoalLambdas, type HistoricalGoalFit } from "../packages/api/src/services/historical-goal-calibration";
import { utcWeekOrigin } from "../packages/api/src/services/historical-goal-evaluation";
import { anchorScoreGridTo1x2 } from "../packages/api/src/services/outcome-anchored-score-grid";
import { ONE_X_TWO_TEMPERATURE, scaleOneXTwoProbabilities } from "../packages/api/src/services/one-x-two-temperature";

const ROOT = resolve(__dirname, "..");
const DIR = resolve(ROOT, "model/epl-repin-2026-11-06");
const DAY = 86_400_000;
const DEV = new Set(["2024-25", "2025-26"]);
const SELECT = new Set(["2023-24"]);
const SEASONS = ["2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"];

interface Match {
  sourceEventId: string;
  seasonId: string;
  kickoff: string;
  homeCanonicalName: string;
  awayCanonicalName: string;
  homeGoals: number;
  awayGoals: number;
  homeElo?: number;
  awayElo?: number;
  ratingDate?: string;
}
interface Spec {
  name: string;
  train: "long" | "two-season";
  decayDays: number;
  teamPrecision: number;
  homeAdvantageElo: number;
  oneXTwoRho: number;
  temperature: number;
  totalScale: number;
  goalBlend: number;
  attackDefence: boolean;
}
interface Iteration {
  iteration: number;
  name: string;
  hypothesis: string;
  decision: "baseline" | "kept" | "rejected";
  reason: string;
  selectedParameter?: { name: string; value: number; selectionLoss: number; alternatives: Record<string, number> };
  metrics?: ReturnType<typeof summarize>;
  bySeason?: Record<string, ReturnType<typeof summarize>>;
  deltaVsCurrent?: ReturnType<typeof bootstrapMean>;
  ece5Delta?: number;
}

const matchesBytes = readFileSync(resolve(DIR, "inputs/matches.json"));
const manifest = JSON.parse(readFileSync(resolve(DIR, "inputs/manifest.json"), "utf8"));
if (createHash("sha256").update(matchesBytes).digest("hex") !== manifest.matchesSha256) {
  throw new Error("matches.json does not match the manifest");
}
const matches: Match[] = JSON.parse(matchesBytes.toString("utf8"));
for (const match of matches) {
  for (const name of [match.homeCanonicalName, match.awayCanonicalName]) {
    if (canonicalClubName(name) !== name) throw new Error(`Non-canonical club ${name}`);
  }
}
const rated = (rows: readonly Match[]) => rows.filter((match) => match.homeElo !== undefined && match.awayElo !== undefined);

function seasonAt(iso: string): string {
  const date = new Date(iso);
  const year = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}
function training(origin: number, spec: Pick<Spec, "train">): Match[] {
  const allowed = spec.train === "two-season"
    ? new Set(SEASONS.slice(Math.max(0, SEASONS.indexOf(seasonAt(new Date(origin).toISOString())) - 1), SEASONS.indexOf(seasonAt(new Date(origin).toISOString())) + 1))
    : null;
  return matches.filter((match) => Date.parse(match.kickoff) <= origin - DAY && (allowed === null || allowed.has(match.seasonId)));
}

const goalCache = new Map<string, HistoricalGoalFit>();
const adCache = new Map<string, AttackDefenceFit>();
function goalFit(origin: number, spec: Spec): HistoricalGoalFit {
  const key = `${origin}|${spec.train}|${spec.decayDays}|${spec.teamPrecision}`;
  const cached = goalCache.get(key);
  if (cached) return cached;
  const fit = fitHistoricalGoalRates(training(origin, spec), new Date(origin).toISOString(), {
    decayDays: spec.decayDays, teamPrecision: spec.teamPrecision,
  });
  if (!fit.converged) throw new Error(`Goal fit did not converge at ${key}`);
  goalCache.set(key, fit);
  return fit;
}
function adFit(origin: number, spec: Spec): AttackDefenceFit {
  const key = `${origin}|${spec.train}`;
  const cached = adCache.get(key);
  if (cached) return cached;
  const fit = fitAttackDefence(training(origin, spec), new Date(origin).toISOString(), 180, 10);
  if (!fit.converged) throw new Error(`Attack/defence fit did not converge at ${key} (gradient ${fit.gradientNorm})`);
  adCache.set(key, fit);
  return fit;
}

function normalize(probabilities: [number, number, number]): [number, number, number] {
  const total = probabilities[0] + probabilities[1] + probabilities[2];
  if (!(total > 0) || probabilities.some((value) => !(value > 0) || !Number.isFinite(value))) {
    throw new Error("1X2 probabilities must be finite and positive");
  }
  return [probabilities[0] / total, probabilities[1] / total, probabilities[2] / total];
}

function scoreGrid(matrix: number[][], match: Match): ScoredMatch {
  const result: 0 | 1 | 2 = match.homeGoals > match.awayGoals ? 0 : match.homeGoals === match.awayGoals ? 1 : 2;
  const oneXTwo = matrixTo1x2(matrix);
  const cell = matrix[Math.min(match.homeGoals, 10)]?.[Math.min(match.awayGoals, 10)] ?? 0;
  return {
    result,
    oneXTwo,
    over25: matrixToTotals(matrix, 2.5)[0],
    over25Actual: match.homeGoals + match.awayGoals > 2.5 ? 1 : 0,
    btts: matrixToBtts(matrix)[0],
    bttsActual: match.homeGoals > 0 && match.awayGoals > 0 ? 1 : 0,
    scorelineLogLoss: -Math.log(Math.max(cell, 1e-15)),
  };
}

function scoreWith(match: Match, spec: Spec, goal: HistoricalGoalFit | null, attack: AttackDefenceFit | null): ScoredMatch {
  if (spec.attackDefence) {
    if (!attack) throw new Error("Missing attack/defence fit");
    const [home, away] = attackDefenceLambdas(attack, match.homeCanonicalName, match.awayCanonicalName);
    return scoreGrid(scoreMatrix(home, away, attack.rho), match);
  }
  if (!goal || match.homeElo === undefined || match.awayElo === undefined) throw new Error("Missing goal fit or rating");
  const [rawHome, rawAway] = historicalGoalLambdas(goal, match);
  const goalGrid = scoreMatrix(rawHome * spec.totalScale, rawAway * spec.totalScale, goal.rho);
  let elo = matrixTo1x2(scoreMatrix(...eloToLambdas(match.homeElo, match.awayElo, spec.homeAdvantageElo), spec.oneXTwoRho));
  if (spec.temperature !== 1) elo = scaleOneXTwoProbabilities(elo, spec.temperature);
  const goalOneXTwo = matrixTo1x2(goalGrid);
  const mixed = normalize(elo.map((probability, index) => (1 - spec.goalBlend) * probability + spec.goalBlend * goalOneXTwo[index]) as [number, number, number]);
  return scoreGrid(anchorScoreGridTo1x2(goalGrid, mixed).matrix, match);
}

function predictWeek(match: Match, spec: Spec): ScoredMatch {
  const origin = utcWeekOrigin(match.kickoff);
  return scoreWith(match, spec, spec.attackDefence ? null : goalFit(origin, spec), spec.attackDefence ? adFit(origin, spec) : null);
}

function evaluate(spec: Spec, seasons: ReadonlySet<string>): { match: Match; scored: ScoredMatch }[] {
  return rated(matches).filter((match) => seasons.has(match.seasonId)).map((match) => ({ match, scored: predictWeek(match, spec) }));
}

function bySeason(rows: { match: Match; scored: ScoredMatch }[]) {
  const out: Record<string, ReturnType<typeof summarize>> = {};
  for (const season of [...new Set(rows.map((row) => row.match.seasonId))].sort()) {
    out[season] = summarize(rows.filter((row) => row.match.seasonId === season).map((row) => row.scored));
  }
  return out;
}

const baselineSpec: Spec = {
  name: "production-spec-long-history",
  train: "long",
  decayDays: 180,
  teamPrecision: 100,
  homeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
  oneXTwoRho: RHO,
  temperature: 1,
  totalScale: 1,
  goalBlend: 0,
  attackDefence: false,
};

function compare(candidate: Spec, current: Spec, hypothesis: string, iteration: number,
  selected?: Iteration["selectedParameter"]): { entry: Iteration; spec: Spec } {
  let rows: { match: Match; scored: ScoredMatch }[];
  let currentRows: { match: Match; scored: ScoredMatch }[];
  try {
    rows = evaluate(candidate, DEV);
    currentRows = evaluate(current, DEV);
  } catch (error) {
    return { spec: current, entry: { iteration, name: candidate.name, hypothesis, decision: "rejected",
      reason: `Fit or forecast failed: ${error instanceof Error ? error.message : "unknown"}`, selectedParameter: selected } };
  }
  const mismatch = rows.findIndex((row, index) => row.match.sourceEventId !== currentRows[index]?.match.sourceEventId);
  if (rows.length !== currentRows.length || mismatch !== -1) {
    throw new Error(`Dev samples are not paired (${rows.length} vs ${currentRows.length}, first mismatch ${mismatch}: ${rows[mismatch]?.match.sourceEventId} vs ${currentRows[mismatch]?.match.sourceEventId})`);
  }
  if (rows.some((row) => !DEV.has(row.match.seasonId))) throw new Error("Dev sample left 2024/25-2025/26");
  const delta = bootstrapMean(perMatchCompositeDelta(rows.map((row) => row.scored), currentRows.map((row) => row.scored)));
  const eceDelta = +(eceFiveBuckets(rows.map((row) => row.scored)).ece - eceFiveBuckets(currentRows.map((row) => row.scored)).ece).toFixed(4);
  const metrics = summarize(rows.map((row) => row.scored));
  const shared = { iteration, name: candidate.name, hypothesis, selectedParameter: selected, metrics,
    bySeason: bySeason(rows), deltaVsCurrent: delta, ece5Delta: eceDelta };
  if (!(delta.ci95[1] < 0)) {
    return { spec: current, entry: { ...shared, decision: "rejected",
      reason: `Composite log-loss change ${delta.estimate} has 95% interval [${delta.ci95[0]}, ${delta.ci95[1]}], which does not lie entirely below 0.` } };
  }
  if (eceDelta > 0.01) {
    return { spec: current, entry: { ...shared, decision: "rejected",
      reason: `Composite improved but five-bucket ECE rose by ${eceDelta}, above the 0.01 limit.` } };
  }
  return { spec: { ...candidate }, entry: { ...shared, decision: "kept",
    reason: `Composite log-loss change ${delta.estimate} [${delta.ci95[0]}, ${delta.ci95[1]}]; ECE change ${eceDelta}.` } };
}

function grid(current: Spec, iteration: number, hypothesis: string, key: keyof Spec, values: readonly number[],
  lossOf: (rows: ScoredMatch[]) => number): { entry: Iteration; spec: Spec } {
  const alternatives: Record<string, number> = {};
  let bestValue = values[0];
  let bestLoss = Infinity;
  for (const value of values) {
    const spec = { ...current, name: `${String(key)}=${value}`, [key]: value };
    let loss = Infinity;
    try { loss = lossOf(evaluate(spec, SELECT).map((row) => row.scored)); } catch { loss = Infinity; }
    alternatives[String(value)] = Number.isFinite(loss) ? +loss.toFixed(6) : null as unknown as number;
    if (loss < bestLoss) { bestLoss = loss; bestValue = value; }
  }
  if (!Number.isFinite(bestLoss)) {
    return { spec: current, entry: { iteration, name: String(key), hypothesis, decision: "rejected",
      reason: "Every candidate failed on the 2023/24 selection season." } };
  }
  const selected = { name: String(key), value: bestValue, selectionLoss: +bestLoss.toFixed(6), alternatives };
  if (bestValue === current[key]) {
    return { spec: current, entry: { iteration, name: String(key), hypothesis, decision: "rejected", selectedParameter: selected,
      reason: `2023/24 walk-forward selected ${bestValue}, which is already the current value.` } };
  }
  return compare({ ...current, name: `${String(key)}=${bestValue}`, [key]: bestValue }, current, hypothesis, iteration, selected);
}

function meanLoss(rows: ScoredMatch[], kind: "1x2" | "totals"): number {
  if (kind === "1x2") return rows.reduce((sum, row) => sum + oneXTwoLogLoss(row.oneXTwo, row.result), 0) / rows.length;
  return rows.reduce((sum, row) => sum + binaryLogLoss(row.over25, row.over25Actual) + binaryLogLoss(row.btts, row.bttsActual), 0) / rows.length;
}

function runDev(): { winner: Spec; iterations: Iteration[]; baselineRows: { match: Match; scored: ScoredMatch }[] } {
  const iterations: Iteration[] = [];
  const baselineRows = evaluate(baselineSpec, DEV);
  iterations.push({
    iteration: 0, name: baselineSpec.name, hypothesis: "Production specification, refit each week on all earlier results (2018 onward).",
    decision: "baseline", reason: "Reference. Temperature is off. This is the honest walk-forward form of the current pin.",
    metrics: summarize(baselineRows.map((row) => row.scored)), bySeason: bySeason(baselineRows),
  });
  let winner = baselineSpec;
  const steps: Array<(spec: Spec) => { entry: Iteration; spec: Spec }> = [
    (spec) => compare({ ...spec, name: "two-season-window", train: "two-season" }, spec,
      "Refit each week on the current and previous season only, which is the 22 Oct 450-row procedure.", 1),
    (spec) => compare({ ...spec, name: "temperature-1.286", temperature: ONE_X_TWO_TEMPERATURE }, spec,
      "Re-anchor the grid to the pre-specified T=1.286 1X2.", 2),
    (spec) => grid(spec, 3, "Choose one temperature on 2023/24 1X2 log loss, then freeze it.", "temperature",
      [1, 1.05, 1.1, 1.15, 1.2, 1.25, ONE_X_TWO_TEMPERATURE, 1.35, 1.45], (rows) => meanLoss(rows, "1x2")),
    (spec) => grid(spec, 4, "Choose home-advantage Elo on 2023/24 1X2 log loss, then freeze it.", "homeAdvantageElo",
      [20, 30, 42, 55, 70, 85], (rows) => meanLoss(rows, "1x2")),
    (spec) => grid(spec, 5, "Choose the baseline Dixon-Coles rho on 2023/24 1X2 log loss, then freeze it.", "oneXTwoRho",
      [-0.2, -0.15, -0.1, -0.05, 0], (rows) => meanLoss(rows, "1x2")),
    (spec) => compare({ ...spec, name: "decay-365", decayDays: 365 }, spec,
      "Lengthen the goal-model half-life from 180 to 365 days.", 6),
    (spec) => compare({ ...spec, name: "precision-25", teamPrecision: 25 }, spec,
      "Loosen team-effect shrinkage from precision 100 to 25.", 7),
    (spec) => grid(spec, 8, "Choose a total-goals scale on 2023/24 over-2.5 plus BTTS log loss, then freeze it.", "totalScale",
      [1, 1.03, 1.06, 1.09, 1.12], (rows) => meanLoss(rows, "totals")),
    (spec) => grid(spec, 9, "Choose a blend of the Elo 1X2 and the goal-model 1X2 on 2023/24, then freeze it.", "goalBlend",
      [0, 0.25, 0.5, 0.75, 1], (rows) => meanLoss(rows, "1x2")),
    (spec) => compare({ ...spec, name: "attack-defence", attackDefence: true }, spec,
      "Replace the anchored Elo grid with a recency-weighted attack/defence Dixon-Coles grid fit on earlier results only.", 10),
  ];
  for (const step of steps) {
    const result = step(winner);
    iterations.push(result.entry);
    winner = result.spec;
    console.error(JSON.stringify({ iteration: result.entry.iteration, decision: result.entry.decision, reason: result.entry.reason }));
  }
  return { winner, iterations, baselineRows };
}

function reliabilityBlock(rows: ScoredMatch[]) {
  return {
    pooledFiveBucket: eceFiveBuckets(rows),
    home: reliability(rows.map((row) => row.oneXTwo[0]), rows.map((row) => (row.result === 0 ? 1 : 0))),
    draw: reliability(rows.map((row) => row.oneXTwo[1]), rows.map((row) => (row.result === 1 ? 1 : 0))),
    away: reliability(rows.map((row) => row.oneXTwo[2]), rows.map((row) => (row.result === 2 ? 1 : 0))),
    over25: reliability(rows.map((row) => row.over25), rows.map((row) => row.over25Actual)),
    btts: reliability(rows.map((row) => row.btts), rows.map((row) => row.bttsActual)),
  };
}

function slim(rows: { match: Match; scored: ScoredMatch }[]) {
  return rows.map(({ match, scored }) => ({
    id: match.sourceEventId, seasonId: match.seasonId, kickoff: match.kickoff,
    home: match.homeCanonicalName, away: match.awayCanonicalName,
    homeGoals: match.homeGoals, awayGoals: match.awayGoals, result: scored.result,
    oneXTwo: scored.oneXTwo.map((value) => +value.toFixed(6)),
    over25: +scored.over25.toFixed(6), btts: +scored.btts.toFixed(6),
    scorelineLogLoss: +scored.scorelineLogLoss.toFixed(6),
  }));
}

function writeDev(dev: ReturnType<typeof runDev>) {
  const decision = {
    schemaVersion: 1,
    protocol: {
      selectionSeason: "2023-24",
      developmentSeasons: ["2024-25", "2025-26"],
      holdout: "2026-27 sealed club-season matches, scored only after this file is written, from a 2026-07-01 fit",
      keepRule: "bootstrap 95% CI of composite log-loss delta entirely below 0, and five-bucket ECE increase at most 0.01",
      bootstrap: { resamples: 2000, seed: 20261022, unit: "match" },
      ratingPolicy: manifest.ratingPolicy,
    },
    winner: dev.winner,
    iterations: dev.iterations,
  };
  writeFileSync(resolve(DIR, "decision.json"), `${JSON.stringify(decision, null, 1)}\n`);
  writeFileSync(resolve(DIR, "experiment-log.json"), `${JSON.stringify(dev.iterations, null, 1)}\n`);
  const winnerRows = evaluate(dev.winner, DEV);
  writeFileSync(resolve(DIR, "reliability.json"), `${JSON.stringify({
    developmentBaseline: reliabilityBlock(dev.baselineRows.map((row) => row.scored)),
    developmentWinner: reliabilityBlock(winnerRows.map((row) => row.scored)),
  }, null, 1)}\n`);
  writeFileSync(resolve(DIR, "backtest-predictions.json"), `${JSON.stringify({
    developmentBaseline: slim(dev.baselineRows),
    developmentWinner: slim(winnerRows),
  })}\n`);
  return decision;
}

function pairedDeltas(candidate: readonly ScoredMatch[], baseline: readonly ScoredMatch[]) {
  const stat = (value: (match: ScoredMatch) => number) => bootstrapStatistic(candidate.length,
    (indexes) => indexes.reduce((sum, index) => sum + value(candidate[index]) - value(baseline[index]), 0) / indexes.length);
  const deltas: Record<string, ReturnType<typeof bootstrapStatistic>> = {
    oneXTwoLogLoss: stat((match) => oneXTwoLogLoss(match.oneXTwo, match.result)),
    oneXTwoBrier: stat((match) => oneXTwoBrier(match.oneXTwo, match.result)),
    over25Brier: stat((match) => (match.over25 - match.over25Actual) ** 2),
    bttsBrier: stat((match) => (match.btts - match.bttsActual) ** 2),
    ece5: bootstrapStatistic(candidate.length, (indexes) => eceFiveBuckets(indexes.map((index) => candidate[index])).ece
      - eceFiveBuckets(indexes.map((index) => baseline[index])).ece),
    compositeLogLoss: bootstrapMean(perMatchCompositeDelta(candidate, baseline)),
  };
  if (candidate.every((match) => Number.isFinite(match.scorelineLogLoss))
    && baseline.every((match) => Number.isFinite(match.scorelineLogLoss))) {
    deltas.scorelineLogLoss = stat((match) => match.scorelineLogLoss);
  }
  return deltas;
}

function sealedScored(fixture: { pHome: number; pDraw: number; pAway: number; pOver2_5: number; pBttsYes: number;
  result: { homeScore: number; awayScore: number } }): ScoredMatch {
  const result = fixture.result;
  return {
    result: result.homeScore > result.awayScore ? 0 : result.homeScore === result.awayScore ? 1 : 2,
    oneXTwo: [fixture.pHome, fixture.pDraw, fixture.pAway],
    over25: fixture.pOver2_5,
    over25Actual: result.homeScore + result.awayScore > 2.5 ? 1 : 0,
    btts: fixture.pBttsYes,
    bttsActual: result.homeScore > 0 && result.awayScore > 0 ? 1 : 0,
    scorelineLogLoss: Number.NaN,
  };
}

function runHoldout(spec: Spec) {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, "packages/api/src/services/__fixtures__/club-season-ledger-prod-2026-10-22.json"), "utf8"));
  const kept = selectOnePerFixture(migrateClubSeasonEvaluationArtifact(ledger).fixtures).filter((fixture) => fixture.result);
  if (kept.length !== 84) throw new Error(`Expected 84 holdout matches, found ${kept.length}`);
  const origin = Date.parse("2026-07-01T00:00:00.000Z");
  const frozenGoal = spec.attackDefence ? null : goalFit(origin, spec);
  const frozenAd = spec.attackDefence ? adFit(origin, spec) : null;
  const byTeams = new Map<string, Match[]>();
  for (const match of matches) {
    if (match.seasonId !== "2026-27") continue;
    const key = `${match.homeCanonicalName}|${match.awayCanonicalName}`;
    byTeams.set(key, [...(byTeams.get(key) ?? []), match]);
  }
  const disagreements: string[] = [];
  const eplFrozen: ScoredMatch[] = [];
  const eplWalk: ScoredMatch[] = [];
  const eplSealed: ScoredMatch[] = [];
  const fullFrozen: ScoredMatch[] = [];
  const fullSealed: ScoredMatch[] = [];
  let epl = 0;
  for (const fixture of kept) {
    const sealed = sealedScored(fixture);
    fullSealed.push(sealed);
    if (fixture.competitionId !== "eng.1") { fullFrozen.push(sealed); continue; }
    epl += 1;
    const home = canonicalClubName(fixture.home);
    const away = canonicalClubName(fixture.away);
    const kickoff = Date.parse(fixture.utcDate);
    const source = (byTeams.get(`${home}|${away}`) ?? []).find((match) => Math.abs(Date.parse(match.kickoff) - kickoff) < 2 * DAY);
    if (!source) throw new Error(`No football-data row for ${home} v ${away}`);
    if (source.homeGoals !== fixture.result!.homeScore || source.awayGoals !== fixture.result!.awayScore) {
      disagreements.push(`${home} v ${away}: ledger ${fixture.result!.homeScore}-${fixture.result!.awayScore}, football-data ${source.homeGoals}-${source.awayGoals}`);
    }
    const row: Match = {
      ...source,
      homeGoals: fixture.result!.homeScore,
      awayGoals: fixture.result!.awayScore,
      homeElo: fixture.homeElo,
      awayElo: fixture.awayElo,
      kickoff: new Date(kickoff).toISOString(),
    };
    const frozen = scoreWith(row, spec, frozenGoal, frozenAd);
    const walked = predictWeek(row, spec);
    eplFrozen.push(frozen); eplWalk.push(walked); eplSealed.push(sealed); fullFrozen.push(frozen);
  }
  if (epl !== 70) throw new Error(`Expected 70 EPL holdout matches, found ${epl}`);
  const pinOrigin = "2026-10-22T00:00:00.000Z";
  const recommended = spec.attackDefence
    ? { attackDefence: adFit(Date.parse(pinOrigin), spec) }
    : { goal: goalFit(Date.parse(pinOrigin), spec) };
  return {
    disagreements,
    epl: { n: epl, sealed: summarize(eplSealed), frozenPreSeason: summarize(eplFrozen),
      walkForwardNotUsedForSelection: summarize(eplWalk),
      frozenMinusSealed: pairedDeltas(eplFrozen, eplSealed) },
    all84: {
      sealed: { ...summarize(fullSealed), scorelineLogLoss: null },
      withEplReforecast: { ...summarize(fullFrozen), scorelineLogLoss: null },
      reforecastMinusSealed: pairedDeltas(fullFrozen, fullSealed),
      note: "UCL rows keep their sealed probabilities. Scoreline log loss is reported on the EPL subset only.",
    },
    reliability: { eplFrozen: reliabilityBlock(eplFrozen), eplSealed: reliabilityBlock(eplSealed) },
    recommendedFit: recommended,
  };
}

const phase = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "all";
if (phase === "dev" || phase === "all") {
  console.error("dev sample", rated(matches).filter((match) => DEV.has(match.seasonId)).length,
    "selection", rated(matches).filter((match) => SELECT.has(match.seasonId)).length);
  const dev = runDev();
  const decision = writeDev(dev);
  console.error("winner", decision.winner.name);
  if (phase === "dev") process.exit(0);
  const holdout = runHoldout(dev.winner);
  writeFileSync(resolve(DIR, "recommended-fit.json"), `${JSON.stringify(holdout.recommendedFit, null, 1)}\n`);
  writeFileSync(resolve(DIR, "report.json"), `${JSON.stringify({
    schemaVersion: 1, productionPinChanged: false, winner: dev.winner, iterations: dev.iterations, holdout,
  }, null, 1)}\n`);
} else if (phase === "holdout") {
  const decision = JSON.parse(readFileSync(resolve(DIR, "decision.json"), "utf8"));
  const devBaseline = evaluate(baselineSpec, DEV).map((row) => row.scored);
  const devWinner = evaluate(decision.winner, DEV).map((row) => row.scored);
  const development = {
    baseline: summarize(devBaseline),
    winner: summarize(devWinner),
    winnerMinusBaseline: pairedDeltas(devWinner, devBaseline),
    note: "Walk-forward 2024/25 and 2025/26. This is the sample that kept T=1.286. The holdout was not used.",
  };
  const holdout = runHoldout(decision.winner);
  writeFileSync(resolve(DIR, "recommended-fit.json"), `${JSON.stringify(holdout.recommendedFit, null, 1)}\n`);
  const reliability = JSON.parse(readFileSync(resolve(DIR, "reliability.json"), "utf8"));
  reliability.holdoutEplFrozen = holdout.reliability.eplFrozen;
  reliability.holdoutEplSealed = holdout.reliability.eplSealed;
  writeFileSync(resolve(DIR, "reliability.json"), `${JSON.stringify(reliability, null, 1)}\n`);
  writeFileSync(resolve(DIR, "report.json"), `${JSON.stringify({
    schemaVersion: 1,
    productionPinChanged: false,
    temperatureFlag: "ONE_X_TWO_TEMPERATURE_ENABLED remains default OFF. The 6 Nov recommendation is to turn it on with the long-history refit; that is an owner decision and does not pass the market-close promotion gate.",
    winner: decision.winner,
    development,
    iterations: decision.iterations,
    holdout: { ...holdout, reliability: undefined },
  }, null, 1)}\n`);
  console.log(JSON.stringify({ winner: decision.winner.name, development: development.winnerMinusBaseline,
    epl: holdout.epl.frozenMinusSealed, all84: holdout.all84.reforecastMinusSealed, disagreements: holdout.disagreements }, null, 1));
} else {
  throw new Error(`Unknown phase ${phase}`);
}
