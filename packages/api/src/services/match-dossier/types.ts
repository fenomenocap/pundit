import type { EvidenceTier } from "../evidence-authority";
import type { DataTrustTier } from "../data-layer/types";
import type { ResultMark } from "../club-form";

export const MATCH_DOSSIER_SCHEMA_VERSION = 2 as const;

/** Trust tier for dossier fields — extends evidence tiers with server-owned spines. */
export type DossierTrustTier = DataTrustTier | "interim-spine";

/** ESPN and other spines with unresolved automated-use terms carry interim role. */
export type DossierSourceRole = "approved" | "interim" | "reference-only";

export interface DossierProvenance {
  sourceId: string;
  label: string;
  trustTier: DossierTrustTier;
  asOf: string;
  url?: string;
  sourceRole?: DossierSourceRole;
}

export type DossierEvidenceCategory =
  | "injuries"
  | "rotation"
  | "manager"
  | "motivation"
  | "tactics"
  | "travel-congestion";

export type DossierEvidenceVerification = "cited" | "unverified" | "page-verified";

export type DossierEvidenceTrustTier = EvidenceTier | "interim";

export interface DossierEvidenceItem {
  id: string;
  claim: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string | null;
  retrievedAt: string;
  trustTier: DossierEvidenceTrustTier;
  verification: DossierEvidenceVerification;
  direction: EvidenceDirection;
  relatedFactor: ModelFactorId;
  category: DossierEvidenceCategory;
  origin: "scheduled" | "on-demand";
  /** Optional snippet for audit; not shown in chat without citation contract. */
  snippet?: string;
  /** SHA-256 of normalized page excerpt when verification is page-verified. */
  contentSha256?: string;
  publishedAtSource?: "search-result" | "json-ld-datePublished" | "meta-article-published-time" | "meta-pubdate" | "meta-itemprop-datePublished" | "time-datetime";
  /** Take v2 (#341): fixture pairing / foreign-club gate passed before promotion. */
  fixtureMatchVerified?: boolean;
  /** Take v2 (#341): current season + category recency (and stale preview) gates passed. */
  freshnessVerified?: boolean;
  /** Provenance id for non-search sources (e.g. fpl-bootstrap-static). */
  source?: string;
  /** Internal-only rows (FPL interim) — excluded from take v2 and public dossier API. */
  internalOnly?: boolean;
}

/** Evidence eligible for desk take v2 (#341 @ccd8b9a). */
export function isTakeV2DossierEvidence(item: DossierEvidenceItem): boolean {
  if (item.internalOnly) return false;
  return item.verification === "page-verified"
    && item.fixtureMatchVerified === true
    && item.freshnessVerified === true;
}

export interface DossierEvidenceDroppedItem {
  sourceUrl: string;
  claim: string;
  reason: string;
  category: DossierEvidenceCategory;
  query: string;
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
  /** Public fixture probabilities (rounded), same as /api/model. */
  shipped: { pHome: number; pDraw: number; pAway: number };
  /** Full-precision output of getResolvedActiveScoreModel before display rounding. */
  pricingExact: { pHome: number; pDraw: number; pAway: number };
  /** Symmetric equal-strength neutral-venue counterfactual. */
  baseline: { pHome: number; pDraw: number; pAway: number };
  counterfactualSteps: ModelFactorContribution[];
  reconciliation: {
    deltaPHomePctSum: number;
    expectedDeltaPHomePct: number;
    deltaPHomePctResidual: number;
  };
  eloGapRaw: number;
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

  /** Evidence candidates rejected by the verifier (visible on /api/match-dossier). */
  dropped: DossierEvidenceDroppedItem[];

  evidenceBuild?: {
    replayId: string | null;
    captureId: string | null;
    queryCount: number;
    resultCount: number;
    droppedCount: number;
    verifiedCount?: number;
  };

  /** Fields eligible for future calibration-track features (not active model inputs). */
  featureCandidates: Array<{
    fieldPath: string;
    factorId: ModelFactorId;
    note: string;
  }>;
}

export interface DossierEvidenceBuildMeta {
  items: DossierEvidenceItem[];
  dropped: DossierEvidenceDroppedItem[];
  droppedCount: number;
  queryCount: number;
  replayId: string | null;
  captureId?: string | null;
  syntheticReplayBlocked?: boolean;
}

export interface BuildDossierOptions {
  scheduleReason?: MatchDossier["scheduleReason"];
  now?: Date;
  evidence?: DossierEvidenceBuildMeta;
}

export interface DossierBuildWindow {
  kickoffFromInclusive: string;
  kickoffToExclusive: string;
}

/** Strip internal-only evidence before public `/api/match-dossier` responses. */
export function publicMatchDossierView(dossier: MatchDossier): MatchDossier {
  const strip = (items: DossierEvidenceItem[]) => items.filter((item) => !item.internalOnly);
  return {
    ...dossier,
    evidence: strip(dossier.evidence),
    injuries: {
      ...dossier.injuries,
      value: { items: strip(dossier.injuries.value.items) },
    },
    lineups: {
      ...dossier.lineups,
      value: { items: strip(dossier.lineups.value.items) },
    },
  };
}
