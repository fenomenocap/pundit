/**
 * seed-wc-group-markets.ts
 *
 * Replaces the 8 fictional group-stage match markets (onchainId 8–15) with
 * real "Will X win Group Y?" markets sourced live from Polymarket's events API.
 *
 * Safe to run multiple times — skips markets that already exist by onchainId.
 *
 * Usage (from repo root):
 *   DATABASE_URL=<url> npx ts-node packages/api/scripts/seed-wc-group-markets.ts
 *
 * Or with the .env already present:
 *   npx ts-node -r dotenv/config packages/api/scripts/seed-wc-group-markets.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const GAMMA_BASE = "https://gamma-api.polymarket.com";

// The 8 fictional group-stage match markets to remove
const FAKE_MATCH_ONCHAIN_IDS = [8, 9, 10, 11, 12, 13, 14, 15];

// Starting onchainId for new group winner markets (after our existing 56)
const GROUP_MARKET_ONCHAIN_START = 56;

// Resolution timestamp: group stage ends roughly July 3 2026
const GROUP_STAGE_END = new Date("2026-07-03T00:00:00.000Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchGroupEvents(): Promise<any[]> {
  const res = await fetch(
    `${GAMMA_BASE}/events?tag_slug=sports&active=true&closed=false&limit=100`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  return res.json() as Promise<any[]>;
}

function parseNumberArray(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((v) => parseFloat(String(v))).filter((n) => !isNaN(n));
}

async function main() {
  console.log("── WC Group Market Seeder ──────────────────────────────");

  // 1. Remove fake match markets (only if they have no trades)
  console.log("\n[1] Removing fake group-stage match markets...");
  for (const onchainId of FAKE_MATCH_ONCHAIN_IDS) {
    const market = await prisma.market.findUnique({ where: { onchainId } });
    if (!market) {
      console.log(`  onchainId=${onchainId} not found, skipping`);
      continue;
    }
    const tradeCount = await prisma.trade.count({ where: { marketId: market.id } });
    if (tradeCount > 0) {
      console.log(`  onchainId=${onchainId} has ${tradeCount} trades — skipping deletion`);
      continue;
    }
    await prisma.position.deleteMany({ where: { marketId: market.id } });
    await prisma.market.delete({ where: { id: market.id } });
    console.log(`  Deleted onchainId=${onchainId}: ${market.question}`);
  }

  // 2. Fetch group winner events from Polymarket
  console.log("\n[2] Fetching group winner events from Polymarket...");
  const events = await fetchGroupEvents();
  const groupEvents = events.filter((e) =>
    /world cup group [a-l] winner/i.test(e.title || e.name || "")
  );
  console.log(`  Found ${groupEvents.length} group winner events`);

  // 3. Seed group winner markets
  console.log("\n[3] Seeding group winner markets...");
  let onchainId = GROUP_MARKET_ONCHAIN_START;
  let created = 0;

  groupEvents.sort((a, b) => {
    const ga = (a.title || "").match(/group ([a-l])/i)?.[1]?.toUpperCase() ?? "";
    const gb = (b.title || "").match(/group ([a-l])/i)?.[1]?.toUpperCase() ?? "";
    return ga.localeCompare(gb);
  });

  for (const event of groupEvents) {
    const groupMatch = (event.title || "").match(/world cup group ([a-l]) winner/i);
    if (!groupMatch) continue;
    const group = groupMatch[1].toUpperCase();

    const realMarkets = (event.markets || []).filter(
      (m: any) => !/another team/i.test(m.question || "")
    );

    for (const m of realMarkets) {
      const question: string = m.question || "";
      const conditionId: string = m.conditionId || "";
      const prices = parseNumberArray(m.outcomePrices);

      // Extract team name from "Will X win Group Y in the 2026 FIFA World Cup?"
      const teamMatch = question.match(/^Will (.+?) win Group [A-L]/i);
      const teamName = teamMatch?.[1] ?? null;

      // Skip if already exists by onchainId
      const existing = await prisma.market.findUnique({ where: { onchainId } });
      if (existing) {
        console.log(`  onchainId=${onchainId} already exists (${existing.question}), skipping`);
        onchainId++;
        continue;
      }

      await prisma.market.create({
        data: {
          onchainId,
          question,
          outcomeA: "Yes",
          outcomeB: "No",
          outcomeC: null,
          category: "WORLD_CUP",
          teamA: teamName,
          teamB: null,
          polymarketId: conditionId || null,
          resolutionTimestamp: GROUP_STAGE_END,
        },
      });

      const pct = prices[0] != null ? `${(prices[0] * 100).toFixed(1)}%` : "?";
      console.log(`  Created onchainId=${onchainId} Group ${group}: ${question} (PM: ${pct})`);
      onchainId++;
      created++;
    }
  }

  console.log(`\n✓ Done. Created ${created} group winner markets.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
