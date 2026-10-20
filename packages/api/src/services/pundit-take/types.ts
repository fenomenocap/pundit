import type { OneXTwoOutcome } from "../response-correctness";

export const PUNDIT_TAKE_PLAN_SCHEMA_VERSION = 1 as const;

export type TakePlanMarketKind = "1x2" | "btts" | "totals";

export type TakePlanPointRole = "support" | "contradict" | "flip";

export interface TakePlanPoint {
  id: string;
  role: TakePlanPointRole;
  /** Football-language seed the prose renderer may use verbatim in part. */
  text: string;
  fieldPath?: string;
  evidenceId?: string;
}

export interface TakePlanCall {
  outcome: OneXTwoOutcome;
  sideLabel: string;
  /** Short headline side name (e.g. Spurs, Draw). */
  headlineLabel: string;
}

export interface TakePlanValueLeg {
  outcome: OneXTwoOutcome;
  label: string;
  modelPctInt: number;
  fairDecimal: string;
  bestMarketDecimal: string | null;
  gapPoints: number;
}

export interface TakePlanMarketColumn {
  sourceKey: string;
  shortLabel: string;
  observedAt: string;
}

export interface TakePlanRow {
  outcome: OneXTwoOutcome;
  label: string;
  modelPctInt: number;
  fairDecimal: string;
  sourceDecimals: Record<string, string | null>;
  bestDecimal: string | null;
}

export interface TakePlanGridRow {
  sideKey: string;
  label: string;
  modelPctInt: number;
  fairDecimal: string;
  sourceDecimals: Record<string, string | null>;
  bestDecimal: string | null;
}

export interface TakePlanGridCall {
  sideKey: string;
  headlineLabel: string;
  modelPctInt: number;
  /** Desk-rounded percent label for headlines (matches model row). */
  modelPctDisplay: string;
  fairDecimal: string;
  /** True when the top two grid sides are within 2 probability points. */
  coinFlip?: boolean;
}

/** Server-computed numbers the prose guard may cite (LLM must not derive gaps). */
export interface TakePlanNumericFacts {
  table: {
    homePosition: number | null;
    awayPosition: number | null;
    homePoints: number | null;
    awayPoints: number | null;
    /** Absolute points gap between the two clubs when both totals are known. */
    pointsClear: number | null;
    positionsApart: number | null;
  };
  /** Gap in percentage points between the top two 1X2 (or grid) outcomes. */
  topTwoGapPoints: number;
  /** True when `topTwoGapPoints` is strictly under 2. */
  coinFlip: boolean;
  /** Last-five league form from dossier or grounding form snapshot. */
  formLast5: {
    homePoints: number | null;
    awayPoints: number | null;
    home: TakePlanLast5FormRecord | null;
    away: TakePlanLast5FormRecord | null;
  };
}

export interface TakePlanLast5FormRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Unbeaten run from the most recent result backward (W/D until first L). */
  unbeatenRun: number;
  /** Winless run from the most recent result backward (L/D until first W). */
  winlessRun: number;
}

export interface PunditTakePlan {
  schemaVersion: typeof PUNDIT_TAKE_PLAN_SCHEMA_VERSION;
  marketKind: TakePlanMarketKind;
  fixtureLabel: string;
  call: TakePlanCall;
  /** BTTS / totals headline side when `marketKind` is not `1x2`. */
  gridCall: TakePlanGridCall | null;
  gridRows: TakePlanGridRow[];
  supporting: TakePlanPoint[];
  contradicting: TakePlanPoint[];
  flipCondition: TakePlanPoint | null;
  valueLeg: TakePlanValueLeg | null;
  hasCompleteMarket: boolean;
  rows: TakePlanRow[];
  marketColumns: TakePlanMarketColumn[];
  /** Present on plans from `buildPunditTakePlan`; guards tolerate absence in unit fixtures. */
  numericFacts?: TakePlanNumericFacts;
}

export interface PunditTakeSourceOdds {
  source: string;
  label: string;
  observedAt: string;
  observedAtSgt: string;
}

export interface PunditTakeSourcesFooter {
  modelVersion: string;
  modelPricedAt: string;
  modelPricedAtSgt: string;
  ratingsAsOf: string | null;
  ratingsAsOfSgt: string | null;
  homeClubRating: number | null;
  awayClubRating: number | null;
  tableSource: string;
  tableAsOf: string | null;
  tableAsOfSgt: string | null;
  formSource: string;
  formAsOf: string | null;
  formAsOfSgt: string | null;
  odds: PunditTakeSourceOdds[];
  evidenceUrls: Array<{ id: string; url: string; publisher: string }>;
  fplInjuryStatusAsOfSgt: string | null;
}

export interface PunditTakeDelivery {
  answer: string;
  plan: PunditTakePlan;
  sources: PunditTakeSourcesFooter;
}
