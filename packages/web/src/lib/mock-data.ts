import { MarketResponse, MarketDetailResponse, TradeResponse, TradeWithMarketResponse, PositionResponse, PortfolioResponse, PaginationResponse } from "./api";

// ─── Mock data matching the 10 seed markets from Phase 5 ────────────────────
// Pool values are sum of all 3 traders' trades per outcome (in USDC raw units)
// e.g. Market 0 YES: 500+800+300=1600, NO: 2000+1500+2500=6000

const now = Date.now();
const DAY = 86_400_000;

function futureISO(days: number): string {
  return new Date(now + days * DAY).toISOString();
}

function pastISO(days: number): string {
  return new Date(now - days * DAY).toISOString();
}

function usdc(n: number): string {
  return String(n * 1_000_000);
}

export const MOCK_MARKETS: MarketResponse[] = [
  // ── 3 outright winner markets (TOURNAMENT) ──────────────────────────
  {
    id: "market-0",
    onchainId: 0,
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "TOURNAMENT",
    teamA: "Brazil",
    teamB: null,
    poolYes: usdc(1600),   // 500+800+300
    poolNo: usdc(6000),    // 2000+1500+2500
    totalVolume: usdc(7600),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(180),
    createdAt: pastISO(5),
    updatedAt: pastISO(1),
  },
  {
    id: "market-1",
    onchainId: 1,
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "TOURNAMENT",
    teamA: "Argentina",
    teamB: null,
    poolYes: usdc(2700),   // 1200+600+900
    poolNo: usdc(5600),    // 1800+2200+1600
    totalVolume: usdc(8300),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(180),
    createdAt: pastISO(5),
    updatedAt: pastISO(1),
  },
  {
    id: "market-2",
    onchainId: 2,
    question: "Will France win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "TOURNAMENT",
    teamA: "France",
    teamB: null,
    poolYes: usdc(2200),   // 700+400+1100
    poolNo: usdc(5700),    // 2000+2500+1200
    totalVolume: usdc(7900),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(180),
    createdAt: pastISO(4),
    updatedAt: pastISO(1),
  },

  // ── 4 match result markets ──────────────────────────────────────────
  {
    id: "market-3",
    onchainId: 3,
    question: "Will Brazil beat Germany in their group stage match?",
    outcomeA: "Brazil wins",
    outcomeB: "Draw or Germany wins",
    category: "GROUP_STAGE",
    teamA: "Brazil",
    teamB: "Germany",
    poolYes: usdc(6000),   // 2000+1500+2500
    poolNo: usdc(3300),    // 1000+1500+800
    totalVolume: usdc(9300),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(30),
    createdAt: pastISO(3),
    updatedAt: pastISO(1),
  },
  {
    id: "market-4",
    onchainId: 4,
    question: "Will Argentina beat England in the Quarter-Finals?",
    outcomeA: "Argentina wins",
    outcomeB: "Draw or England wins",
    category: "QUARTER_FINAL",
    teamA: "Argentina",
    teamB: "England",
    poolYes: usdc(5000),   // 1800+2000+1200
    poolNo: usdc(4200),    // 1200+1000+2000
    totalVolume: usdc(9200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(90),
    createdAt: pastISO(3),
    updatedAt: pastISO(1),
  },
  {
    id: "market-5",
    onchainId: 5,
    question: "Will France beat Spain in the Semi-Finals?",
    outcomeA: "France wins",
    outcomeB: "Draw or Spain wins",
    category: "SEMI_FINAL",
    teamA: "France",
    teamB: "Spain",
    poolYes: usdc(4700),   // 1500+1000+2200
    poolNo: usdc(4500),    // 1500+2000+1000
    totalVolume: usdc(9200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(120),
    createdAt: pastISO(2),
    updatedAt: pastISO(1),
  },
  {
    id: "market-6",
    onchainId: 6,
    question: "Will USA beat Mexico in their group stage match?",
    outcomeA: "USA wins",
    outcomeB: "Draw or Mexico wins",
    category: "GROUP_STAGE",
    teamA: "USA",
    teamB: "Mexico",
    poolYes: usdc(5400),   // 1800+1600+2000
    poolNo: usdc(3600),    // 1200+1400+1000
    totalVolume: usdc(9000),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(30),
    createdAt: pastISO(2),
    updatedAt: pastISO(1),
  },

  // ── 3 group stage advancement markets ───────────────────────────────
  {
    id: "market-7",
    onchainId: 7,
    question: "Will Brazil advance from Group A?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "GROUP_STAGE",
    teamA: "Brazil",
    teamB: null,
    poolYes: usdc(8300),   // 3000+2500+2800
    poolNo: usdc(1900),    // 500+800+600
    totalVolume: usdc(10200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(2),
    updatedAt: pastISO(1),
  },
  {
    id: "market-8",
    onchainId: 8,
    question: "Will USA advance from Group B?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "GROUP_STAGE",
    teamA: "USA",
    teamB: null,
    poolYes: usdc(6000),   // 2000+1800+2200
    poolNo: usdc(3700),    // 1200+1500+1000
    totalVolume: usdc(9700),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(1),
    updatedAt: pastISO(1),
  },
  {
    id: "market-9",
    onchainId: 9,
    question: "Will England advance from Group C?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "GROUP_STAGE",
    teamA: "England",
    teamB: null,
    poolYes: usdc(7500),   // 2500+2200+2800
    poolNo: usdc(2300),    // 800+1000+500
    totalVolume: usdc(9800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(1),
    updatedAt: pastISO(1),
  },
];

// ─── Data fetcher (swap to real API with one-line change) ───────────────────

// To switch to real API: change `USE_MOCK` to false, or delete this file
// and import { getMarkets } from "./api" directly in the page.
const USE_MOCK = true;

export async function fetchMarkets(params: {
  status?: string;
  category?: string;
  sort?: "volume" | "closing_soon" | "newest";
  page?: number;
  limit?: number;
} = {}): Promise<{ markets: MarketResponse[]; pagination: PaginationResponse }> {
  if (!USE_MOCK) {
    // One-line swap: import and call the real API
    const { getMarkets } = await import("./api");
    return getMarkets(params);
  }

  // Mock implementation with filtering/sorting/pagination
  let filtered = [...MOCK_MARKETS];

  if (params.status) {
    filtered = filtered.filter(
      (m) => m.status.toUpperCase() === params.status!.toUpperCase()
    );
  }

  if (params.category) {
    filtered = filtered.filter(
      (m) => m.category.toUpperCase() === params.category!.toUpperCase()
    );
  }

  // Sort
  switch (params.sort) {
    case "volume":
      filtered.sort((a, b) => Number(BigInt(b.totalVolume) - BigInt(a.totalVolume)));
      break;
    case "closing_soon":
      filtered.sort(
        (a, b) =>
          new Date(a.resolutionTimestamp).getTime() -
          new Date(b.resolutionTimestamp).getTime()
      );
      break;
    case "newest":
    default:
      filtered.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      break;
  }

  const page = params.page || 1;
  const limit = params.limit || 20;
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit);

  return {
    markets: paginated,
    pagination: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / limit),
    },
  };
}

// Mock participant counts per market
export const MOCK_PARTICIPANTS: Record<string, number> = {
  "market-0": 3,
  "market-1": 3,
  "market-2": 3,
  "market-3": 3,
  "market-4": 3,
  "market-5": 3,
  "market-6": 3,
  "market-7": 3,
  "market-8": 3,
  "market-9": 3,
};

// ─── Mock trades for market detail ──────────────────────────────────────────

const MOCK_ADDRESSES = [
  "0x1234567890abcdef1234567890abcdef12345678",
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "0x9876543210fedcba9876543210fedcba98765432",
];

function generateMockTrades(marketId: string, market: MarketResponse): TradeResponse[] {
  const trades: TradeResponse[] = [];
  const baseTime = new Date(market.createdAt).getTime();

  // Seed trades from seed.ts data
  const tradeData: Record<string, [number, number][]> = {
    "market-0": [[500, 2000], [800, 1500], [300, 2500]],
    "market-1": [[1200, 1800], [600, 2200], [900, 1600]],
    "market-2": [[700, 2000], [400, 2500], [1100, 1200]],
    "market-3": [[2000, 1000], [1500, 1500], [2500, 800]],
    "market-4": [[1800, 1200], [2000, 1000], [1200, 2000]],
    "market-5": [[1500, 1500], [1000, 2000], [2200, 1000]],
    "market-6": [[1800, 1200], [1600, 1400], [2000, 1000]],
    "market-7": [[3000, 500], [2500, 800], [2800, 600]],
    "market-8": [[2000, 1200], [1800, 1500], [2200, 1000]],
    "market-9": [[2500, 800], [2200, 1000], [2800, 500]],
  };

  const data = tradeData[marketId] || [[1000, 1000]];
  let idx = 0;

  for (let t = 0; t < data.length; t++) {
    const [yesAmt, noAmt] = data[t];
    if (yesAmt > 0) {
      trades.push({
        id: `trade-${marketId}-${idx}`,
        marketId,
        userAddress: MOCK_ADDRESSES[t],
        outcome: 0,
        amount: usdc(yesAmt),
        shares: usdc(yesAmt),
        txHash: `0x${(idx + 1).toString(16).padStart(64, "a")}`,
        blockNumber: 1000 + idx,
        timestamp: new Date(baseTime + idx * 3_600_000).toISOString(),
      });
      idx++;
    }
    if (noAmt > 0) {
      trades.push({
        id: `trade-${marketId}-${idx}`,
        marketId,
        userAddress: MOCK_ADDRESSES[t],
        outcome: 1,
        amount: usdc(noAmt),
        shares: usdc(noAmt),
        txHash: `0x${(idx + 1).toString(16).padStart(64, "b")}`,
        blockNumber: 1000 + idx,
        timestamp: new Date(baseTime + idx * 3_600_000).toISOString(),
      });
      idx++;
    }
  }

  return trades.reverse(); // most recent first
}

// ─── Mock chart data ────────────────────────────────────────────────────────

export interface ChartDataPoint {
  time: string;
  label: string;
  outcomeA: number;
  outcomeB: number;
}

function generateChartData(market: MarketResponse, points: number = 30): ChartDataPoint[] {
  const poolYes = Number(BigInt(market.poolYes)) / 1_000_000;
  const poolNo = Number(BigInt(market.poolNo)) / 1_000_000;
  const total = poolYes + poolNo;
  const finalPct = total > 0 ? (poolYes / total) * 100 : 50;

  const data: ChartDataPoint[] = [];
  const startTime = new Date(market.createdAt).getTime();
  const endTime = Date.now();
  const step = (endTime - startTime) / (points - 1);

  // Walk from 50% toward the final implied probability with some noise
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const base = 50 + (finalPct - 50) * progress;
    const noise = (Math.sin(i * 1.7) * 4 + Math.cos(i * 0.9) * 3) * (1 - progress * 0.5);
    const pctA = Math.max(5, Math.min(95, base + noise));
    const t = new Date(startTime + step * i);
    data.push({
      time: t.toISOString(),
      label: `${t.getMonth() + 1}/${t.getDate()}`,
      outcomeA: Math.round(pctA * 10) / 10,
      outcomeB: Math.round((100 - pctA) * 10) / 10,
    });
  }

  return data;
}

