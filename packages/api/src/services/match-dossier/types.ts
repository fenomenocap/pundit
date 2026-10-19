import type { EvidenceTier } from "../evidence-authority";
import type { DataTrustTier } from "../data-layer/types";
import type { ResultMark } from "../club-form";

export const MATCH_DOSSIER_SCHEMA_VERSION = 1 as const;

/** Trust tier for dossier fields — extends evidence tiers with server-owned spines. */
export type DossierTrustTier = DataTrustTier;

export interface DossierProvenance {
  sourceId: string;
  label: string;
  trustTier: DossierTrustTier;
  asOf: string;
  url?: string;
}

export interface ProvenanceField<T> {
  value: T;
  provenance: DossierProvenance;
}

export type ModelFactorId =
  | "elo-rating-gap"
  | "home-advantage"
  | "goal-calibration-shape"
  | "form"
  | "rolling-xg"
  | "rest-congestion"
  | "injuries"
  | "lineups"
  | "motivation"
  | "tactics"
  | "other";

export type EvidenceDirection =
  | "supports-home"
  | "supports-away"
  | "supports-draw"
  | "neutral"
  | "contradicts-model";

export interface DossierEvidenceItem {
  id: string;
  capturedAt: string;
  headline: string;
  detail?: string;
  url?: string;
  trustTier: EvidenceTier;
  direction: EvidenceDirection;
  relatedFactor: ModelFactorId;
  /** On-demand search writes back; scheduled layer may pre-populate later phases. */
  origin: "scheduled" | "on-demand";
}

export interface FormWindow {
  results: ResultMark[];
  played: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface HomeAwaySplit {
  home: FormWindow;
  away: FormWindow;
}

export interface HeadToHeadMeeting {
  utcDate: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  competitionId: string;
}

export interface RestCongestion {
  restDaysHome: number | null;
  restDaysAway: number | null;
  homeMatchesLast14Days: number;
  awayMatchesLast14Days: number;
}

export interface ModelFactorContribution {
  factorId: ModelFactorId;
  label: string;
  /** Signed shift in home-win probability vs the prior counterfactual step (percentage points). */
  deltaPHomePct: number;
  deltaPDrawPct: number;
  deltaPAwayPct: number;
  narrative: string;
}

export interface ModelFactorBreakdown {
  shipped: { pHome: number; pDraw: number; pAway: number };
  counterfactualSteps: ModelFactorContribution[];
  eloGapEffective: number;
  homeAdvantageElo: number;
  lambdaHome: number;
  lambdaAway: number;
  totalXg: number;
  calibrationActive: boolean;
}

export interface MarketSnapshotRow {
  source: string;
  observedAt: string;
  pHome: number;
  pDraw: number | null;
  pAway: number;
}

export interface MatchDossierFixtureRef {
  fixtureId: string;
  espnEventId: number;
  competitionId: string;
  competition: string;
  kickoffUtc: string;
  home: string;
  away: string;
}

export interface MatchDossier {
  schemaVersion: typeof MATCH_DOSSIER_SCHEMA_VERSION;
  fixture: MatchDossierFixtureRef;
  builtAt: string;
  builderVersion: string;
  scheduleReason: "interval-6h" | "pre-kickoff-90m" | "on-demand" | "manual";

  table: {
    home: ProvenanceField<{ position: number | null; points: number | null; goalDifference: number | null }>;
    away: ProvenanceField<{ position: number | null; points: number | null; goalDifference: number | null }>;
  };

  form: {
    homeLast5: ProvenanceField<FormWindow>;
    awayLast5: ProvenanceField<FormWindow>;
    homeLast10: ProvenanceField<FormWindow>;
    awayLast10: ProvenanceField<FormWindow>;
  };

  splits: {
    home: ProvenanceField<HomeAwaySplit>;
    away: ProvenanceField<HomeAwaySplit>;
  };

  rest: ProvenanceField<RestCongestion>;

  headToHead: ProvenanceField<{
    meetings: HeadToHeadMeeting[];
    homeWins: number;
    draws: number;
    awayWins: number;
  }>;

  /** Rolling xG from third-party feeds — empty in Phase 1 unless evidence items cite it. */
  rollingXg: ProvenanceField<{
    homeXgPerGame: number | null;
    homeXgaPerGame: number | null;
    awayXgPerGame: number | null;
    awayXgaPerGame: number | null;
  } | null>;

  injuries: ProvenanceField<{ items: DossierEvidenceItem[] }>;
  lineups: ProvenanceField<{ items: DossierEvidenceItem[] }>;
  manager: ProvenanceField<{
    home: { name: string | null; tenureNote: string | null };
    away: { name: string | null; tenureNote: string | null };
  }>;

  model: ProvenanceField<{
    pHome: number;
    pDraw: number;
    pAway: number;
    pOver2_5: number;
    pBttsYes: number;
    factorBreakdown: ModelFactorBreakdown;
  }>;

  /** Reference-only market rows; never model inputs. */
  market: ProvenanceField<{ rows: MarketSnapshotRow[] }>;

  evidence: DossierEvidenceItem[];

  /** Fields eligible for future calibration-track features (not active model inputs). */
  featureCandidates: Array<{
    fieldPath: string;
    factorId: ModelFactorId;
    note: string;
  }>;
}

export interface BuildDossierOptions {
  scheduleReason?: MatchDossier["scheduleReason"];
  now?: Date;
}

export interface DossierBuildWindow {
  kickoffFromInclusive: string;
  kickoffToExclusive: string;
}
