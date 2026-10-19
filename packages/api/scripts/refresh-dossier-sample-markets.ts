import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startClubRatingsCron } from "../src/services/club-ratings";
import { refreshFootballData } from "../src/services/football-data";
import { getActiveFixtures } from "../src/services/active-fixtures";
import { refreshModelData, getCachedModelData } from "../src/services/model-data";
import { refreshModelMarketOdds } from "../src/services/model-market-odds";
import { buildGrounding } from "../src/services/ask";
import { findModelFixtureByDossierId } from "../src/services/match-dossier/builder";

const samplesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/dossier/samples",
);

async function main(): Promise<void> {
  await startClubRatingsCron();
  await refreshFootballData();
  await refreshModelData(getActiveFixtures());
  await refreshModelMarketOdds();

  const manifest = JSON.parse(
    fs.readFileSync(path.join(samplesDir, "manifest.json"), "utf8"),
  ) as { fixtures: Array<{ fixtureId: string; file: string }> };

  for (const entry of manifest.fixtures) {
    const fixture = findModelFixtureByDossierId(entry.fixtureId);
    if (!fixture) continue;
    const filePath = path.join(samplesDir, entry.file);
    const dossier = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const grounding = buildGrounding(fixture);
    const markets = grounding.pricing.markets;
    const observedAt = markets[0]?.observedAt ?? new Date().toISOString();
    (dossier.market as Record<string, unknown>) = {
      value: {
        rows: markets.map((row) => ({
          source: row.source,
          observedAt: row.observedAt,
          pHome: row.legs.home.impliedP ?? row.legs.home.modelP,
          pDraw: row.legs.draw.impliedP ?? row.legs.draw.modelP,
          pAway: row.legs.away.impliedP ?? row.legs.away.modelP,
        })),
      },
      provenance: {
        sourceId: "fixture-market-sources",
        label: "Stake / Kalshi / Polymarket (no-vig)",
        trustTier: "market-fetch",
        asOf: observedAt,
      },
    };
    fs.writeFileSync(filePath, `${JSON.stringify(dossier, null, 2)}\n`, "utf8");
  }
  console.log("[refresh-dossier-sample-markets] Updated market rows for", manifest.fixtures.length, "samples");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
