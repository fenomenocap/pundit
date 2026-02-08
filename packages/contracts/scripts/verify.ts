import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addrPath)) {
    throw new Error("deployed-addresses.json not found — run deploy first");
  }
  const addrs = JSON.parse(fs.readFileSync(addrPath, "utf-8"));

  const factory = await ethers.getContractAt(
    "MarketFactory",
    addrs.MarketFactory
  );
  const engine = await ethers.getContractAt(
    "ParimutuelEngine",
    addrs.ParimutuelEngine
  );

  const marketCount = await factory.nextMarketId();
  console.log(`Total markets: ${marketCount}`);
  console.log("---");

  for (let i = 0; i < Number(marketCount); i++) {
    const m = await factory.getMarket(i);
    const yesPool = await engine.totalSharesByOutcome(i, 0);
    const noPool = await engine.totalSharesByOutcome(i, 1);
    const total = yesPool + noPool;
    const impliedYes =
      total > 0n
        ? (Number((yesPool * 10000n) / total) / 100).toFixed(1)
        : "N/A";

    const statusNames = ["Open", "Locked", "Resolved", "Cancelled"];
    console.log(`Market ${i}: ${m.question}`);
    console.log(`  Status:  ${statusNames[m.status]}`);
    console.log(`  Outcomes: ${m.outcomes[0]} / ${m.outcomes[1]}`);
    console.log(
      `  Pool:    YES=${ethers.formatUnits(yesPool, 6)} / NO=${ethers.formatUnits(noPool, 6)} USDC`
    );
    console.log(`  Implied: ${impliedYes}% YES`);
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
