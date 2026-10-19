/**
 * Run verified evidence capture for the Oct 23–25 EPL window and refresh committed samples.
 *
 * Requires OPENROUTER_API_KEY (existing #188 search path). Makes live search + page fetches.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... DOSSIER_SAMPLES_SKIP_MARKET=true \
 *   pnpm exec tsx scripts/capture-verified-dossier-samples.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshFootballData } from "../src/services/football-data";
import { getActiveFixtures } from "../src/services/active-fixtures";
import { refreshModelData, getCachedModelData } from "../src/services/model-data";
import { startClubRatingsCron } from "../src/services/club-ratings";
import {
  buildMatchDossierForFixture,
  filterFixturesInKickoffWindow,
  PHASE1_WEEKEND_WINDOW,
  publicFixtureId,
} from "../src/services/match-dossier/builder";
import { collectVerifiedDossierEvidence } from "../src/services/match-dossier/dossier-evidence-capture";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const samplesDir = path.join(repoRoot, "docs/dossier/samples");
const capturesDir = path.join(repoRoot, "docs/dossier/captures");

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("[capture-samples] OPENROUTER_API_KEY is required for federated search.");
    process.exitCode = 1;
    return;
  }

  console.log("[capture-samples] Bootstrapping ESPN + ClubElo + model…");
  await startClubRatingsCron();
  await refreshFootballData();
  await refreshModelData(getActiveFixtures());

  const builtAt = new Date();
  const targets = filterFixturesInKickoffWindow(
    getCachedModelData().fixtures.filter((f) => f.competitionId === "eng.1"),
    PHASE1_WEEKEND_WINDOW,
  );

  const summaryRows: Array<{
    fixtureId: string;
    home: string;
    away: string;
    verified: number;
    dropped: number;
    evidenceCount: number;
    captureFile: string;
  }> = [];

  for (const row of targets) {
    const fixtureId = publicFixtureId(row);
    console.log(`[capture-samples] ${fixtureId} ${row.home} vs ${row.away}…`);
    const verified = await collectVerifiedDossierEvidence(row, {
      now: builtAt,
      persistCapture: false,
      extraCaptureDir: capturesDir,
    });

    const dossier = buildMatchDossierForFixture(row, {
      scheduleReason: "manual",
      now: builtAt,
      evidence: {
        items: verified.items,
        droppedCount: verified.droppedCount,
        queryCount: verified.queryCount,
        replayId: null,
        captureId: verified.captureId ?? null,
      },
    });

    const fileName = `${fixtureId.replace(/:/g, "-")}.json`;
    fs.mkdirSync(samplesDir, { recursive: true });
    fs.writeFileSync(path.join(samplesDir, fileName), `${JSON.stringify(dossier, null, 2)}\n`, "utf8");

    const captureFile = verified.capturePath ?? "";
    summaryRows.push({
      fixtureId,
      home: row.home,
      away: row.away,
      verified: verified.capture.summary.verified,
      dropped: verified.capture.summary.dropped,
      evidenceCount: dossier.evidence.length,
      captureFile: captureFile.replace(`${repoRoot}/`, ""),
    });
    console.log(
      `[capture-samples]   verified=${verified.capture.summary.verified} dropped=${verified.capture.summary.dropped} evidence=${dossier.evidence.length}`,
    );
  }

  const manifestPath = path.join(samplesDir, "capture-summary.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    capturedAt: builtAt.toISOString(),
    window: PHASE1_WEEKEND_WINDOW,
    fixtures: summaryRows,
  }, null, 2)}\n`, "utf8");

  console.log("[capture-samples] Wrote capture-summary.json");
  console.log(JSON.stringify(summaryRows, null, 2));
}

main().catch((error) => {
  console.error("[capture-samples] Failed:", error);
  process.exitCode = 1;
});
