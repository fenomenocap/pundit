import { MarketResponse, MarketDetailResponse, TradeWithMarketResponse, PortfolioResponse, PaginationResponse, LeaderboardEntry, PolymarketMarket } from "./api";

// ─── Pre-testnet launch markets ─────────────────────────────────────────────
// All WC 2026 focused. Today = June 5 2026; tournament opens June 11.

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

// ─── Mock markets — WC 2026 outrights + group stage ─────────────────────────

export const MOCK_MARKETS: MarketResponse[] = [
  // ── Outrights (binary Yes/No) ──────────────────────────────────────────────
  {
    id: "market-0",
    onchainId: 0,
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "Brazil",
    teamB: null,
    poolYes: usdc(2200),
    poolNo:  usdc(800),
    totalVolume: usdc(8400),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-1",
    onchainId: 1,
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "Argentina",
    teamB: null,
    poolYes: usdc(1800),
    poolNo:  usdc(1200),
    totalVolume: usdc(6200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-2",
    onchainId: 2,
    question: "Will France win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "France",
    teamB: null,
    poolYes: usdc(1500),
    poolNo:  usdc(1500),
    totalVolume: usdc(5800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-3",
    onchainId: 3,
    question: "Will England win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "England",
    teamB: null,
    poolYes: usdc(900),
    poolNo:  usdc(2100),
    totalVolume: usdc(4800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-4",
    onchainId: 4,
    question: "Will Spain win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "Spain",
    teamB: null,
    poolYes: usdc(1200),
    poolNo:  usdc(1800),
    totalVolume: usdc(4200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(14),
    updatedAt: pastISO(0),
  },
  {
    id: "market-5",
    onchainId: 5,
    question: "Will the USA win the 2026 FIFA World Cup?",
    outcomeA: "Yes",
    outcomeB: "No",
    category: "WORLD_CUP",
    teamA: "USA",
    teamB: null,
    poolYes: usdc(200),
    poolNo:  usdc(2800),
    totalVolume: usdc(3100),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(45),
    createdAt: pastISO(7),
    updatedAt: pastISO(0),
  },
  // ── Group Stage Matches (3-way) ────────────────────────────────────────────
  {
    id: "market-6",
    onchainId: 6,
    question: "USA vs Mexico — 2026 FIFA World Cup Group Stage",
    outcomeA: "USA Win",
    outcomeB: "Mexico Win",
    outcomeC: "Draw",
    category: "WORLD_CUP",
    teamA: "USA",
    teamB: "Mexico",
    poolYes:  usdc(600),
    poolNo:   usdc(900),
    poolDraw: usdc(800),
    totalVolume: usdc(5200),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(10),
    createdAt: pastISO(5),
    updatedAt: pastISO(0),
  },
  {
    id: "market-7",
    onchainId: 7,
    question: "England vs France — 2026 FIFA World Cup Group Stage",
    outcomeA: "England Win",
    outcomeB: "France Win",
    outcomeC: "Draw",
    category: "WORLD_CUP",
    teamA: "England",
    teamB: "France",
    poolYes:  usdc(700),
    poolNo:   usdc(1100),
    poolDraw: usdc(800),
    totalVolume: usdc(7400),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(15),
    createdAt: pastISO(5),
    updatedAt: pastISO(0),
  },
  {
    id: "market-8",
    onchainId: 8,
    question: "Spain vs Germany — 2026 FIFA World Cup Group Stage",
    outcomeA: "Spain Win",
    outcomeB: "Germany Win",
    outcomeC: "Draw",
    category: "WORLD_CUP",
    teamA: "Spain",
    teamB: "Germany",
    poolYes:  usdc(850),
    poolNo:   usdc(800),
    poolDraw: usdc(750),
    totalVolume: usdc(6900),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(16),
    createdAt: pastISO(4),
    updatedAt: pastISO(0),
  },
  {
    id: "market-9",
    onchainId: 9,
    question: "Brazil vs Argentina — 2026 FIFA World Cup Group Stage",
    outcomeA: "Brazil Win",
    outcomeB: "Argentina Win",
    outcomeC: "Draw",
    category: "WORLD_CUP",
    teamA: "Brazil",
    teamB: "Argentina",
    poolYes:  usdc(1100),
    poolNo:   usdc(700),
    poolDraw: usdc(600),
    totalVolume: usdc(9800),
    status: "OPEN",
    resolvedOutcome: null,
    resolvedAt: null,
    resolutionTimestamp: futureISO(17),
    createdAt: pastISO(3),
    updatedAt: pastISO(0),
  },
];

// ─── Polymarket reference odds (mock) ────────────────────────────────────────
// Realistic implied probabilities sourced from Polymarket WC markets.

const MOCK_POLYMARKET_ODDS: Record<string, { outcomes: string[]; prices: number[] }> = {
  "market-0": { outcomes: ["Yes", "No"],                            prices: [0.34, 0.66] },
  "market-1": { outcomes: ["Yes", "No"],                            prices: [0.28, 0.72] },
  "market-2": { outcomes: ["Yes", "No"],                            prices: [0.22, 0.78] },
  "market-3": { outcomes: ["Yes", "No"],                            prices: [0.14, 0.86] },
  "market-4": { outcomes: ["Yes", "No"],                            prices: [0.18, 0.82] },
  "market-5": { outcomes: ["Yes", "No"],                            prices: [0.06, 0.94] },
  "market-6": { outcomes: ["USA Win", "Draw", "Mexico Win"],        prices: [0.38, 0.28, 0.34] },
  "market-7": { outcomes: ["England Win", "Draw", "France Win"],    prices: [0.32, 0.27, 0.41] },
  "market-8": { outcomes: ["Spain Win", "Draw", "Germany Win"],     prices: [0.35, 0.29, 0.36] },
  "market-9": { outcomes: ["Brazil Win", "Draw", "Argentina Win"],  prices: [0.44, 0.26, 0.30] },
};

// ─── Parimutuel price helper ─────────────────────────────────────────────────

export function getParimutuelPrices(market: MarketResponse): {
  yesPrice: number;
  noPrice: number;
  drawPrice: number;
} {
  const yesPool  = Number(BigInt(market.poolYes))              / 1_000_000;
  const noPool   = Number(BigInt(market.poolNo))               / 1_000_000;
  const drawPool = market.poolDraw ? Number(BigInt(market.poolDraw)) / 1_000_000 : 0;
  const total    = yesPool + noPool + drawPool;
  if (total === 0) return { yesPrice: 50, noPrice: 50, drawPrice: 0 };
  return {
    yesPrice:  Math.round((yesPool  / total) * 1000) / 10,
    noPrice:   Math.round((noPool   / total) * 1000) / 10,
    drawPrice: Math.round((drawPool / total) * 1000) / 10,
  };
}

/** @deprecated Use getParimutuelPrices — kept for any stale call sites */
export function getAmmPrices(market: MarketResponse): { yesPrice: number; noPrice: number } {
  const { yesPrice, noPrice } = getParimutuelPrices(market);
  return { yesPrice, noPrice };
}

// ─── Data layer (mock ↔ real API swap) ──────────────────────────────────────

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

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
  "market-0": 42,
  "market-1": 38,
  "market-2": 31,
  "market-3": 27,
  "market-4": 24,
  "market-5": 19,
  "market-6": 56,
  "market-7": 71,
  "market-8": 63,
  "market-9": 88,
};

// ─── Chart data ─────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  time: string;
  label: string;
  outcomeA: number;
  outcomeB: number;
}

function generateChartData(market: MarketResponse, points: number = 30): ChartDataPoint[] {
  const { yesPrice: finalPct } = getParimutuelPrices(market);

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
    polymarketOdds: MOCK_POLYMARKET_ODDS[id] ?? null,
    chartData: generateChartData(market),
  };
}

// ─── Portfolio ───────────────────────────────────────────────────────────────

export async function fetchPortfolio(address?: string): Promise<PortfolioResponse> {
  if (!USE_MOCK) {
    if (!address) return { address: "", positions: [], summary: { totalInvested: "0", totalClaimable: "0", totalClaimed: "0" } };
    const { getUserPortfolio } = await import("./api");
    return getUserPortfolio(address);
  }

  return {
    address: address ?? "",
    positions: [],
    summary: {
      totalInvested: "0",
      totalClaimable: "0",
      totalClaimed: "0",
    },
  };
}

// ─── Trade history ───────────────────────────────────────────────────────────

export async function fetchTradeHistory(
  params: { page?: number; limit?: number } = {},
  address?: string
): Promise<{ trades: TradeWithMarketResponse[]; pagination: PaginationResponse }> {
  if (!USE_MOCK) {
    if (!address) return { trades: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } };
    const { getUserHistory } = await import("./api");
    return getUserHistory(address, params);
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

// ─── Leaderboard ─────────────────────────────────────────────────────────────

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1,  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", profit: usdc(4820),  totalInvested: usdc(12000), roi: 40.2,  wins: 14, losses: 3, winRate: 82.4, marketsTraded: 17 },
  { rank: 2,  address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", profit: usdc(3140),  totalInvested: usdc(9500),  roi: 33.1,  wins: 11, losses: 4, winRate: 73.3, marketsTraded: 15 },
  { rank: 3,  address: "0x2546BcD3c84621e976D8185a91A922aE77ECEc30", profit: usdc(2290),  totalInvested: usdc(8200),  roi: 27.9,  wins: 9,  losses: 4, winRate: 69.2, marketsTraded: 13 },
  { rank: 4,  address: "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E", profit: usdc(1870),  totalInvested: usdc(7800),  roi: 24.0,  wins: 8,  losses: 5, winRate: 61.5, marketsTraded: 13 },
  { rank: 5,  address: "0xdD2FD4581271e230360230F9337D5c0430Bf44C0", profit: usdc(1450),  totalInvested: usdc(6200),  roi: 23.4,  wins: 7,  losses: 4, winRate: 63.6, marketsTraded: 11 },
  { rank: 6,  address: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", profit: usdc(980),   totalInvested: usdc(5500),  roi: 17.8,  wins: 6,  losses: 5, winRate: 54.5, marketsTraded: 11 },
  { rank: 7,  address: "0x09DB0a93B389bEF724429898f539AEB7ac2Dd55f", profit: usdc(620),   totalInvested: usdc(4100),  roi: 15.1,  wins: 5,  losses: 5, winRate: 50.0, marketsTraded: 10 },
  { rank: 8,  address: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec", profit: usdc(310),   totalInvested: usdc(3200),  roi: 9.7,   wins: 4,  losses: 5, winRate: 44.4, marketsTraded: 9  },
  { rank: 9,  address: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097", profit: usdc(-240),  totalInvested: usdc(2800),  roi: -8.6,  wins: 3,  losses: 6, winRate: 33.3, marketsTraded: 9  },
  { rank: 10, address: "0xcd3B766CCDd6AE721141F452C550Ca635964ce71", profit: usdc(-890),  totalInvested: usdc(4400),  roi: -20.2, wins: 2,  losses: 7, winRate: 22.2, marketsTraded: 9  },
];

export async function fetchLeaderboard(params: {
  period?: "all" | "30d" | "7d";
  limit?: number;
} = {}): Promise<{ period: string; leaderboard: LeaderboardEntry[] }> {
  if (!USE_MOCK) {
    const { getLeaderboard } = await import("./api");
    return getLeaderboard(params);
  }

  const limit = params.limit ?? 50;
  return {
    period: params.period ?? "all",
    leaderboard: MOCK_LEADERBOARD.slice(0, limit),
  };
}

// ─── Polymarket mock markets ─────────────────────────────────────────────────
// Realistic WC 2026 markets as they appear on Polymarket's Gamma API.
// Derived from MOCK_POLYMARKET_ODDS above + MOCK_MARKETS for questions/dates.

const MOCK_POLYMARKET_MARKETS: PolymarketMarket[] = [
  {
    id: "pm-wc-brazil",
    question: "Will Brazil win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.34, 0.66],
    volume: 1_840_000,
    liquidity: 420_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-argentina",
    question: "Will Argentina win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.28, 0.72],
    volume: 1_560_000,
    liquidity: 380_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-france",
    question: "Will France win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.22, 0.78],
    volume: 1_230_000,
    liquidity: 310_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-england",
    question: "Will England win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.14, 0.86],
    volume: 890_000,
    liquidity: 210_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-spain",
    question: "Will Spain win the 2026 FIFA World Cup?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.18, 0.82],
    volume: 760_000,
    liquidity: 180_000,
    endDate: futureISO(45),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-usa-mexico",
    question: "USA vs Mexico — 2026 FIFA World Cup Group Stage",
    outcomes: ["USA Win", "Draw", "Mexico Win"],
    outcomePrices: [0.38, 0.28, 0.34],
    volume: 540_000,
    liquidity: 120_000,
    endDate: futureISO(8),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-england-france",
    question: "England vs France — 2026 FIFA World Cup Group Stage",
    outcomes: ["England Win", "Draw", "France Win"],
    outcomePrices: [0.32, 0.27, 0.41],
    volume: 680_000,
    liquidity: 160_000,
    endDate: futureISO(12),
    resolved: false,
    active: true,
  },
  {
    id: "pm-wc-brazil-argentina",
    question: "Brazil vs Argentina — 2026 FIFA World Cup Group Stage",
    outcomes: ["Brazil Win", "Draw", "Argentina Win"],
    outcomePrices: [0.44, 0.26, 0.30],
    volume: 920_000,
    liquidity: 230_000,
    endDate: futureISO(17),
    resolved: false,
    active: true,
  },
];

// ─── Polymarket fetch (mock ↔ real API swap) ─────────────────────────────────

export async function fetchPolymarketMarkets(): Promise<PolymarketMarket[]> {
  if (!USE_MOCK) {
    try {
      const { getPolymarketMarkets } = await import("./api");
      const data = await getPolymarketMarkets();
      return data.markets ?? [];
    } catch {
      return []; // API down — caller hides the section gracefully
    }
  }
  return MOCK_POLYMARKET_MARKETS;
}
