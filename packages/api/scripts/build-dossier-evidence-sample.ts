/**
 * Rebuild Chelsea vs Tottenham sample with Phase 2 evidence from search replay (no live search).
 *
 * Usage:
 *   CHAT_EVAL_SEARCH_REPLAY_DIR=packages/api/data/research/match-dossier/search-replays \
 *   MATCH_DOSSIER_EVIDENCE_ENABLED=true DOSSIER_SAMPLES_SKIP_MARKET=true \
 *   pnpm exec tsx scripts/build-dossier-evidence-sample.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshFootballData } from "../src/services/football-data";
import { getActiveFixtures } from "../src/services/active-fixtures";
import { refreshModelData, getCachedModelData } from "../src/services/model-data";
import { startClubRatingsCron } from "../src/services/club-ratings";
import {
  buildMatchDossierForFixtureAsync,
  publicFixtureId,
} from "../src/services/match-dossier/builder";
import { DOSSIER_EVIDENCE_REPLAY_ID } from "../src/services/match-dossier/flags";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const samplesDir = path.join(repoRoot, "docs/dossier/samples");
const TARGET_ESPN_ID = 401878767;

async function main(): Promise<void> {
  process.env.MATCH_DOSSIER_ENABLED = "true";
  process.env.MATCH_DOSSIER_EVIDENCE_ENABLED = "true";
  if (!process.env.CHAT_EVAL_SEARCH_REPLAY_DIR) {
    process.env.CHAT_EVAL_SEARCH_REPLAY_DIR = path.join(
      repoRoot,
      "packages/api/data/research/match-dossier/search-replays",
    );
  }
  process.env.MATCH_DOSSIER_EVIDENCE_REPLAY = DOSSIER_EVIDENCE_REPLAY_ID;

  console.log("[dossier-evidence-sample] Bootstrapping ESPN + ClubElo + model…");
  await startClubRatingsCron();
  await refreshFootballData();
  const active = getActiveFixtures();
  await refreshModelData(active);

  const model = getCachedModelData();
  const row = model.fixtures.find((f) => f.fixtureId === TARGET_ESPN_ID)
    ?? model.fixtures.find((f) => f.home === "Chelsea" && f.away === "Tottenham");
  if (!row) {
    console.error("[dossier-evidence-sample] Chelsea vs Tottenham not in model cache");
    process.exitCode = 1;
    return;
  }

  const builtAt = new Date("2026-10-19T10:40:00.000Z");
  const dossier = await buildMatchDossierForFixtureAsync(row, {
    scheduleReason: "manual",
    now: builtAt,
  });

  const fileName = `${publicFixtureId(row).replace(/:/g, "-")}.json`;
  fs.mkdirSync(samplesDir, { recursive: true });
  fs.writeFileSync(
    path.join(samplesDir, fileName),
    `${JSON.stringify(dossier, null, 2)}\n`,
    "utf8",
  );

  console.log(`[dossier-evidence-sample] Wrote ${fileName} evidence=${dossier.evidence.length} replay=${dossier.evidenceBuild?.replayId}`);
}

main().catch((error) => {
  console.error("[dossier-evidence-sample] Failed:", error);
  process.exitCode = 1;
});
