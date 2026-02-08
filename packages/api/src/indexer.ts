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
const SharesPurchasedEvent = parseAbiItem(
  "event SharesPurchased(uint256 indexed marketId, address indexed buyer, uint8 outcome, uint256 amount)"
);
const WinningsClaimedEvent = parseAbiItem(
  "event WinningsClaimed(uint256 indexed marketId, address indexed claimant, uint256 payout)"
);
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

  // Upsert: if market already exists (idempotent), skip
  await prisma.market.upsert({
    where: { onchainId },
    create: {
      onchainId,
      question,
      outcomeA: outcomes[0],
      outcomeB: outcomes[1],
      category: "TOURNAMENT", // default — can be enriched via admin API
      resolutionTimestamp: new Date(Number(resolutionTimestamp) * 1000),
      status: "OPEN",
    },
    update: {}, // no-op if already exists
  });

  console.log(`  [MarketCreated] market #${onchainId}: "${question}"`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSharesPurchased(log: any): Promise<void> {
  const { marketId, buyer, outcome, amount } = log.args;
  if (marketId === undefined || !buyer || outcome === undefined || amount === undefined) return;

  const txHash = log.transactionHash as string;
  const blockNumber = Number(log.blockNumber);
  const onchainId = Number(marketId);

  // Find market by onchainId
  const market = await prisma.market.findUnique({ where: { onchainId } });
  if (!market) {
    console.warn(`  [SharesPurchased] market #${onchainId} not in DB, skipping`);
    return;
  }

  const blockTs = await getBlockTimestamp(log.blockNumber);

  // Upsert trade by txHash (idempotent)
  await prisma.trade.upsert({
    where: { txHash },
    create: {
      marketId: market.id,
      userAddress: buyer.toLowerCase(),
      outcome: Number(outcome),
      amount: BigInt(amount),
      shares: BigInt(amount), // 1:1
      txHash,
      blockNumber,
      timestamp: new Date(Number(blockTs) * 1000),
    },
    update: {}, // no-op if already exists
  });

  // Upsert position (aggregate shares)
  const positionKey = {
    marketId_userAddress_outcome: {
      marketId: market.id,
      userAddress: buyer.toLowerCase(),
      outcome: Number(outcome),
    },
  };
  const existing = await prisma.position.findUnique({ where: positionKey });
  if (existing) {
    // Only add if this trade hadn't been counted yet (idempotent check)
    // Since we upserted the trade above with no-op on duplicate, and
    // positions aggregate, we re-derive from all trades for correctness.
    const totalShares = await prisma.trade.aggregate({
      where: {
        marketId: market.id,
        userAddress: buyer.toLowerCase(),
        outcome: Number(outcome),
      },
      _sum: { shares: true },
    });
    await prisma.position.update({
      where: positionKey,
      data: { shares: totalShares._sum.shares || 0n },
    });
  } else {
    await prisma.position.create({
      data: {
        marketId: market.id,
        userAddress: buyer.toLowerCase(),
        outcome: Number(outcome),
        shares: BigInt(amount),
      },
    });
  }

  // Re-derive pool sizes from all trades for this market (idempotent)
  const poolAgg = await prisma.trade.groupBy({
    by: ["outcome"],
    where: { marketId: market.id },
    _sum: { amount: true },
  });
  const poolYes = poolAgg.find((p) => p.outcome === 0)?._sum.amount || 0n;
  const poolNo = poolAgg.find((p) => p.outcome === 1)?._sum.amount || 0n;
  await prisma.market.update({
    where: { id: market.id },
    data: { poolYes, poolNo },
  });

  console.log(
    `  [SharesPurchased] market #${onchainId} | ${buyer.slice(0, 8)}... | outcome=${outcome} | amount=${amount}`
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
      userAddress: claimant.toLowerCase(),
    },
    data: { claimed: true },
  });

  console.log(`  [WinningsClaimed] market #${onchainId} | ${claimant.slice(0, 8)}... claimed`);
}

// ─── Log Fetching & Processing ──────────────────────────────────────────────

async function fetchAndProcessLogs(fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (fromBlock > toBlock) return;

  // Fetch all 4 event types in parallel
  const [marketCreatedLogs, sharesPurchasedLogs, marketResolvedLogs, winningsClaimedLogs] =
    await Promise.all([
      client.getLogs({
        address: FACTORY_ADDRESS,
        event: MarketCreatedEvent,
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: ENGINE_ADDRESS,
        event: SharesPurchasedEvent,
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: RESOLVER_ADDRESS,
        event: MarketResolvedEvent,
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: ENGINE_ADDRESS,
        event: WinningsClaimedEvent,
        fromBlock,
        toBlock,
      }),
    ]);

  // Merge all logs and sort by block number + log index for correct ordering
  interface TaggedLog {
    blockNumber: bigint;
    logIndex: number;
    eventType: string;
    raw: unknown;
  }
  const allLogs: TaggedLog[] = [
    ...marketCreatedLogs.map((l) => ({
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      eventType: "MarketCreated",
      raw: l,
    })),
    ...sharesPurchasedLogs.map((l) => ({
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      eventType: "SharesPurchased",
      raw: l,
    })),
    ...marketResolvedLogs.map((l) => ({
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      eventType: "MarketResolved",
      raw: l,
    })),
    ...winningsClaimedLogs.map((l) => ({
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      eventType: "WinningsClaimed",
      raw: l,
    })),
  ];

  allLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });

  if (allLogs.length === 0) return;

  console.log(`  Processing ${allLogs.length} events from blocks ${fromBlock}–${toBlock}`);

  // Process events in order
  for (const entry of allLogs) {
    switch (entry.eventType) {
      case "MarketCreated":
        await handleMarketCreated(entry.raw);
        break;
      case "SharesPurchased":
        await handleSharesPurchased(entry.raw);
        break;
      case "MarketResolved":
        await handleMarketResolved(entry.raw);
        break;
      case "WinningsClaimed":
        await handleWinningsClaimed(entry.raw);
        break;
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

  console.log(`[Indexer] Backfill complete.`);
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

  // Get current chain head
  const currentBlock = await client.getBlockNumber();
  console.log(`  Chain head: ${currentBlock}`);

  // Get last indexed block
  let lastIndexed = await getLastIndexedBlock();
  console.log(`  Last indexed: ${lastIndexed}`);

  // Determine start block
  const startBlock = lastIndexed > 0 ? lastIndexed + 1 : DEPLOYMENT_BLOCK;

  // Backfill if behind
  if (startBlock < Number(currentBlock)) {
    await backfill(startBlock, Number(currentBlock));
    lastIndexed = Number(currentBlock);
  }

  console.log("[Indexer] Entering poll loop...");

  // Poll loop
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

  // Run immediately, then on interval
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

// ─── Entry Point ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[Indexer] Fatal error:", err);
  process.exit(1);
});
