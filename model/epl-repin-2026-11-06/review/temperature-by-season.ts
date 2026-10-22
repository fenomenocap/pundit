// Independent review (23 Oct 2026): 1X2 log loss by temperature for each season, Elo 1X2 only (the goal fit does not move 1X2).
// Run: packages/api/node_modules/.bin/tsx model/epl-repin-2026-11-06/review/temperature-by-season.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_HOME_ADVANTAGE_ELO, RHO, eloToLambdas, matrixTo1x2, scoreMatrix } from "../../../packages/api/src/services/dixon-coles";
import { scaleOneXTwoProbabilities } from "../../../packages/api/src/services/one-x-two-temperature";
const ms = JSON.parse(readFileSync(resolve(__dirname, "../inputs/matches.json"), "utf8"));
const Ts = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.286, 1.35, 1.45, 1.6];
const groups: Record<string, any[]> = {};
for (const m of ms) if (m.homeElo !== undefined) (groups[m.seasonId] ??= []).push(m);
groups["DEV 2024-26"] = [...(groups["2024-25"]??[]), ...(groups["2025-26"]??[])];
groups["2023-26"] = [...(groups["2023-24"]??[]), ...groups["DEV 2024-26"]];
const out: any = {};
for (const [g, rows] of Object.entries(groups)) {
  const base = rows.map((m) => ({ p: matrixTo1x2(scoreMatrix(...eloToLambdas(m.homeElo, m.awayElo, DEFAULT_HOME_ADVANTAGE_ELO), RHO)), r: m.homeGoals > m.awayGoals ? 0 : m.homeGoals === m.awayGoals ? 1 : 2 }));
  const res: Record<string, number> = {};
  for (const T of Ts) res[T] = +(base.reduce((s, b) => s - Math.log(scaleOneXTwoProbabilities(b.p as any, T)[b.r]), 0) / base.length).toFixed(5);
  // fine argmin
  let best = 1, bl = Infinity;
  for (let T = 0.8; T <= 2.0001; T += 0.005) { const l = base.reduce((s, b) => s - Math.log(scaleOneXTwoProbabilities(b.p as any, T)[b.r]), 0) / base.length; if (l < bl) { bl = l; best = T; } }
  out[g] = { n: rows.length, logLossByT: res, argminT: +best.toFixed(3), minLoss: +bl.toFixed(5) };
}
console.log(JSON.stringify(out, null, 1));
