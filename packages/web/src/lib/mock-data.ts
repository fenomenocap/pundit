import { MarketResponse, MarketDetailResponse, TradeWithMarketResponse, PortfolioResponse, PaginationResponse } from "./api";

// ─── Pre-testnet launch markets ─────────────────────────────────────────────
// 3 markets ready for on-chain deployment. Pools start at 0 — they populate
// from real trades once contracts are deployed on Base Sepolia.

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
    poolYes: usdc(0),
    poolNo: usdc(0),
    totalVolume: usdc(0),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(180),
    createdAt: pastISO(1),
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
    poolYes: usdc(0),
    poolNo: usdc(0),
    totalVolume: usdc(0),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(100),
    createdAt: pastISO(1),
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
    poolYes: usdc(0),
    poolNo: usdc(0),
    totalVolume: usdc(0),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(100),
    createdAt: pastISO(1),
    updatedAt: pastISO(0),
  },
];

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
  "market-0": 0,
  "market-1": 0,
  "market-2": 0,
};

// ─── Chart data ─────────────────────────────────────────────────────────────

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

  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const base = 50 + (finalPct - 50) * progress;
    const noise = (Math.sin(i * 1.7) * 2 + Math.cos(i * 0.9) * 1.5) * (1 - progress * 0.5);
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
