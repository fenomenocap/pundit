import { MarketResponse, MarketDetailResponse, TradeWithMarketResponse, PortfolioResponse, PaginationResponse } from "./api";

// ─── Pre-testnet launch markets ─────────────────────────────────────────────
// 3 markets ready for on-chain deployment. Reserves represent AMM liquidity
// pools that will be initialized via initializePool() on contract deployment.

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
  {
    id: "market-0",
    onchainId: 0,
    question: "Will England win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "England",
    teamB: null,
    // AMM reserves: yesReserve=850, noReserve=150 → YES price = 15%, NO price = 85%
    poolYes: usdc(850),
    poolNo: usdc(150),
    totalVolume: usdc(2400),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(180),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-1",
    onchainId: 1,
    question: "Will Arsenal win the 2025-26 English Premier League?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "EPL",
    teamA: "Arsenal",
    teamB: null,
    // AMM reserves: yesReserve=750, noReserve=250 → YES price = 25%, NO price = 75%
    poolYes: usdc(750),
    poolNo: usdc(250),
    totalVolume: usdc(5100),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(100),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-2",
    onchainId: 2,
    question: "Will Barcelona win the 2025-26 La Liga?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "LA_LIGA",
    teamA: "Barcelona",
    teamB: null,
    // AMM reserves: yesReserve=650, noReserve=350 → YES price = 35%, NO price = 65%
    poolYes: usdc(650),
    poolNo: usdc(350),
    totalVolume: usdc(3800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(100),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-3",
    onchainId: 3,
    question: "Brazil vs Germany — 2026 World Cup Quarter-Final",
    outcomeA: "Brazil",
    outcomeB: "Germany",
    outcomeC: "Draw",
    category: "WORLD_CUP",
    teamA: "Brazil",
    teamB: "Germany",
    // 3-way AMM reserves: Brazil=400, Germany=500, Draw=600
    // Prices: Brazil ~43%, Germany ~34%, Draw ~23%
    poolYes: usdc(400),
    poolNo: usdc(500),
    poolDraw: usdc(600),
    totalVolume: usdc(4200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(160),
    createdAt: pastISO(7),
    updatedAt: pastISO(0),
  },
  {
    id: "market-4",
    onchainId: 4,
    question: "Arsenal vs Liverpool — EPL Matchweek 28",
    outcomeA: "Arsenal",
    outcomeB: "Liverpool",
    outcomeC: "Draw",
    category: "EPL",
    teamA: "Arsenal",
    teamB: "Liverpool",
    // 3-way AMM reserves: Arsenal=350, Liverpool=450, Draw=700
    // Prices: Arsenal ~45%, Liverpool ~35%, Draw ~20%
    poolYes: usdc(350),
    poolNo: usdc(450),
    poolDraw: usdc(700),
    totalVolume: usdc(6800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(12),
    createdAt: pastISO(3),
    updatedAt: pastISO(0),
  },
];

// ─── AMM price helper ───────────────────────────────────────────────────────

export function getAmmPrices(market: MarketResponse): { yesPrice: number; noPrice: number } {
  const yesRes = Number(BigInt(market.poolYes)) / 1_000_000;
  const noRes = Number(BigInt(market.poolNo)) / 1_000_000;
  const total = yesRes + noRes;
  if (total === 0) return { yesPrice: 50, noPrice: 50 };
  return {
    yesPrice: Math.round((noRes / total) * 100),
    noPrice: Math.round((yesRes / total) * 100),
  };
}

// ─── Data layer (mock ↔ real API swap) ──────────────────────────────────────

// Set to false when API backend is live
const USE_MOCK = true;

export async function fetchMarkets(params: {
  status?: string;
  category?: string;
  sort?: "volume" | "closing_soon" | "newest";
  page?: number;
  limit?: number;
} = {}): Promise<{ markets: MarketResponse[]; pagination: PaginationResponse }> {
  if (!USE_MOCK) {
    const { getMarkets } = await import("./api");
    return getMarkets(params);
  }

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

export const MOCK_PARTICIPANTS: Record<string, number> = {
  "market-0": 12,
  "market-1": 28,
  "market-2": 19,
  "market-3": 34,
  "market-4": 47,
};

// ─── Chart data ─────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  time: string;
  label: string;
  outcomeA: number;
  outcomeB: number;
}

function generateChartData(market: MarketResponse, points: number = 30): ChartDataPoint[] {
  const { yesPrice: finalPct } = getAmmPrices(market);

  const data: ChartDataPoint[] = [];
  const startTime = new Date(market.createdAt).getTime();
  const endTime = Date.now();
  const step = (endTime - startTime) / (points - 1);

  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const base = 50 + (finalPct - 50) * progress;
    const noise = (Math.sin(i * 1.7) * 3 + Math.cos(i * 0.9) * 2) * (1 - progress * 0.5);
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

// ─── Market detail ──────────────────────────────────────────────────────────

export async function fetchMarketDetail(id: string): Promise<MarketDetailResponse & { chartData: ChartDataPoint[] }> {
  if (!USE_MOCK) {
    const { getMarket } = await import("./api");
    const detail = await getMarket(id);
    return { ...detail, chartData: [] };
  }

  const market = MOCK_MARKETS.find((m) => m.id === id);
  if (!market) throw new Error("Market not found");

  return {
    ...market,
    recentTrades: [],
    participantCount: MOCK_PARTICIPANTS[id] ?? 0,
    chartData: generateChartData(market),
  };
}

// ─── Portfolio (empty for pre-testnet) ──────────────────────────────────────

export async function fetchPortfolio(): Promise<PortfolioResponse> {
  if (!USE_MOCK) {
    const { getUserPortfolio } = await import("./api");
    return getUserPortfolio("");
  }

  return {
    address: "",
    positions: [],
    summary: {
      totalInvested: "0",
      totalClaimable: "0",
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
    return getUserHistory("", params);
  }

  return {
    trades: [],
    pagination: {
      page: params.page || 1,
      limit: params.limit || 10,
      total: 0,
      totalPages: 0,
    },
  };
}
