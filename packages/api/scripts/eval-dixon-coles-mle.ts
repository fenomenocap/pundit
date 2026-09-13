import path from "node:path";
import { evaluatePairedRollingOriginFromDataDir } from "../src/services/challenger-eval";
import { REGISTERED_CHALLENGERS } from "../src/services/model-contributors";

/**
 * Offline rolling-origin champion vs challenger gate.
 * Fail-closed without research/dixon-coles-mle/latest.json plus the ESPN and
 * pre-kickoff ClubElo corpora. Does not rewrite model-contributors.ts, does
 * not change 1.35 / 42 / −0.1, and does not activate production.
 *
 *   pnpm --filter @sports-predict/api eval:dixon-coles-mle
 */
const DATA_DIR = path.join(__dirname, "../data");

function main(): void {
  const result = evaluatePairedRollingOriginFromDataDir(DATA_DIR);
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason,
    artifactSha256: result.artifactSha256,
    originCount: result.origins.length,
    pairedForecastCount: result.pairedForecasts.length,
    recommendPromotion: result.decision.recommendPromotion,
    activateProduction: result.decision.activateProduction,
    changeShippedConstants: result.decision.changeShippedConstants,
    humanDecisionRequired: result.decision.humanDecisionRequired,
    reasons: result.decision.reasons,
    productionRegisteredChallengers: REGISTERED_CHALLENGERS.length,
    reportPath: path.join(DATA_DIR, "research/dixon-coles-mle/eval-report.json"),
  }, null, 2));
  if (result.status !== "evaluated") process.exitCode = 1;
}

if (require.main === module) main();
