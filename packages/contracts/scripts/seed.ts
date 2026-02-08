import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

function usdc(n: number): bigint {
  return BigInt(n) * 1_000_000n;
}

interface MarketDef {
  question: string;
  outcomes: [string, string];
  daysUntilResolution: number;
  /** [yesAmount, noAmount] per trader — gives non-trivial odds */
  trades: [number, number][];
}

// ── Market definitions ───────────────────────────────────────────────────────

const MARKETS: MarketDef[] = [
  // ── 3 outright winner markets ──────────────────────────────────────
  {
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 180,
    trades: [
      [500, 2000],   // trader 0: small YES, heavy NO
      [800, 1500],   // trader 1
      [300, 2500],   // trader 2
    ],
  },
  {
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 180,
    trades: [
      [1200, 1800],
      [600, 2200],
      [900, 1600],
    ],
  },
  {
    question: "Will France win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 180,
    trades: [
      [700, 2000],
      [400, 2500],
      [1100, 1200],
    ],
  },

  // ── 4 match result markets ─────────────────────────────────────────
  {
    question: "Will Brazil beat Germany in their group stage match?",
    outcomes: ["Brazil wins", "Draw or Germany wins"],
    daysUntilResolution: 30,
    trades: [
      [2000, 1000],
      [1500, 1500],
      [2500, 800],
    ],
  },
  {
    question: "Will Argentina beat England in the Quarter-Finals?",
    outcomes: ["Argentina wins", "Draw or England wins"],
    daysUntilResolution: 90,
    trades: [
      [1800, 1200],
      [2000, 1000],
      [1200, 2000],
    ],
  },
  {
    question: "Will France beat Spain in the Semi-Finals?",
    outcomes: ["France wins", "Draw or Spain wins"],
    daysUntilResolution: 120,
    trades: [
      [1500, 1500],
      [1000, 2000],
      [2200, 1000],
    ],
  },
  {
    question: "Will USA beat Mexico in their group stage match?",
    outcomes: ["USA wins", "Draw or Mexico wins"],
    daysUntilResolution: 30,
    trades: [
      [1800, 1200],
      [1600, 1400],
      [2000, 1000],
    ],
  },

  // ── 3 group stage advancement markets ──────────────────────────────
  {
    question: "Will Brazil advance from Group A?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 45,
    trades: [
      [3000, 500],
      [2500, 800],
      [2800, 600],
    ],
  },
  {
    question: "Will USA advance from Group B?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 45,
    trades: [
      [2000, 1200],
      [1800, 1500],
      [2200, 1000],
    ],
  },
  {
    question: "Will England advance from Group C?",
    outcomes: ["Yes", "No"],
    daysUntilResolution: 45,
    trades: [
      [2500, 800],
      [2200, 1000],
      [2800, 500],
    ],
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load deployed addresses
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addrPath)) {
    throw new Error(
      "deployed-addresses.json not found — run deploy script first"
    );
  }
  const addrs = JSON.parse(fs.readFileSync(addrPath, "utf-8"));

  const signers = await ethers.getSigners();
  const owner = signers[0];
  // Use accounts 1, 2, 3 as test traders
  const traders = [signers[1], signers[2], signers[3]];

  console.log("Owner:", owner.address);
  console.log(
    "Traders:",
    traders.map((t) => t.address)
  );
  console.log("---");

  // Attach to deployed contracts
  const usdcContract = await ethers.getContractAt("MockUSDC", addrs.MockUSDC);
  const factory = await ethers.getContractAt(
    "MarketFactory",
    addrs.MarketFactory
  );
  const engine = await ethers.getContractAt(
    "ParimutuelEngine",
    addrs.ParimutuelEngine
  );
  const vault = await ethers.getContractAt(
    "CollateralVault",
    addrs.CollateralVault
  );

  // ── Step 1: Mint 100K USDC to each trader ─────────────────────────
  const MINT_AMOUNT = usdc(100_000);
  for (const trader of traders) {
    await (await usdcContract.mint(trader.address, MINT_AMOUNT)).wait();
    // Approve vault for max
    await (
      await usdcContract
        .connect(trader)
        .approve(await vault.getAddress(), ethers.MaxUint256)
    ).wait();
    console.log(
      `Minted 100,000 USDC to ${trader.address} and approved vault`
    );
  }
  console.log("---");

  // ── Step 2: Create 10 markets ─────────────────────────────────────
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    const resolutionTs = now + m.daysUntilResolution * 86400;
    await (
      await factory.createMarket(m.question, m.outcomes, resolutionTs)
    ).wait();
    console.log(`Market ${i}: "${m.question}"`);
  }
  console.log("---");

  // ── Step 3: Simulate trades ───────────────────────────────────────
  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    for (let t = 0; t < traders.length; t++) {
      const [yesAmt, noAmt] = m.trades[t];
      if (yesAmt > 0) {
        await (
          await engine.connect(traders[t]).buyShares(i, 0, usdc(yesAmt))
        ).wait();
      }
      if (noAmt > 0) {
        await (
          await engine.connect(traders[t]).buyShares(i, 1, usdc(noAmt))
        ).wait();
      }
    }

    const yesPool = await engine.totalSharesByOutcome(i, 0);
    const noPool = await engine.totalSharesByOutcome(i, 1);
    const total = yesPool + noPool;
    const impliedYes =
      total > 0n ? ((yesPool * 10000n) / total).toString() : "0";
    console.log(
      `Market ${i}: YES=${ethers.formatUnits(yesPool, 6)} / NO=${ethers.formatUnits(noPool, 6)} USDC | Implied YES=${(Number(impliedYes) / 100).toFixed(1)}%`
    );
  }

  console.log("---");
  console.log("Seeding complete. All 10 markets created with trades.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
