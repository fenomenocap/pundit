/**
 * seed-wc.ts — FIFA World Cup 2026 market seeder
 *
 * Creates markets on-chain via MarketFactory, then registers them in the
 * backend DB via the admin API.
 *
 * Usage:
 *   npx hardhat run scripts/seed-wc.ts --network base_sepolia
 *
 * Requires:
 *   - packages/contracts/deployed-addresses.json (from deploy.ts)
 *   - API_URL env var (default: http://localhost:3001)
 *   - ADMIN_API_KEY env var
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL || "http://localhost:3001";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

// ─── Market Definitions ──────────────────────────────────────────────────────

interface MarketDef {
  question: string;
  outcomeA: string;
  outcomeB: string;
  outcomeC?: string;           // for 3-way (Home/Away/Draw)
  teamA?: string;
  teamB?: string;
  resolutionISO: string;       // ISO 8601 — when we expect the result to be final
  polymarketId?: string;       // Polymarket conditionId for reference odds
  category: "WORLD_CUP";
}

// ─────────────────────────────────────────────────────────────────────────────
// FIFA World Cup 2026 markets
// Tournament runs: 11 June – 19 July 2026 (USA, Canada, Mexico)
// Resolution timestamps = match kickoff + 3 hours (extra time + buffer)
// ─────────────────────────────────────────────────────────────────────────────

const WC_MARKETS: MarketDef[] = [
  // ── Tournament Outright Winners (binary) ────────────────────────────────
  {
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "Brazil",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "Argentina",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will France win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "France",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will England win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "England",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will Spain win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "Spain",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will the USA win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "USA",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will Germany win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "Germany",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Will Portugal win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    teamA: "Portugal",
    resolutionISO: "2026-07-20T00:00:00Z",
    category: "WORLD_CUP",
  },

  // ── Group Stage Matches (3-way: Home Win / Away Win / Draw) ─────────────
  // Opening match: Mexico vs Host opener ~Jun 11, 2026 (exact lineup TBD)
  {
    question: "USA vs Mexico — 2026 FIFA World Cup Group Stage",
    outcomeA: "USA Win",
    outcomeB: "Mexico Win",
    outcomeC: "Draw",
    teamA: "USA",
    teamB: "Mexico",
    resolutionISO: "2026-06-15T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "England vs France — 2026 FIFA World Cup Group Stage",
    outcomeA: "England Win",
    outcomeB: "France Win",
    outcomeC: "Draw",
    teamA: "England",
    teamB: "France",
    resolutionISO: "2026-06-20T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Spain vs Germany — 2026 FIFA World Cup Group Stage",
    outcomeA: "Spain Win",
    outcomeB: "Germany Win",
    outcomeC: "Draw",
    teamA: "Spain",
    teamB: "Germany",
    resolutionISO: "2026-06-21T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Brazil vs Argentina — 2026 FIFA World Cup Group Stage",
    outcomeA: "Brazil Win",
    outcomeB: "Argentina Win",
    outcomeC: "Draw",
    teamA: "Brazil",
    teamB: "Argentina",
    resolutionISO: "2026-06-22T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Portugal vs Morocco — 2026 FIFA World Cup Group Stage",
    outcomeA: "Portugal Win",
    outcomeB: "Morocco Win",
    outcomeC: "Draw",
    teamA: "Portugal",
    teamB: "Morocco",
    resolutionISO: "2026-06-23T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Japan vs South Korea — 2026 FIFA World Cup Group Stage",
    outcomeA: "Japan Win",
    outcomeB: "South Korea Win",
    outcomeC: "Draw",
    teamA: "Japan",
    teamB: "South Korea",
    resolutionISO: "2026-06-24T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Netherlands vs Belgium — 2026 FIFA World Cup Group Stage",
    outcomeA: "Netherlands Win",
    outcomeB: "Belgium Win",
    outcomeC: "Draw",
    teamA: "Netherlands",
    teamB: "Belgium",
    resolutionISO: "2026-06-25T03:00:00Z",
    category: "WORLD_CUP",
  },
  {
    question: "Mexico vs Canada — 2026 FIFA World Cup Group Stage",
    outcomeA: "Mexico Win",
    outcomeB: "Canada Win",
    outcomeC: "Draw",
    teamA: "Mexico",
    teamB: "Canada",
    resolutionISO: "2026-06-18T03:00:00Z",
    category: "WORLD_CUP",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function adminPost(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} for ${endpoint}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ADMIN_API_KEY) {
    throw new Error("ADMIN_API_KEY env var is required");
  }

  // Load deployed addresses
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error(`deployed-addresses.json not found at ${addressesPath}. Run deploy.ts first.`);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));

  const [owner] = await ethers.getSigners();
  console.log("Seeding with account:", owner.address);
  console.log("Factory:", addresses.MarketFactory);
  console.log("API URL:", API_URL);
  console.log("---");

  const factory = await ethers.getContractAt("MarketFactory", addresses.MarketFactory);

  let created = 0;
  let skipped = 0;

  for (const market of WC_MARKETS) {
    const resolutionTimestamp = Math.floor(new Date(market.resolutionISO).getTime() / 1000);

    // Check if resolution is still in the future
    const now = Math.floor(Date.now() / 1000);
    if (resolutionTimestamp <= now) {
      console.log(`  SKIP (past resolution): ${market.question}`);
      skipped++;
      continue;
    }

    const outcomes: [string, string] = [market.outcomeA, market.outcomeB];

    console.log(`Creating: ${market.question}`);

    try {
      // 1. Create on-chain
      const tx = await factory.createMarket(market.question, outcomes, resolutionTimestamp);
      const receipt = await tx.wait();

      // Extract onchainId from the MarketCreated event
      const iface = factory.interface;
      let onchainId: number | null = null;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "MarketCreated") {
            onchainId = Number(parsed.args.marketId);
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (onchainId === null) {
        // Fall back to nextMarketId - 1
        onchainId = Number(await factory.nextMarketId()) - 1;
      }

      // 2. Register in DB via admin API
      await adminPost("/api/markets", {
        onchainId,
        question: market.question,
        outcomeA: market.outcomeA,
        outcomeB: market.outcomeB,
        outcomeC: market.outcomeC ?? null,
        category: market.category,
        teamA: market.teamA ?? null,
        teamB: market.teamB ?? null,
        polymarketId: market.polymarketId ?? null,
        resolutionTimestamp: market.resolutionISO,
      });

      console.log(`  ✓ onchainId=${onchainId} registered in DB`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Skip if already registered (409 = conflict)
      if (msg.includes("409") || msg.includes("already exists")) {
        console.log(`  SKIP (already exists): ${market.question}`);
        skipped++;
      } else {
        console.error(`  ERROR: ${msg}`);
      }
    }

    // Small delay between on-chain txs
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("---");
  console.log(`Done. Created: ${created}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
