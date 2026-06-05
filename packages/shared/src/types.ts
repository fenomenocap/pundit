export enum MarketStatus {
  Open = "OPEN",
  Locked = "LOCKED",
  Resolved = "RESOLVED",
  Cancelled = "CANCELLED",
}

export enum MarketCategory {
  WorldCup = "WORLD_CUP",
  ChampionsLeague = "CHAMPIONS_LEAGUE",
  EuropaLeague = "EUROPA_LEAGUE",
  PremierLeague = "PREMIER_LEAGUE",
  LaLiga = "LA_LIGA",
  Bundesliga = "BUNDESLIGA",
  SerieA = "SERIE_A",
  Ligue1 = "LIGUE_1",
  Other = "OTHER",
}

export enum Outcome {
  Yes = 0,
  No = 1,
  Draw = 2,
}

export interface Market {
  id: string;
  question: string;
  category: MarketCategory;
  status: MarketStatus;
  outcomes: [string, string] | [string, string, string]; // e.g. ["Yes", "No"] or ["Brazil", "Germany", "Draw"]
  poolYes: bigint;
  poolNo: bigint;
  poolDraw?: bigint;
  resolutionDate: number; // unix timestamp
  resolvedOutcome: Outcome | null;
  createdAt: number;
}

export interface Trade {
  id: string;
  marketId: string;
  trader: string; // ethereum address
  outcome: Outcome;
  grossAmount: bigint; // USDC paid by user (6 decimals, before 2% fee)
  netShares: bigint;   // shares received (after fee); used as pool contribution
  timestamp: number;
  txHash: string;
}

export interface Position {
  marketId: string;
  trader: string;
  outcome: Outcome;
  shares: bigint;
  avgPrice: bigint; // USDC per share (6 decimals)
}
