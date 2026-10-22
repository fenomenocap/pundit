/**
 * Build the 22 Oct 2026 EPL goal-calibration pin (the #404 configuration).
 *
 * Offline. Reads only committed inputs and never contacts a provider:
 *   model/epl-repin-2026-11-06/inputs/matches.json (+ manifest.json)
 * football-data.co.uk E0 2026/27 was re-downloaded on the pin day
 * (2026-10-22T16:27Z) and is byte-identical to the committed raw file, so the
 * committed inputs are today's data (see model/epl-pin-2026-10-22/pin-receipt.json).
 *
 * Config: every EPL result from 2018/19 through 24 hours before the origin,
 * decay 180 days, team precision 100. T (ONE_X_TWO_TEMPERATURE_ENABLED) is not
 * part of the artifact and stays OFF.
 *
 *   packages/api/node_modules/.bin/tsx scripts/build-epl-goal-calibration-2026-10-22.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalClubName } from "../packages/api/src/lib/team-names";
import { EPL_GOAL_CALIBRATION_METHOD_ID, validateEplGoalCalibrationArtifact } from "../packages/api/src/services/epl-goal-calibration-artifact";
import { fitHistoricalGoalRates } from "../packages/api/src/services/historical-goal-calibration";

const ROOT = resolve(__dirname, "..");
const ORIGIN = "2026-10-22T00:00:00.000Z";
const OPTIONS = { decayDays: 180, teamPrecision: 100 } as const;
const DAY = 86_400_000;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const ref = (path: string) => ({ path, sha256: sha(readFileSync(resolve(ROOT, path))) });

const INPUTS = "model/epl-repin-2026-11-06/inputs";
const matchesBytes = readFileSync(resolve(ROOT, `${INPUTS}/matches.json`));
const manifest = JSON.parse(readFileSync(resolve(ROOT, `${INPUTS}/manifest.json`), "utf8"));
if (sha(matchesBytes) !== manifest.matchesSha256) throw new Error("matches.json does not match its manifest");
const rows = JSON.parse(matchesBytes.toString("utf8"));
for (const row of rows) {
  for (const name of [row.homeCanonicalName, row.awayCanonicalName]) {
    if (canonicalClubName(name) !== name) throw new Error(`Non-canonical club ${name}`);
  }
}
const training = rows.filter((row: { kickoff: string }) => Date.parse(row.kickoff) <= Date.parse(ORIGIN) - DAY);
const fit = fitHistoricalGoalRates(training, ORIGIN, OPTIONS);
if (!fit.converged || fit.gradientNorm > 1e-7) throw new Error(`Fit did not converge (gradient ${fit.gradientNorm})`);

// The #404 review fit at the same origin must be reproduced exactly.
const review = JSON.parse(readFileSync(resolve(ROOT, "model/epl-repin-2026-11-06/recommended-fit.json"), "utf8")).goal;
for (const key of ["origin", "intercept", "allocationSlope", "homeOffset", "rho", "trainingCount", "allocationTrainingCount", "trainingThrough", "trainingSha256"] as const) {
  if (JSON.stringify(fit[key]) !== JSON.stringify(review[key])) throw new Error(`Fit ${key} differs from #404 recommended-fit.json`);
}

const raw = Object.keys(manifest.results).sort().map((season) => manifest.results[season].path as string);
const artifact = {
  schemaVersion: 1,
  methodId: EPL_GOAL_CALIBRATION_METHOD_ID,
  competitionId: "eng.1",
  fit,
  review: {
    experimentId: "outcome-anchored-goal-rates-v2",
    source: [
      "packages/api/src/services/historical-goal-calibration.ts",
      "packages/api/src/services/dixon-coles.ts",
      "packages/api/src/services/outcome-anchored-score-grid.ts",
      "packages/api/src/services/historical-goal-evaluation.ts",
      "packages/api/src/lib/team-names.ts",
      "model/epl-repin-2026-11-06/prepare_inputs.py",
      "scripts/build-epl-goal-calibration-2026-10-22.ts",
    ].map(ref),
    training: [`${INPUTS}/manifest.json`, `${INPUTS}/matches.json`, ...raw, manifest.clubeloMirror.path as string].map(ref),
    evaluation: [
      "scripts/epl-repin-walkforward-2026-10-22.ts",
      "model/epl-repin-2026-11-06/decision.json",
      "model/epl-repin-2026-11-06/experiment-log.json",
      "model/epl-repin-2026-11-06/report.json",
      "model/epl-repin-2026-11-06/reliability.json",
      "model/epl-repin-2026-11-06/recommended-fit.json",
      "model/epl-repin-2026-11-06/review/temperature-walk-forward.json",
      "model/epl-repin-2026-11-06/review/market-close.txt",
    ].map(ref),
  },
};
const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
const artifactSha256 = sha(bytes);
validateEplGoalCalibrationArtifact(bytes, artifactSha256, new Date(Date.parse(ORIGIN) + DAY), ORIGIN);
const out = resolve(ROOT, "packages/api/data/model-artifacts/epl-goal-calibration", `${artifactSha256}.json`);
if (existsSync(out)) {
  if (sha(readFileSync(out)) !== artifactSha256) throw new Error("Existing artifact bytes differ");
} else {
  writeFileSync(out, bytes, { flag: "wx" });
}
console.log(JSON.stringify({ artifactSha256, origin: ORIGIN, expires: new Date(Date.parse(ORIGIN) + 30 * DAY).toISOString(),
  intercept: fit.intercept, allocationSlope: fit.allocationSlope, homeOffset: fit.homeOffset, rho: fit.rho,
  trainingCount: fit.trainingCount, allocationTrainingCount: fit.allocationTrainingCount, trainingThrough: fit.trainingThrough }, null, 1));
