/**
 * resolve-market.ts — Admin oracle: resolve a WC market on-chain
 *
 * After a match ends, run this to call OracleResolver.resolve() on-chain.
 * The indexer picks up the MarketResolved event and updates the DB.
 *
 * Usage:
 *   MARKET_ID=3 OUTCOME=0 npx hardhat run scripts/resolve-market.ts --network base_sepolia
 *
 * OUTCOME values:
 *   0 = Home Win / Yes
 *   1 = Away Win / No
 *   2 = Draw
 *
 * Requires:
 *   - packages/contracts/deployed-addresses.json (from deploy.ts)
 *   - DEPLOYER_PRIVATE_KEY in env (hardhat config reads this)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const marketId = process.env.MARKET_ID;
  const outcome = process.env.OUTCOME;

  if (marketId === undefined || outcome === undefined) {
    throw new Error("Usage: MARKET_ID=<n> OUTCOME=<0|1|2> npx hardhat run scripts/resolve-market.ts --network base_sepolia");
  }

  const marketIdN = parseInt(marketId, 10);
  const outcomeN = parseInt(outcome, 10);

  if (isNaN(marketIdN) || marketIdN < 0) {
    throw new Error(`Invalid MARKET_ID: ${marketId}`);
  }
  if (![0, 1, 2].includes(outcomeN)) {
    throw new Error(`Invalid OUTCOME: ${outcome}. Must be 0 (Home/Yes), 1 (Away/No), or 2 (Draw)`);
  }

  // Load deployed addresses
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error(`deployed-addresses.json not found. Run deploy.ts first.`);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));

  const [owner] = await ethers.getSigners();
  console.log("Resolving with account:", owner.address);
  console.log("OracleResolver:", addresses.OracleResolver);
  console.log(`Market ID: ${marketIdN}`);
  console.log(`Outcome: ${outcomeN} (${["Home/Yes", "Away/No", "Draw"][outcomeN]})`);

  const resolver = await ethers.getContractAt("OracleResolver", addresses.OracleResolver);

  // Read current market state from factory for sanity check
  const factory = await ethers.getContractAt("MarketFactory", addresses.MarketFactory);
  const market = await factory.getMarket(marketIdN);
  console.log(`Market question: "${market.question}"`);
  console.log(`Current status: ${["Open", "Locked", "Resolved", "Cancelled"][Number(market.status)]}`);

  if (Number(market.status) === 2) {
    console.warn("Market is already RESOLVED. Aborting.");
    return;
  }
  if (Number(market.status) === 3) {
    console.warn("Market is CANCELLED. Aborting.");
    return;
  }

  console.log("Sending resolve transaction...");
  const tx = await resolver.resolve(marketIdN, outcomeN);
  const receipt = await tx.wait();
  console.log(`✓ Resolved in tx: ${receipt?.hash}`);
  console.log("The indexer will pick up the MarketResolved event within 5 seconds.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
