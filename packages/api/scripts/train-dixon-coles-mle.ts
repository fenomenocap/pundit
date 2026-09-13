import path from "node:path";
import { trainFittedDixonColes } from "../src/services/dixon-coles-mle";

/**
 * Offline trainer entry point. Fails closed without reviewed ESPN + pre-kickoff
 * ClubElo artifacts. Does not register a production challenger.
 *
 *   pnpm --filter @sports-predict/api train:dixon-coles-mle
 *   pnpm --filter @sports-predict/api train:dixon-coles-mle -- --force
 */
const DATA_DIR = path.join(__dirname, "../data");

function main(): void {
  const forceRetrain = process.argv.includes("--force");
  const result = trainFittedDixonColes({ dataDir: DATA_DIR, forceRetrain });
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason,
    trainingRowCount: result.trainingRowCount,
    fitScope: result.artifact?.training.fitScope ?? null,
    excludedFixtureCount: result.artifact?.training.excludedFixtureCount ?? null,
    plFixtureCoverage: result.artifact?.training.plFixtureCoverage ?? null,
    clubCount: result.artifact ? Object.keys(result.artifact.params.attack).length : 0,
    intercept: result.artifact?.params.intercept ?? null,
    homeAdvantage: result.artifact?.params.homeAdvantage ?? null,
    rho: result.artifact?.params.rho ?? null,
    converged: result.artifact?.training.converged ?? null,
    splitOrigins: result.artifact?.training.splitManifest.map((split) => split.origin) ?? [],
  }, null, 2));
  if (result.status !== "trained") process.exitCode = 1;
}

if (require.main === module) main();
