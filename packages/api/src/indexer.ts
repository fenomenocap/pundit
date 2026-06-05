import { createPublicClient, http, parseAbiItem } from "viem";
import { baseSepolia, hardhat } from "viem/chains";
import { prisma } from "./db";

// ─── Configuration ──────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337", 10);
const POLL_INTERVAL_MS = parseInt(process.env.INDEXER_POLL_MS || "5000", 10);
const BACKFILL_CHUNK_SIZE = 1000;
const DEPLOYMENT_BLOCK = parseInt(process.env.DEPLOYMENT_BLOCK || "0", 10);

// Contract addresses — defaults match local anvil deployment
const FACTORY_ADDRESS = (process.env.FACTORY_ADDRESS ||
  "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512") as `0x${string}`;
const ENGINE_ADDRESS = (process.env.ENGINE_ADDRESS ||
  "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9") as `0x${string}`;
const RESOLVER_ADDRESS = (process.env.RESOLVER_ADDRESS ||
  "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9") as `0x${string}`;

// ─── ABI Event Signatures ───────────────────────────────────────────────────

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(uint256 indexed marketId, string question, string[2] outcomes, uint256 resolutionTimestamp)"
);

// New signature: grossAmount (paid by user) + netShares (credited to pool)
const SharesPurchasedEvent = parseAbiItem(
  "event SharesPurchased(uint256 indexed marketId, address indexed buyer, uint8 outcome, uint256 grossAmount, uint256 netShares)"
);

const WinningsClaimedEvent = parseAbiItem(
  "event WinningsClaimed(uint256 indexed marketId, address indexed claimant, uint256 payout)"
);

// Emitted by OracleResolver, not MarketFactory
const MarketResolvedEvent = parseAbiItem(
  "event MarketResolved(uint256 indexed marketId, uint8 winningOutcome)"
);

// ─── Viem Client ────────────────────────────────────────────────────────────

const chain = CHAIN_ID === 84532 ? baseSepolia : hardhat;

const client = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

// ─── Block Timestamp Cache ──────────────────────────────────────────────────

const blockTimestampCache = new Map<bigint, bigint>();

