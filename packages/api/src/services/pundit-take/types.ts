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
  fairDecimal: string;
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
  odds: PunditTakeSourceOdds[];
  evidenceUrls: Array<{ id: string; url: string; publisher: string }>;
}

export interface PunditTakeDelivery {
  answer: string;
  plan: PunditTakePlan;
  sources: PunditTakeSourcesFooter;
}
