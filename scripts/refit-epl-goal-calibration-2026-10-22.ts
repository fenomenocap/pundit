/**
 * Offline EPL goal-calibration re-fit and evidence report (22 Oct 2026).
 *
 * Reads only committed inputs under model/calibration-2026-10-22/inputs and
 * never contacts a provider. It does NOT change the production pin: it writes
 *   model/calibration-2026-10-22/report.json          (fit, backtest, reliability, ECE, bootstrap)
 *   model/calibration-2026-10-22/candidate-fit.json   (re-fitted coefficients, origin 2026-10-22)
 * Run from the repo root:
 *   pnpm --filter @sports-predict/api exec ts-node --transpile-only ../../scripts/refit-epl-goal-calibration-2026-10-22.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalClubName } from "../packages/api/src/lib/team-names";
import { DEFAULT_HOME_ADVANTAGE_ELO, eloToLambdas, matrixTo1x2, matrixToBtts, matrixToTotals,
  scoreMatrix } from "../packages/api/src/services/dixon-coles";
import { fitHistoricalGoalRates, historicalGoalLambdas, type HistoricalGoalFit,
  type HistoricalGoalRow } from "../packages/api/src/services/historical-goal-calibration";
import { anchorScoreGridTo1x2 } from "../packages/api/src/services/outcome-anchored-score-grid";
import { ONE_X_TWO_TEMPERATURE, scaleOneXTwoProbabilities } from "../packages/api/src/services/one-x-two-temperature";

const ROOT = resolve(__dirname, "..");
const DIR = resolve(ROOT, "model/calibration-2026-10-22");
const ORIGIN = "2026-10-22T00:00:00.000Z";
const OPTIONS = { decayDays: 180, teamPrecision: 100 } as const; // production option of a502e436
const DAY = 86_400_000, WEEK = 7 * DAY;
const PINNED = "a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7";

interface Row extends HistoricalGoalRow { seasonId: string }
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const matchesBytes = readFileSync(resolve(DIR, "inputs/matches.json"));
const manifest = JSON.parse(readFileSync(resolve(DIR, "inputs/manifest.json"), "utf8"));
if (sha(matchesBytes) !== manifest.matchesSha256) throw new Error("matches.json does not match manifest");
const rows: Row[] = JSON.parse(matchesBytes.toString("utf8"));
for (const r of rows) {
  for (const n of [r.homeCanonicalName, r.awayCanonicalName]) {
    if (canonicalClubName(n) !== n) throw new Error(`Non-canonical club name: ${n}`);
  }
}
const seasonOrder = ["2024-25", "2025-26", "2026-27"];
const seasonOf = (t: number) => (t >= Date.parse("2026-07-01") ? "2026-27" : t >= Date.parse("2025-07-01") ? "2025-26" : "2024-25");
function trainingFor(origin: number): Row[] {
  const s = seasonOrder.indexOf(seasonOf(origin));
  const keep = new Set(seasonOrder.slice(Math.max(0, s - 1), s + 1)); // current + previous season
  return rows.filter((r) => keep.has(r.seasonId) && Date.parse(r.kickoff) <= origin - DAY);
}

type Tri = [number, number, number];
interface Pred {
  id: string; kickoff: string; origin: string; result: 0 | 1 | 2; over: 0 | 1; btts: 0 | 1;
  homeGoals: number; awayGoals: number;
  baseline1x2: Tri; temp1x2: Tri; calibrated1x2: Tri;
  baselineOver: number; anchoredOver: number; baselineBtts: number; anchoredBtts: number;
  anchoredScoreP: number; baselineScoreP: number;
}
function predict(fit: HistoricalGoalFit, r: Row, origin: string): Pred {
  const baseline = scoreMatrix(...eloToLambdas(r.homeElo!, r.awayElo!, DEFAULT_HOME_ADVANTAGE_ELO));
  const b1x2 = matrixTo1x2(baseline);
  const [lh, la] = historicalGoalLambdas(fit, r);
  const calibrated = scoreMatrix(lh, la, fit.rho);
  const anchored = anchorScoreGridTo1x2(calibrated, b1x2).matrix;
  const result = r.homeGoals > r.awayGoals ? 0 : r.homeGoals === r.awayGoals ? 1 : 2;
  return { id: r.sourceEventId, kickoff: r.kickoff, origin, result,
    over: r.homeGoals + r.awayGoals > 2.5 ? 1 : 0, btts: r.homeGoals > 0 && r.awayGoals > 0 ? 1 : 0,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals,
    baseline1x2: b1x2, temp1x2: scaleOneXTwoProbabilities(b1x2, ONE_X_TWO_TEMPERATURE), calibrated1x2: matrixTo1x2(calibrated),
    baselineOver: matrixToTotals(baseline, 2.5)[0], anchoredOver: matrixToTotals(anchored, 2.5)[0],
    baselineBtts: matrixToBtts(baseline)[0], anchoredBtts: matrixToBtts(anchored)[0],
    anchoredScoreP: anchored[Math.min(r.homeGoals, 10)]?.[Math.min(r.awayGoals, 10)] ?? 1e-12,
    baselineScoreP: baseline[Math.min(r.homeGoals, 10)]?.[Math.min(r.awayGoals, 10)] ?? 1e-12 };
}

// Rolling weekly origins: fit on data available 24h before each Monday, forecast that week.
const preds: Pred[] = [];
const fitsLog: { origin: string; trainingCount: number; allocationTrainingCount: number; converged: boolean }[] = [];
for (let o = Date.parse("2025-09-01T00:00:00.000Z"); o <= Date.parse("2026-10-19T00:00:00.000Z"); o += WEEK) {
  const week = rows.filter((r) => r.homeElo !== undefined && Date.parse(r.kickoff) >= o && Date.parse(r.kickoff) < o + WEEK);
  if (!week.length) continue;
  const train = trainingFor(o);
  if (train.length < 100 || train.filter((r) => r.homeElo !== undefined).length < 30) continue;
  const origin = new Date(o).toISOString();
  const fit = fitHistoricalGoalRates(train, origin, OPTIONS);
  fitsLog.push({ origin, trainingCount: fit.trainingCount, allocationTrainingCount: fit.allocationTrainingCount, converged: fit.converged });
  if (!fit.converged) continue;
  for (const r of week) preds.push(predict(fit, r, origin));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const ll1x2 = (p: Tri, y: number) => -Math.log(Math.max(p[y], 1e-15));
const brier1x2 = (p: Tri, y: number) => p.reduce((s, v, i) => s + (v - (i === y ? 1 : 0)) ** 2, 0);
const rps = (p: Tri, y: number) => { const c1 = p[0] - (y === 0 ? 1 : 0), c2 = p[0] + p[1] - (y <= 1 ? 1 : 0); return (c1 ** 2 + c2 ** 2) / 2; };
const llBin = (p: number, y: number) => -Math.log(Math.max(y ? p : 1 - p, 1e-15));
function reliability(ps: number[], ys: number[], bins = 10) {
  const out: { bin: string; n: number; meanPredicted: number; observed: number }[] = [];
  let ece = 0;
  for (let b = 0; b < bins; b += 1) {
    const idx = ps.map((p, i) => i).filter((i) => ps[i] >= b / bins && (ps[i] < (b + 1) / bins || (b === bins - 1 && ps[i] <= 1)));
    if (!idx.length) continue;
    const mp = mean(idx.map((i) => ps[i])), ob = mean(idx.map((i) => ys[i]));
    ece += (idx.length / ps.length) * Math.abs(mp - ob);
    out.push({ bin: `${(b / bins).toFixed(1)}-${((b + 1) / bins).toFixed(1)}`, n: idx.length, meanPredicted: +mp.toFixed(4), observed: +ob.toFixed(4) });
  }
  return { ece: +ece.toFixed(4), bins: out };
}
function ece(ps: number[], ys: number[]) { return reliability(ps, ys).ece; }
function triMetrics(get: (p: Pred) => Tri, set: Pred[]) {
  return { logLoss: +mean(set.map((p) => ll1x2(get(p), p.result))).toFixed(4),
    brier: +mean(set.map((p) => brier1x2(get(p), p.result))).toFixed(4),
    rps: +mean(set.map((p) => rps(get(p), p.result))).toFixed(4),
    eceHome: ece(set.map((p) => get(p)[0]), set.map((p) => +(p.result === 0))),
    eceDraw: ece(set.map((p) => get(p)[1]), set.map((p) => +(p.result === 1))),
    eceAway: ece(set.map((p) => get(p)[2]), set.map((p) => +(p.result === 2))) };
}
function binMetrics(get: (p: Pred) => number, y: (p: Pred) => number, set: Pred[]) {
  return { logLoss: +mean(set.map((p) => llBin(get(p), y(p)))).toFixed(4),
    brier: +mean(set.map((p) => (get(p) - y(p)) ** 2)).toFixed(4), ece: ece(set.map(get), set.map(y)),
    meanPredicted: +mean(set.map(get)).toFixed(4), observedRate: +mean(set.map(y)).toFixed(4) };
}
// Seeded bootstrap (mulberry32), 2000 resamples over matches.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootstrap(stat: (s: Pred[]) => number, B = 2000) {
  const rand = rng(20261022), vals: number[] = [];
  for (let b = 0; b < B; b += 1) vals.push(stat(preds.map(() => preds[Math.floor(rand() * preds.length)])));
  vals.sort((a, b) => a - b);
  return { estimate: +stat(preds).toFixed(4), ci95: [+vals[Math.floor(0.025 * B)].toFixed(4), +vals[Math.floor(0.975 * B)].toFixed(4)],
    shareBelowZero: +(vals.filter((v) => v < 0).length / B).toFixed(4), resamples: B, seed: 20261022 };
}
const d = (f: (p: Pred) => number, g: (p: Pred) => number) => (s: Pred[]) => mean(s.map((p) => f(p) - g(p)));

// Final re-fit at the new origin on current + last season.
const finalTrain = trainingFor(Date.parse(ORIGIN));
const fit = fitHistoricalGoalRates(finalTrain, ORIGIN, OPTIONS);
const pinned = JSON.parse(readFileSync(resolve(ROOT, `packages/api/data/model-artifacts/epl-goal-calibration/${PINNED}.json`), "utf8"));
const coeffs = (f: HistoricalGoalFit) => ({ intercept: +f.intercept.toFixed(4), allocationSlope: +f.allocationSlope.toFixed(4),
  homeOffset: +f.homeOffset.toFixed(4), rho: f.rho, decayDays: f.options.decayDays, teamPrecision: f.options.teamPrecision,
  trainingCount: f.trainingCount, allocationTrainingCount: f.allocationTrainingCount, trainingThrough: f.trainingThrough });

// Example fixtures at the live ClubElo pin (13d23cc4, 20 Oct 2026).
const pin = JSON.parse(readFileSync(resolve(ROOT, "packages/api/data/model-artifacts/clubelo/13d23cc4304d3a14c759f5da01a721440afdb41698522bc0604872314841ce29.json"), "utf8"));
const elo = pin.payload.byProfile["eng-clubs"] as Record<string, number>;
const examples = [["Arsenal", "Everton"], ["Ipswich", "Forest"], ["Man City", "Burnley"], ["Liverpool", "Chelsea"]]
  .filter(([h, a]) => elo[h] !== undefined && elo[a] !== undefined).map(([h, a]) => {
    const b = matrixTo1x2(scoreMatrix(...eloToLambdas(elo[h], elo[a], DEFAULT_HOME_ADVANTAGE_ELO)));
    const t = scaleOneXTwoProbabilities(b, ONE_X_TWO_TEMPERATURE);
    const pct = (x: Tri) => x.map((v) => +(100 * v).toFixed(1));
    const goals = (f: HistoricalGoalFit) => { const m = anchorScoreGridTo1x2(scoreMatrix(...historicalGoalLambdas(f, { homeCanonicalName: h, awayCanonicalName: a, homeElo: elo[h], awayElo: elo[a] }), f.rho), b).matrix;
      return { over25: +(100 * matrixToTotals(m, 2.5)[0]).toFixed(1), btts: +(100 * matrixToBtts(m)[0]).toFixed(1) }; };
    return { fixture: `${h} v ${a}`, homeElo: elo[h], awayElo: elo[a], oneXTwoNow: pct(b), oneXTwoT1286: pct(t),
      pinnedA502: goals(pinned.fit), candidate: goals(fit) };
  });

const report = {
  schemaVersion: 1, experimentId: "epl-goal-calibration-refit-2026-10-22", generatedFrom: "scripts/refit-epl-goal-calibration-2026-10-22.ts",
  productionChanged: false,
  inputs: { manifest: "model/calibration-2026-10-22/inputs/manifest.json", matchesSha256: manifest.matchesSha256,
    matches: rows.length, matchesWithRatings: rows.filter((r) => r.homeElo !== undefined).length },
  method: { model: "shrunk-event-rate-elo-allocation-v1 + outcome anchoring to the Elo/DC 1X2 (same code as production)",
    options: OPTIONS, trainingWindow: "current + previous EPL season, results available 24h before origin",
    backtest: "rolling weekly origins 2025-09-01..2026-10-19; each week forecast with a fit using only earlier results; ratings dated strictly before kickoff (<=14 days old)" },
  fit: { origin: ORIGIN, candidate: coeffs(fit), pinnedA502: coeffs(pinned.fit), converged: fit.converged, gradientNorm: fit.gradientNorm },
  backtest: {
    predictions: preds.length, firstKickoff: preds[0]?.kickoff, lastKickoff: preds[preds.length - 1]?.kickoff, folds: fitsLog.length,
    oneXTwo: { published: triMetrics((p) => p.baseline1x2, preds), temperatureT1286: triMetrics((p) => p.temp1x2, preds),
      calibratedGoalRatesOnly: triMetrics((p) => p.calibrated1x2, preds) },
    over25: { baselineFixed270: binMetrics((p) => p.baselineOver, (p) => p.over, preds), anchoredProduction: binMetrics((p) => p.anchoredOver, (p) => p.over, preds) },
    btts: { baselineFixed270: binMetrics((p) => p.baselineBtts, (p) => p.btts, preds), anchoredProduction: binMetrics((p) => p.anchoredBtts, (p) => p.btts, preds) },
    scorelineLogLoss: { baselineFixed270: +mean(preds.map((p) => -Math.log(p.baselineScoreP))).toFixed(4), anchoredProduction: +mean(preds.map((p) => -Math.log(p.anchoredScoreP))).toFixed(4) },
  },
  reliability: {
    homeWinPublished: reliability(preds.map((p) => p.baseline1x2[0]), preds.map((p) => +(p.result === 0))),
    homeWinT1286: reliability(preds.map((p) => p.temp1x2[0]), preds.map((p) => +(p.result === 0))),
    drawPublished: reliability(preds.map((p) => p.baseline1x2[1]), preds.map((p) => +(p.result === 1))),
    awayWinPublished: reliability(preds.map((p) => p.baseline1x2[2]), preds.map((p) => +(p.result === 2))),
    awayWinT1286: reliability(preds.map((p) => p.temp1x2[2]), preds.map((p) => +(p.result === 2))),
    over25Anchored: reliability(preds.map((p) => p.anchoredOver), preds.map((p) => p.over)),
    bttsAnchored: reliability(preds.map((p) => p.anchoredBtts), preds.map((p) => p.btts)),
  },
  bootstrap: {
    note: "Differences are mean per-match loss (first minus second). Negative = first is better.",
    oneXTwoLogLoss_T1286_minus_published: bootstrap(d((p) => ll1x2(p.temp1x2, p.result), (p) => ll1x2(p.baseline1x2, p.result))),
    oneXTwoRps_T1286_minus_published: bootstrap(d((p) => rps(p.temp1x2, p.result), (p) => rps(p.baseline1x2, p.result))),
    over25LogLoss_anchored_minus_baseline: bootstrap(d((p) => llBin(p.anchoredOver, p.over), (p) => llBin(p.baselineOver, p.over))),
    bttsLogLoss_anchored_minus_baseline: bootstrap(d((p) => llBin(p.anchoredBtts, p.btts), (p) => llBin(p.baselineBtts, p.btts))),
    homeWinEce_published: bootstrap((s) => ece(s.map((p) => p.baseline1x2[0]), s.map((p) => +(p.result === 0)))),
    homeWinEce_T1286: bootstrap((s) => ece(s.map((p) => p.temp1x2[0]), s.map((p) => +(p.result === 0)))),
  },
  examplesAtLivePin: examples,
  folds: fitsLog,
};
writeFileSync(resolve(DIR, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
writeFileSync(resolve(DIR, "candidate-fit.json"), `${JSON.stringify(fit, null, 1)}\n`);
writeFileSync(resolve(DIR, "backtest-predictions.json"), `${JSON.stringify(preds)}\n`);
console.log(JSON.stringify({ fit: report.fit, backtest: report.backtest, bootstrap: report.bootstrap, examples }, null, 1));