// ─── fetchMarketDetail ──────────────────────────────────────────────────────

export async function fetchMarketDetail(id: string): Promise<MarketDetailResponse & { chartData: ChartDataPoint[] }> {
  if (!USE_MOCK) {
    const { getMarket } = await import("./api");
    const detail = await getMarket(id);
    return { ...detail, chartData: [] };
  }

  const market = MOCK_MARKETS.find((m) => m.id === id);
  if (!market) throw new Error("Market not found");

  const trades = generateMockTrades(id, market);

  return {
    ...market,
    recentTrades: trades.slice(0, 20),
    participantCount: MOCK_PARTICIPANTS[id] ?? 0,
    chartData: generateChartData(market),
  };
}

// ─── Mock portfolio data ──────────────────────────────────────────────────

const MOCK_USER_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

// 5 active positions across different markets
const MOCK_POSITIONS: PositionResponse[] = [
  {
    marketId: "market-0",
    marketQuestion: "Will Brazil win the 2026 FIFA World Cup?",
    marketStatus: "OPEN",
    outcome: 0,
    shares: usdc(500),
    invested: usdc(500),
    claimable: "0",
    claimed: false,
    status: "active",
  },
  {
    marketId: "market-1",
    marketQuestion: "Will Argentina win the 2026 FIFA World Cup?",
    marketStatus: "OPEN",
    outcome: 0,
    shares: usdc(1200),
    invested: usdc(1200),
    claimable: "0",
    claimed: false,
    status: "active",
  },
  {
    marketId: "market-3",
    marketQuestion: "Will Brazil beat Germany in their group stage match?",
    marketStatus: "OPEN",
    outcome: 0,
    shares: usdc(2000),
    invested: usdc(2000),
    claimable: "0",
    claimed: false,
    status: "active",
  },
  {
    marketId: "market-5",
    marketQuestion: "Will France beat Spain in the Semi-Finals?",
    marketStatus: "OPEN",
    outcome: 1,
    shares: usdc(1500),
    invested: usdc(1500),
    claimable: "0",
    claimed: false,
    status: "active",
  },
  {
    marketId: "market-7",
    marketQuestion: "Will Brazil advance from Group A?",
    marketStatus: "OPEN",
    outcome: 0,
    shares: usdc(3000),
    invested: usdc(3000),
    claimable: "0",
    claimed: false,
    status: "active",
  },
];

