/**
 * seed-polymarket-teams.ts
 *
 * Seeds parimutuel pools for all remaining Polymarket WC 2026 outright winner
 * markets that aren't already in our DB. Each market is created on-chain and
 * registered in the DB with polymarketId set, so the reference odds bar shows
 * on the detail page.
 *
 * Usage:
 *   API_URL=https://sports-predictapi-production.up.railway.app \
 *   ADMIN_API_KEY=<key> \
 *   npx hardhat run scripts/seed-polymarket-teams.ts --network base_sepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const API_URL = process.env.API_URL || "http://localhost:3001";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

// Real Polymarket conditionIds from Gamma API — already seeded teams excluded
// Already seeded (onchainId 0-7): Brazil, Argentina, France, England, Spain, USA, Germany, Portugal
const REMAINING_TEAMS: { question: string; team: string; polymarketId: string }[] = [
  { team: "Mexico",            question: "Will Mexico win the 2026 FIFA World Cup?",            polymarketId: "0x5ccfe1b69a582d2985db08a8481a0d74c314b1fce9b4711a" },
  { team: "Morocco",           question: "Will Morocco win the 2026 FIFA World Cup?",           polymarketId: "0x37a6de1b21803e5f3fb1965116218215d79963af4f7e5165" },
  { team: "Netherlands",       question: "Will Netherlands win the 2026 FIFA World Cup?",       polymarketId: "0x9be56371f6a29d12769b2f196847ee825b9585ebb8bfa042" },
  { team: "Belgium",           question: "Will Belgium win the 2026 FIFA World Cup?",           polymarketId: "0x32cfa52198e85e070d1b17d1b53c5c3a6aaae7736cdc33fa" },
  { team: "Japan",             question: "Will Japan win the 2026 FIFA World Cup?",             polymarketId: "0x0189df05ed7bf84d799213b01a79571e305c03b2ac5359cf" },
  { team: "Colombia",          question: "Will Colombia win the 2026 FIFA World Cup?",          polymarketId: "0xe99cc59f32b10d23acf196d1a0e8264ea30fca198428acad" },
  { team: "Switzerland",       question: "Will Switzerland win the 2026 FIFA World Cup?",       polymarketId: "0x3a26ca6425e2d98f14935670bc22cdb0744defc6f6d83c65" },
  { team: "Croatia",           question: "Will Croatia win the 2026 FIFA World Cup?",           polymarketId: "0xe5bd80313b8859e3f5761568ac9498866ea9d4419e4d1b6a" },
  { team: "South Korea",       question: "Will South Korea win the 2026 FIFA World Cup?",       polymarketId: "0x65307f30dce84ac35e41813035d3c04933da830dc4efbbb2" },
  { team: "Canada",            question: "Will Canada win the 2026 FIFA World Cup?",            polymarketId: "0x67443cb1ffb2bf180f7df5b6ca7adff63f7e8e933c7e4140" },
  { team: "Uruguay",           question: "Will Uruguay win the 2026 FIFA World Cup?",           polymarketId: "0x7876851632c295043c66536150a304cb785abdf712ba8489" },
  { team: "Saudi Arabia",      question: "Will Saudi Arabia win the 2026 FIFA World Cup?",      polymarketId: "0x3fb8a8de2ac275882d72b2c4f22d41776fcf033f9e413a77" },
  { team: "Australia",         question: "Will Australia win the 2026 FIFA World Cup?",         polymarketId: "0x098e2be3df8ab529940c567819f8ef007cf007820e9d6276" },
  { team: "Egypt",             question: "Will Egypt win the 2026 FIFA World Cup?",             polymarketId: "0x7412d284c8f63791fec807f9b1f61c6fe61163621775a3dc" },
  { team: "Senegal",           question: "Will Senegal win the 2026 FIFA World Cup?",           polymarketId: "0x6972edb1b3f8cd8192651a665fc424dff846efe1c4a2376f" },
  { team: "Turkiye",           question: "Will Turkiye win the 2026 FIFA World Cup?",           polymarketId: "0x106ccc4508432a065a67394837d4c2c529a8d77ed69fa3ba" },
  { team: "Iran",              question: "Will Iran win the 2026 FIFA World Cup?",              polymarketId: "0x84edef36bded182da6a395ac6c785dba8f3e09b6c5ad0413" },
  { team: "Norway",            question: "Will Norway win the 2026 FIFA World Cup?",            polymarketId: "0x7b52405ad0e0d31bfe970940b67d77f24ecedeab8a2361c1" },
  { team: "Ecuador",           question: "Will Ecuador win the 2026 FIFA World Cup?",           polymarketId: "0xbaf7780f9059e34b84301fd411f8dc573b4d56adfe6e0cda" },
  { team: "Algeria",           question: "Will Algeria win the 2026 FIFA World Cup?",           polymarketId: "0x5a59d269c2b5108cd2f64c624e46ee2c8b5cfd88b8825825" },
  { team: "Ivory Coast",       question: "Will Ivory Coast win the 2026 FIFA World Cup?",       polymarketId: "0x289568d555ec620ed6fa33c936c5f42649d3a2e30748a1da" },
  { team: "Scotland",          question: "Will Scotland win the 2026 FIFA World Cup?",          polymarketId: "0xf950740bc71136155d6525cc0528a582c81f88812bff2278" },
  { team: "Austria",           question: "Will Austria win the 2026 FIFA World Cup?",           polymarketId: "0xfe230d510eaf545198c0d62bb17871e5fe8989f1b19aa54c" },
  { team: "Sweden",            question: "Will Sweden win the 2026 FIFA World Cup?",            polymarketId: "0xd0dbdc94b28c5cffeef64ed6b13e5f0f2324fb177e5ffaa6" },
  { team: "Qatar",             question: "Will Qatar win the 2026 FIFA World Cup?",             polymarketId: "0x4fe305a2ae995a52ff278895344895fe587b4fec3d5f0434" },
  { team: "South Africa",      question: "Will South Africa win the 2026 FIFA World Cup?",      polymarketId: "0x233ce0c3969a5cd5079287f16fcd283be7c1db82263e0869" },
  { team: "Paraguay",          question: "Will Paraguay win the 2026 FIFA World Cup?",          polymarketId: "0x675bba4df50fd123f7fbfbafa67e9b75f4092d85ce0f9148" },
  { team: "Congo DR",          question: "Will Congo DR win the 2026 FIFA World Cup?",          polymarketId: "0xcd836ec4d94b8a4ddc5713d80fe9db245d2fb4796eaf1233" },
  { team: "Ghana",             question: "Will Ghana win the 2026 FIFA World Cup?",             polymarketId: "0x881a3ffa618b6ae0ab95a5637e310afb1afc2d99c921bfe3" },
  { team: "Uzbekistan",        question: "Will Uzbekistan win the 2026 FIFA World Cup?",        polymarketId: "0x965ebc5d79eb1ec02cad67245a44b9e45b33359018f013fb" },
  { team: "Czechia",           question: "Will Czechia win the 2026 FIFA World Cup?",           polymarketId: "0x5e614739363bbfc399469102c600e4e8260032d41e59e0bc" },
  { team: "Bosnia-Herzegovina",question: "Will Bosnia-Herzegovina win the 2026 FIFA World Cup?",polymarketId: "0xbce6698c9a61376c0709a2a724a9cf0dd0236d8dea882533" },
  { team: "Tunisia",           question: "Will Tunisia win the 2026 FIFA World Cup?",           polymarketId: "0xff0cfa9506cfa95759e4c7591654195bd26e3011f9882b51" },
  { team: "Cape Verde",        question: "Will Cape Verde win the 2026 FIFA World Cup?",        polymarketId: "0x3bc69cb672591e4fcd2ef856b64b219a906e15d4601b5006" },
  { team: "New Zealand",       question: "Will New Zealand win the 2026 FIFA World Cup?",       polymarketId: "0x9e5f9d8c384f8fe368b195fa9a780be58643dff7360588a4" },
  { team: "Haiti",             question: "Will Haiti win the 2026 FIFA World Cup?",             polymarketId: "0x506f80bcf76bc75e6b31a250e2d754f347c4c23166532693" },
  { team: "Iraq",              question: "Will Iraq win the 2026 FIFA World Cup?",              polymarketId: "0x51e8c8df709aa78f64d2d9324d9d2556270f81e3966ade30" },
  { team: "Panama",            question: "Will Panama win the 2026 FIFA World Cup?",            polymarketId: "0x9779c09fd4dd0a1c82dd82618269c2aa5669d91305293b39" },
  { team: "Curacao",           question: "Will Curaçao win the 2026 FIFA World Cup?",           polymarketId: "0xdb4b2f370c3d0e996fbb32213c87aa5402936e3d4882432b" },
  { team: "Jordan",            question: "Will Jordan win the 2026 FIFA World Cup?",            polymarketId: "0x33a87d02fa01e958929385c74b8627d32cc4474e9ebd312d" },
];

async function adminPost(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status} for ${endpoint}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  if (!ADMIN_API_KEY) throw new Error("ADMIN_API_KEY env var is required");

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));

  const [owner] = await ethers.getSigners();
  console.log("Seeding with:", owner.address);
  console.log("Factory:", addresses.MarketFactory);
  console.log("API:", API_URL);
  console.log("Teams to seed:", REMAINING_TEAMS.length);
  console.log("---");

  const factory = await ethers.getContractAt("MarketFactory", addresses.MarketFactory);
  const resolutionISO = "2026-07-20T00:00:00Z";
  const resolutionTimestamp = Math.floor(new Date(resolutionISO).getTime() / 1000);

  let created = 0, skipped = 0, errored = 0;

  for (const market of REMAINING_TEAMS) {
    process.stdout.write(`Creating: ${market.team}... `);

    try {
      const tx = await factory.createMarket(market.question, ["Yes", "No"], resolutionTimestamp);
      const receipt = await tx.wait();

      const iface = factory.interface;
      let onchainId: number | null = null;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "MarketCreated") onchainId = Number(parsed.args.marketId);
        } catch { /* ignore */ }
      }
      if (onchainId === null) onchainId = Number(await factory.nextMarketId()) - 1;

      await adminPost("/api/markets", {
        onchainId,
        question: market.question,
        outcomeA: "Yes",
        outcomeB: "No",
        outcomeC: null,
        category: "WORLD_CUP",
        teamA: market.team,
        teamB: null,
        polymarketId: market.polymarketId,
        resolutionTimestamp: resolutionISO,
      });

      console.log(`✓ onchainId=${onchainId}`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("409") || msg.includes("already exists")) {
        console.log(`SKIP (exists)`);
        skipped++;
      } else {
        console.log(`ERROR: ${msg.slice(0, 120)}`);
        errored++;
      }
    }
    // Small delay to avoid Base Sepolia nonce issues
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("---");
  console.log(`Done. Created: ${created}, Skipped: ${skipped}, Errors: ${errored}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
