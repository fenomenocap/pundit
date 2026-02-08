const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketResponse {
  id: string;
  onchainId: number;
  question: string;
  outcomeA: string;
  outcomeB: string;
  category: string;
  teamA: string | null;
  teamB: string | null;
  poolYes: string;
  poolNo: string;
  totalVolume: string;
  status: string;
  resolvedOutcome: number | null;
  resolvedAt: string | null;
  resolutionTimestamp: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketDetailResponse extends MarketResponse {
  recentTrades: TradeResponse[];
  participantCount: number;
}

export interface TradeResponse {
  id: string;
  marketId: string;
  userAddress: string;
  outcome: number;
  amount: string;
  shares: string;
  txHash: string;
  blockNumber: number;
  timestamp: string;
}

export interface TradeWithMarketResponse extends TradeResponse {
  marketQuestion: string;
  outcomeName: string;
}

export interface PositionResponse {
  marketId: string;
  marketQuestion: string;
  marketStatus: string;
  outcome: number;
  shares: string;
  invested: string;
  claimable: string;
  claimed: boolean;
  status: "active" | "won" | "lost" | "claimable" | "claimed" | "refundable";
}

export interface PortfolioResponse {
  address: string;
  positions: PositionResponse[];
  summary: {
    totalInvested: string;
    totalClaimable: string;
    totalClaimed: string;
  };
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  profit: string;
  totalInvested: string;
  wins: number;
  losses: number;
  marketsTraded: number;
}

export interface PaginationResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── Fetch helper ───────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }

  return res.json();
}

// ─── Market endpoints ───────────────────────────────────────────────────────

export interface GetMarketsParams {
  status?: string;
  category?: string;
  sort?: "volume" | "closing_soon" | "newest";
  page?: number;
  limit?: number;
}

export async function getMarkets(params: GetMarketsParams = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.category) query.set("category", params.category);
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<{ markets: MarketResponse[]; pagination: PaginationResponse }>(
    `/api/markets${qs ? `?${qs}` : ""}`
  );
}

export async function getMarket(id: string) {
  return apiFetch<MarketDetailResponse>(`/api/markets/${id}`);
}

export async function createMarket(
  data: {
    onchainId: number;
    question: string;
    outcomeA: string;
    outcomeB: string;
    category: string;
    teamA?: string;
    teamB?: string;
    resolutionTimestamp: string;
  },
  adminAddress: string
) {
  return apiFetch<MarketResponse>("/api/markets", {
    method: "POST",
    headers: { "x-admin-address": adminAddress },
    body: JSON.stringify(data),
  });
}

export async function resolveMarket(
  id: string,
  outcome: 0 | 1,
  adminAddress: string
) {
  return apiFetch<MarketResponse>(`/api/markets/${id}/resolve`, {
    method: "POST",
    headers: { "x-admin-address": adminAddress },
    body: JSON.stringify({ outcome }),
  });
}

// ─── User endpoints ─────────────────────────────────────────────────────────

export async function getUserPortfolio(address: string) {
  return apiFetch<PortfolioResponse>(
    `/api/users/${address.toLowerCase()}/portfolio`
  );
}

export async function getUserHistory(
  address: string,
  params: { page?: number; limit?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<{
    address: string;
    trades: TradeWithMarketResponse[];
    pagination: PaginationResponse;
  }>(`/api/users/${address.toLowerCase()}/history${qs ? `?${qs}` : ""}`);
}

// ─── Leaderboard ────────────────────────────────────────────────────────────

export async function getLeaderboard(
  params: { period?: "all" | "30d" | "7d"; limit?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.period) query.set("period", params.period);
  if (params.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<{ period: string; leaderboard: LeaderboardEntry[] }>(
    `/api/leaderboard${qs ? `?${qs}` : ""}`
  );
}

// ─── Health ─────────────────────────────────────────────────────────────────

export async function getHealth() {
  return apiFetch<{ status: string; db: string }>("/health");
}
