/**
 * Build Phase 1 dossier samples for the 23–25 Oct EPL window using live ESPN + pinned artifacts.
 * Writes committed samples to docs/dossier/samples/ (repo path, not PUNDIT_DATA_DIR).
 *
 * Usage (local only): MATCH_DOSSIER_ENABLED=true pnpm exec tsx scripts/build-dossier-samples.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshFootballData } from "../src/services/football-data";
import { getActiveFixtures } from "../src/services/active-fixtures";
import { refreshModelData } from "../src/services/model-data";
import { refreshModelMarketOdds } from "../src/services/model-market-odds";
import { startClubRatingsCron } from "../src/services/club-ratings";
import {
  buildDossiersForWindow,
  PHASE1_WEEKEND_WINDOW,
} from "../src/services/match-dossier/builder";
import type { MatchDossier } from "../src/services/match-dossier/types";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const samplesDir = path.join(repoRoot, "docs/dossier/samples");

async function main(): Promise<void> {
  process.env.MATCH_DOSSIER_ENABLED = "true";
  console.log("[dossier-samples] Bootstrapping ESPN + ClubElo + model + markets…");
  await startClubRatingsCron();
  await refreshFootballData();
  const active = getActiveFixtures();
  await refreshModelData(active);
  if (process.env.DOSSIER_SAMPLES_SKIP_MARKET !== "true") {
    await refreshModelMarketOdds();
  } else {
    console.log("[dossier-samples] Skipping market odds refresh (DOSSIER_SAMPLES_SKIP_MARKET=true)");
  }

  const builtAt = new Date();
  const dossiers = buildDossiersForWindow(PHASE1_WEEKEND_WINDOW, {
    scheduleReason: "manual",
    now: builtAt,
  });

  fs.mkdirSync(samplesDir, { recursive: true });
  const manifest: {
    builtAt: string;
    window: typeof PHASE1_WEEKEND_WINDOW;
    fixtureCount: number;
    fixtures: Array<{ fixtureId: string; kickoffUtc: string; home: string; away: string; file: string }>;
    sourceNotes: string[];
  } = {
    builtAt: builtAt.toISOString(),
    window: PHASE1_WEEKEND_WINDOW,
    fixtureCount: dossiers.length,
    fixtures: [],
    sourceNotes: [
      "ESPN public scoreboard (table, form, rest, H2H)",
      "Pinned clubelo@1 artifact (model strengths + factor breakdown)",
      "Stake/Kalshi/Polymarket bounded fetch where available (market reference only)",
      "Injuries/lineups/manager/search evidence empty in Phase 1",
    ],
  };

  if (dossiers.length === 0) {
    manifest.sourceNotes.push(
      "WARNING: zero fixtures in window — model cache may lack Oct 23–25 rows (check ESPN refresh).",
    );
    fs.writeFileSync(
      path.join(samplesDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.warn("[dossier-samples] No dossiers built for window", PHASE1_WEEKEND_WINDOW);
    process.exitCode = 1;
    return;
  }

  for (const dossier of dossiers) {
    const safeName = dossier.fixture.fixtureId.replace(/:/g, "-");
    const fileName = `${safeName}.json`;
    fs.writeFileSync(
      path.join(samplesDir, fileName),
      `${JSON.stringify(dossier, null, 2)}\n`,
      "utf8",
    );
    manifest.fixtures.push({
      fixtureId: dossier.fixture.fixtureId,
      kickoffUtc: dossier.fixture.kickoffUtc,
      home: dossier.fixture.home,
      away: dossier.fixture.away,
      file: fileName,
    });
  }

  fs.writeFileSync(
    path.join(samplesDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`[dossier-samples] Wrote ${dossiers.length} dossiers to ${samplesDir}`);
  console.log(`[dossier-samples] Example: ${dossiers[0]!.fixture.fixtureId}`);
}

main().catch((error) => {
  console.error("[dossier-samples] Failed:", error);
  process.exitCode = 1;
});
