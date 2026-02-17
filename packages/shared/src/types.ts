export enum MarketStatus {
  Open = "OPEN",
  Locked = "LOCKED",
  Resolved = "RESOLVED",
  Cancelled = "CANCELLED",
}

export enum MarketCategory {
  GroupStage = "GROUP_STAGE",
  RoundOf16 = "ROUND_OF_16",
  QuarterFinal = "QUARTER_FINAL",
  SemiFinal = "SEMI_FINAL",
  Final = "FINAL",
  Tournament = "TOURNAMENT",
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
  amount: bigint; // USDC amount (6 decimals)
  shares: bigint;
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
