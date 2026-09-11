import path from "node:path";
import { appendDixonColesMleChallenger } from "../src/services/challenger-registration";
import { REGISTERED_CHALLENGERS } from "../src/services/model-contributors";

/**
 * Fail-closed registration gate. Appends dixon-coles-mle to a candidate list
 * only when research/dixon-coles-mle/latest.json exists and validates.
 * Does not rewrite model-contributors.ts, does not activate production
 * (model-data.ts still uses ELO_CHAMPION), and does not contact ClubElo.
 *
 *   pnpm --filter @sports-predict/api register:dixon-coles-mle
 */
const DATA_DIR = path.join(__dirname, "../data");

function main(): void {
  const result = appendDixonColesMleChallenger(REGISTERED_CHALLENGERS, DATA_DIR);
  console.log(JSON.stringify({
    status: result.status,
    reason: result.reason,
    productionRegisteredChallengers: REGISTERED_CHALLENGERS.length,
    wouldRegisterCount: result.challengers.length,
    contributorId: result.contributor?.id ?? null,
    methodId: result.contributor?.methodId ?? null,
    version: result.contributor?.version ?? null,
    artifactSha256: result.artifactSha256,
    activated: false,
  }, null, 2));
  if (result.status !== "registered") {
    console.error(
      `Registration blocked (${result.reason}). Source REGISTERED_CHALLENGERS unchanged. `
      + "Train a reviewed artifact first: pnpm --filter @sports-predict/api train:dixon-coles-mle"
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();