async function getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) return cached;

  const block = await client.getBlock({ blockNumber });
  blockTimestampCache.set(blockNumber, block.timestamp);

  // Evict old entries to prevent unbounded memory growth
  if (blockTimestampCache.size > 2000) {
    const firstKey = blockTimestampCache.keys().next().value!;
    blockTimestampCache.delete(firstKey);
  }

  return block.timestamp;
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMarketCreated(log: any): Promise<void> {
  const { marketId, question, outcomes, resolutionTimestamp } = log.args;
  if (marketId === undefined || !question || !outcomes || resolutionTimestamp === undefined) return;

  const onchainId = Number(marketId);

  await prisma.market.upsert({
    where: { onchainId },
    create: {
      onchainId,
      question,
      outcomeA: outcomes[0],
      outcomeB: outcomes[1],
      category: "OTHER", // default — enriched via admin API when market is created off-chain
      resolutionTimestamp: new Date(Number(resolutionTimestamp) * 1000),
      status: "OPEN",
    },
    update: {}, // no-op if already exists (idempotent)
  });

  console.log(`  [MarketCreated] market #${onchainId}: "${question}"`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSharesPurchased(log: any): Promise<void> {
  const { marketId, buyer, outcome, grossAmount, netShares } = log.args;
  if (
    marketId === undefined ||
    !buyer ||
    outcome === undefined ||
    grossAmount === undefined ||
    netShares === undefined
  ) return;

  const txHash = log.transactionHash as string;
  const blockNumber = Number(log.blockNumber);
  const onchainId = Number(marketId);
  const outcomeNum = Number(outcome);

  const market = await prisma.market.findUnique({ where: { onchainId } });
  if (!market) {
    console.warn(`  [SharesPurchased] market #${onchainId} not in DB, skipping`);
    return;
  }

  const blockTs = await getBlockTimestamp(log.blockNumber);

  // Upsert trade (idempotent via unique txHash)
  await prisma.trade.upsert({
    where: { txHash },
    create: {
      marketId: market.id,
      userAddress: (buyer as string).toLowerCase(),
      outcome: outcomeNum,
      grossAmount: BigInt(grossAmount), // USDC paid by user
      netShares:   BigInt(netShares),   // shares credited (gross - fee)
      txHash,
      blockNumber,
      timestamp: new Date(Number(blockTs) * 1000),
    },
    update: {}, // no-op if already exists
  });

  // Re-derive position from all trades (idempotent for replay safety)
  const positionKey = {
    marketId_userAddress_outcome: {
      marketId: market.id,
      userAddress: (buyer as string).toLowerCase(),
      outcome: outcomeNum,
    },
  };

  const totalShares = await prisma.trade.aggregate({
    where: {
      marketId: market.id,
      userAddress: (buyer as string).toLowerCase(),
      outcome: outcomeNum,
    },
    _sum: { netShares: true },
  });

  await prisma.position.upsert({
    where: positionKey,
    create: {
      marketId: market.id,
      userAddress: (buyer as string).toLowerCase(),
      outcome: outcomeNum,
      shares: totalShares._sum.netShares ?? 0n,
    },
    update: {
      shares: totalShares._sum.netShares ?? 0n,
    },
  });

  // Re-derive pool sizes from all trades (idempotent)
  // Pools track net shares (USDC after fee), volume tracks gross (USDC paid)
  const poolAgg = await prisma.trade.groupBy({
    by: ["outcome"],
    where: { marketId: market.id },
    _sum: { netShares: true, grossAmount: true },
  });

  const poolYes   = poolAgg.find((p) => p.outcome === 0)?._sum.netShares   ?? 0n;
  const poolNo    = poolAgg.find((p) => p.outcome === 1)?._sum.netShares    ?? 0n;
  const poolDraw  = poolAgg.find((p) => p.outcome === 2)?._sum.netShares    ?? 0n;
  const totalVol  = poolAgg.reduce((acc, p) => acc + (p._sum.grossAmount ?? 0n), 0n);

  await prisma.market.update({
    where: { id: market.id },
    data: { poolYes, poolNo, poolDraw, totalVolume: totalVol },
  });

  console.log(
    `  [SharesPurchased] market #${onchainId} | ${(buyer as string).slice(0, 8)}... ` +
    `| outcome=${outcomeNum} | gross=${grossAmount} | net=${netShares}`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMarketResolved(log: any): Promise<void> {
  const { marketId, winningOutcome } = log.args;
  if (marketId === undefined || winningOutcome === undefined) return;

  const onchainId = Number(marketId);
  const blockTs = await getBlockTimestamp(log.blockNumber);

  // updateMany is idempotent — re-setting same values is fine
  await prisma.market.updateMany({
    where: { onchainId },
    data: {
      status: "RESOLVED",
      resolvedOutcome: Number(winningOutcome),
      resolvedAt: new Date(Number(blockTs) * 1000),
    },
  });

  console.log(`  [MarketResolved] market #${onchainId} → outcome ${winningOutcome}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleWinningsClaimed(log: any): Promise<void> {
  const { marketId, claimant } = log.args;
  if (marketId === undefined || !claimant) return;

  const onchainId = Number(marketId);

  const market = await prisma.market.findUnique({ where: { onchainId } });
  if (!market) return;

  // Mark all positions for this user in this market as claimed (idempotent)
  await prisma.position.updateMany({
    where: {
      marketId: market.id,
      userAddress: (claimant as string).toLowerCase(),
    },
    data: { claimed: true },
  });

  console.log(`  [WinningsClaimed] market #${onchainId} | ${(claimant as string).slice(0, 8)}... claimed`);
}

// ─── Log Fetching & Processing ──────────────────────────────────────────────

async function fetchAndProcessLogs(fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (fromBlock > toBlock) return;

  const [marketCreatedLogs, sharesPurchasedLogs, marketResolvedLogs, winningsClaimedLogs] =
    await Promise.all([
      client.getLogs({ address: FACTORY_ADDRESS,  event: MarketCreatedEvent,   fromBlock, toBlock }),
      client.getLogs({ address: ENGINE_ADDRESS,   event: SharesPurchasedEvent, fromBlock, toBlock }),
      client.getLogs({ address: RESOLVER_ADDRESS, event: MarketResolvedEvent,  fromBlock, toBlock }),
      client.getLogs({ address: ENGINE_ADDRESS,   event: WinningsClaimedEvent, fromBlock, toBlock }),
    ]);

  interface TaggedLog {
    blockNumber: bigint;
    logIndex: number;
    eventType: string;
    raw: unknown;
  }

  const allLogs: TaggedLog[] = [
    ...marketCreatedLogs.map((l) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, eventType: "MarketCreated",   raw: l })),
    ...sharesPurchasedLogs.map((l) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, eventType: "SharesPurchased", raw: l })),
    ...marketResolvedLogs.map((l) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, eventType: "MarketResolved",  raw: l })),
    ...winningsClaimedLogs.map((l) => ({ blockNumber: l.blockNumber, logIndex: l.logIndex, eventType: "WinningsClaimed", raw: l })),
  ];

  allLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  if (allLogs.length === 0) return;

  console.log(`  Processing ${allLogs.length} events from blocks ${fromBlock}–${toBlock}`);

  for (const entry of allLogs) {
    switch (entry.eventType) {
      case "MarketCreated":   await handleMarketCreated(entry.raw);   break;
      case "SharesPurchased": await handleSharesPurchased(entry.raw); break;
      case "MarketResolved":  await handleMarketResolved(entry.raw);  break;
      case "WinningsClaimed": await handleWinningsClaimed(entry.raw); break;
    }
  }
}