// 2 claimable positions (resolved markets where user won)
const MOCK_CLAIMABLE: PositionResponse[] = [
  {
    marketId: "market-won-1",
    marketQuestion: "Will Group A have more than 20 total goals?",
    marketStatus: "RESOLVED",
    outcome: 0,
    shares: usdc(800),
    invested: usdc(800),
    claimable: usdc(1480), // won — payout > invested
    claimed: false,
    status: "claimable",
  },
  {
    marketId: "market-won-2",
    marketQuestion: "Will the opening match have over 2.5 goals?",
    marketStatus: "RESOLVED",
    outcome: 1,
    shares: usdc(600),
    invested: usdc(600),
    claimable: usdc(1050),
    claimed: false,
    status: "claimable",
  },
];

// 10 trade history entries
const MOCK_TRADE_HISTORY: TradeWithMarketResponse[] = [
  {
    id: "th-1",
    marketId: "market-0",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(500),
    shares: usdc(500),
    txHash: "0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 12001,
    timestamp: pastISO(1),
    marketQuestion: "Will Brazil win the 2026 FIFA World Cup?",
    outcomeName: "Yes",
  },
  {
    id: "th-2",
    marketId: "market-1",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(1200),
    shares: usdc(1200),
    txHash: "0xdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 12010,
    timestamp: pastISO(1),
    marketQuestion: "Will Argentina win the 2026 FIFA World Cup?",
    outcomeName: "Yes",
  },
  {
    id: "th-3",
    marketId: "market-3",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(2000),
    shares: usdc(2000),
    txHash: "0x1111234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 12050,
    timestamp: pastISO(2),
    marketQuestion: "Will Brazil beat Germany in their group stage match?",
    outcomeName: "Brazil wins",
  },
  {
    id: "th-4",
    marketId: "market-5",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 1,
    amount: usdc(1500),
    shares: usdc(1500),
    txHash: "0x2221234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 12080,
    timestamp: pastISO(2),
    marketQuestion: "Will France beat Spain in the Semi-Finals?",
    outcomeName: "Draw or Spain wins",
  },
  {
    id: "th-5",
    marketId: "market-7",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(3000),
    shares: usdc(3000),
    txHash: "0x3331234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 12100,
    timestamp: pastISO(3),
    marketQuestion: "Will Brazil advance from Group A?",
    outcomeName: "Yes",
  },
  {
    id: "th-6",
    marketId: "market-won-1",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(800),
    shares: usdc(800),
    txHash: "0x4441234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 11500,
    timestamp: pastISO(5),
    marketQuestion: "Will Group A have more than 20 total goals?",
    outcomeName: "Yes",
  },
  {
    id: "th-7",
    marketId: "market-won-2",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 1,
    amount: usdc(600),
    shares: usdc(600),
    txHash: "0x5551234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 11480,
    timestamp: pastISO(5),
    marketQuestion: "Will the opening match have over 2.5 goals?",
    outcomeName: "No",
  },
  {
    id: "th-8",
    marketId: "market-4",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(400),
    shares: usdc(400),
    txHash: "0x6661234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 11400,
    timestamp: pastISO(7),
    marketQuestion: "Will Argentina beat England in the Quarter-Finals?",
    outcomeName: "Argentina wins",
  },
  {
    id: "th-9",
    marketId: "market-6",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 1,
    amount: usdc(750),
    shares: usdc(750),
    txHash: "0x7771234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 11350,
    timestamp: pastISO(8),
    marketQuestion: "Will USA beat Mexico in their group stage match?",
    outcomeName: "Draw or Mexico wins",
  },
  {
    id: "th-10",
    marketId: "market-2",
    userAddress: MOCK_USER_ADDRESS,
    outcome: 0,
    amount: usdc(950),
    shares: usdc(950),
    txHash: "0x8881234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd",
    blockNumber: 11300,
    timestamp: pastISO(10),
    marketQuestion: "Will France win the 2026 FIFA World Cup?",
    outcomeName: "Yes",
  },
];

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  if (!USE_MOCK) {
    const { getUserPortfolio } = await import("./api");
    return getUserPortfolio(MOCK_USER_ADDRESS);
  }

  const allPositions = [...MOCK_POSITIONS, ...MOCK_CLAIMABLE];
  const totalInvested = allPositions.reduce(
    (sum, p) => sum + BigInt(p.invested),
    0n
  );
  const totalClaimable = MOCK_CLAIMABLE.reduce(
    (sum, p) => sum + BigInt(p.claimable),
    0n
  );

  return {
    address: MOCK_USER_ADDRESS,
    positions: allPositions,
    summary: {
      totalInvested: totalInvested.toString(),
      totalClaimable: totalClaimable.toString(),
      totalClaimed: "0",
    },
  };
}

export async function fetchTradeHistory(params: {
  page?: number;
  limit?: number;
} = {}): Promise<{
  trades: TradeWithMarketResponse[];
  pagination: PaginationResponse;
}> {
  if (!USE_MOCK) {
    const { getUserHistory } = await import("./api");
    return getUserHistory(MOCK_USER_ADDRESS, params);
  }

  const page = params.page || 1;
  const limit = params.limit || 5;
  const start = (page - 1) * limit;
  const paginated = MOCK_TRADE_HISTORY.slice(start, start + limit);

  return {
    trades: paginated,
    pagination: {
      page,
      limit,
      total: MOCK_TRADE_HISTORY.length,
      totalPages: Math.ceil(MOCK_TRADE_HISTORY.length / limit),
    },
  };
}
