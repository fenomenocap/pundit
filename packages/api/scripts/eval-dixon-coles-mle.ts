import path from "node:path";
import {
  evaluatePairedRollingOriginFromDataDir,
} from "../src/services/challenger-eval";
import { REGISTERED_CHALLENGERS } from "../src/services/model-contributors";
import fs from "node:fs";

/**
 * Offline rolling-origin champion vs challenger gate, plus a weekly
 * expanding-window companion report. Fail-closed without
 * research/dixon-coles-mle/latest.json plus the ESPN and pre-kickoff ClubElo
 * corpora. Does not rewrite model-contributors.ts, does not change
 * 1.35 / 42 / −0.1, and does not activate production.
 *
 *   pnpm --filter @sports-predict/api eval:dixon-coles-mle
 */
const DATA_DIR = path.join(__dirname, "../data");

function main(): void {
  const result = evaluatePairedRollingOriginFromDataDir(DATA_DIR);
  const weeklyPath = path.join(DATA_DIR, "research/dixon-coles-mle/eval-report-weekly.json");
  let weeklySummary: Record<string, unknown> | null = null;
  if (fs.existsSync(weeklyPath)) {
    const weekly = JSON.parse(fs.readFileSync(weeklyPath, "utf8")) as {
      status: string;
      reason: string;
      origins: Array<{ uncoveredCount: number; priorOnlyCount: number; scoredCount: number }>;
      uniqueHoldoutCount: number;
      decision: { recommendPromotion: boolean };
    };
    weeklySummary = {
      status: weekly.status,
      reason: weekly.reason,
      originCount: weekly.origins?.length ?? 0,
      scoredPairCount: weekly.origins?.reduce((sum, origin) => sum + origin.scoredCount, 0) ?? 0,
      uncoveredPairCount: weekly.origins?.reduce((sum, origin) => sum + origin.uncoveredCount, 0) ?? 0,
      priorOnlyPairCount: weekly.origins?.reduce((sum, origin) => sum + origin.priorOnlyCount, 0) ?? 0,
      uniqueHoldoutCount: weekly.uniqueHoldoutCount,
      recommendPromotion: weekly.decision?.recommendPromotion ?? false,
      reportPath: weeklyPath,
    };
  }
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason,
    artifactSha256: result.artifactSha256,
    originCount: result.origins.length,
    forecastPairAttempts: result.pairedForecasts.length,
    scoredPairCount: result.pairedForecasts.filter((pair) => pair.challenger !== null).length,
    priorOnlyPairCount: result.pairedForecasts.filter((pair) => pair.priorOnly).length,
    uncoveredPairCount: result.pairedForecasts.filter((pair) => pair.challenger === null).length,
    uniqueHoldoutCount: result.uniqueHoldoutCount,
    recommendPromotion: result.decision.recommendPromotion,
    activateProduction: result.decision.activateProduction,
    changeShippedConstants: result.decision.changeShippedConstants,
    humanDecisionRequired: result.decision.humanDecisionRequired,
    humanSaidPromote: false,
    reasons: result.decision.reasons,
    productionRegisteredChallengers: REGISTERED_CHALLENGERS.length,
    reportPath: path.join(DATA_DIR, "research/dixon-coles-mle/eval-report.json"),
    weekly: weeklySummary,
  }, null, 2));
  if (result.status !== "evaluated") process.exitCode = 1;
}

if (require.main === module) main();