// ─── Cursor Management ──────────────────────────────────────────────────────

async function getLastIndexedBlock(): Promise<number> {
  const state = await prisma.indexerState.findUnique({ where: { id: 1 } });
  return state?.lastIndexedBlock ?? 0;
}

async function setLastIndexedBlock(blockNumber: number): Promise<void> {
  await prisma.indexerState.upsert({
    where: { id: 1 },
    create: { id: 1, lastIndexedBlock: blockNumber },
    update: { lastIndexedBlock: blockNumber },
  });
}

// ─── Backfill ───────────────────────────────────────────────────────────────

async function backfill(fromBlock: number, toBlock: number): Promise<void> {
  console.log(`[Indexer] Backfilling from block ${fromBlock} to ${toBlock}...`);

  for (let start = fromBlock; start <= toBlock; start += BACKFILL_CHUNK_SIZE) {
    const end = Math.min(start + BACKFILL_CHUNK_SIZE - 1, toBlock);
    await fetchAndProcessLogs(BigInt(start), BigInt(end));
    await setLastIndexedBlock(end);
    console.log(`  [Backfill] Processed up to block ${end}`);
  }

  console.log("[Indexer] Backfill complete.");
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[Indexer] Starting blockchain event indexer...");
  console.log(`  RPC:       ${RPC_URL}`);
  console.log(`  Chain:     ${chain.name} (${chain.id})`);
  console.log(`  Factory:   ${FACTORY_ADDRESS}`);
  console.log(`  Engine:    ${ENGINE_ADDRESS}`);
  console.log(`  Resolver:  ${RESOLVER_ADDRESS}`);
  console.log(`  Poll:      ${POLL_INTERVAL_MS}ms`);

  const currentBlock = await client.getBlockNumber();
  console.log(`  Chain head: ${currentBlock}`);

  let lastIndexed = await getLastIndexedBlock();
  console.log(`  Last indexed: ${lastIndexed}`);

  const startBlock = lastIndexed > 0 ? lastIndexed + 1 : DEPLOYMENT_BLOCK;

  if (startBlock < Number(currentBlock)) {
    await backfill(startBlock, Number(currentBlock));
    lastIndexed = Number(currentBlock);
  }

  console.log("[Indexer] Entering poll loop...");

  const poll = async () => {
    try {
      const latestBlock = await client.getBlockNumber();
      const from = lastIndexed + 1;

      if (from <= Number(latestBlock)) {
        await fetchAndProcessLogs(BigInt(from), latestBlock);
        lastIndexed = Number(latestBlock);
        await setLastIndexedBlock(lastIndexed);
      }
    } catch (err) {
      console.error("[Indexer] Poll error:", err instanceof Error ? err.message : err);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

// ─── Entry Point ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[Indexer] Fatal error:", err);
  process.exit(1);
});
