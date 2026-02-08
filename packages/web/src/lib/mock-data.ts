import { MarketResponse, PaginationResponse } from "./api";

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
