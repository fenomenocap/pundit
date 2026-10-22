// Run: packages/api/node_modules/.bin/tsx model/epl-repin-2026-11-06/review/temperature-walk-forward.ts
// Reviewer: honest walk-forward for a *learned* temperature. For each test season, fit T on all earlier rated seasons only, then score.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_HOME_ADVANTAGE_ELO, RHO, eloToLambdas, matrixTo1x2, scoreMatrix } from "../../../packages/api/src/services/dixon-coles";
import { scaleOneXTwoProbabilities } from "../../../packages/api/src/services/one-x-two-temperature";
const ms = JSON.parse(readFileSync(resolve(__dirname, "../inputs/matches.json"), "utf8")).filter((m: any) => m.homeElo !== undefined);
const rows = ms.map((m: any) => ({ s: m.seasonId, k: m.kickoff, p: matrixTo1x2(scoreMatrix(...eloToLambdas(m.homeElo, m.awayElo, DEFAULT_HOME_ADVANTAGE_ELO), RHO)) as [number, number, number], r: m.homeGoals > m.awayGoals ? 0 : m.homeGoals === m.awayGoals ? 1 : 2 }));
const ll = (rs: any[], T: number) => rs.reduce((s, x) => s - Math.log(scaleOneXTwoProbabilities(x.p, T)[x.r]), 0) / rs.length;
const fitT = (rs: any[]) => { let b = 1, bl = Infinity; for (let T = 0.8; T <= 2.0001; T += 0.005) { const l = ll(rs, T); if (l < bl) { bl = l; b = T; } } return +b.toFixed(3); };
const out: any[] = [];
let tot = { n: 0, d: 0, dFixed: 0 };
for (const test of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  const train = rows.filter((x: any) => x.s < test), te = rows.filter((x: any) => x.s === test);
  const T = fitT(train);
  const d = ll(te, T) - ll(te, 1), dFixed = ll(te, 1.286) - ll(te, 1);
  out.push({ test, nTrain: train.length, nTest: te.length, learnedT: T, deltaLearnedVsT1: +d.toFixed(5), deltaFixed1286VsT1: +dFixed.toFixed(5) });
  if (test === "2024-25" || test === "2025-26") { tot.n += te.length; tot.d += d * te.length; tot.dFixed += dFixed * te.length; }
}
console.log(JSON.stringify({ perSeason: out, dev2024_26: { n: tot.n, deltaLearnedVsT1: +(tot.d / tot.n).toFixed(5), deltaFixed1286VsT1: +(tot.dFixed / tot.n).toFixed(5) } }, null, 1));
