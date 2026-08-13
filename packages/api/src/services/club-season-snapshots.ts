import fs from "node:fs";
import path from "node:path";
import type { ModelFixture } from "./model-data";
import type { FootballMatch } from "./football-data";
import { computeEvaluationMetrics, EvaluationFixture, EvaluationMetrics } from "./wc-evaluation";
import {
  ELO_CHAMPION,
  ELO_CHAMPION_CONFIG,
  PUNDIT_FUNDAMENTAL_MODEL_ID,
  PUNDIT_FUNDAMENTAL_MODEL_VERSION,
} from "./model-contributors";
import {
  readJsonFile,
  resolveDataPath,
  resolveRepoDataPath,
  writeJsonFileAtomic,
} from "./persistent-store";

export type ClubSeasonSnapshotMethod = "snapshot";
export type MarketSource = "stake" | "polymarket" | "kalshi";

export const CLUB_SEASON_LEDGER_SCHEMA_VERSION = 2;
export const PRE_KICKOFF_CHECKPOINT_POLICY_ID = "pre-kickoff-90m-v1";
export const PRE_KICKOFF_CHECKPOINT_WINDOW_MS = 90 * 60 * 1000;

export interface MarketComparisonObservation {
  source: MarketSource;
  sourceTimestamp: string;
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface ClubSeasonSnapshotFixture {
  schemaVersion: 1 | 2;
  forecastId: string;
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  date: string;
  stage: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  snapshottedAt: string;
  forecastAt: string;
  checkpointPolicyId: string;
  checkpointReason: "scheduled_window" | "pre_kickoff_cached_fallback" | "legacy_transition";
  modelId: string;
  modelVersion: string;
  contributorId: string;
  contributorVersion: string;
  methodId: string;
  provenanceCompleteness: "complete" | "source_partial" | "legacy_partial";
  inputs: {
    ratingProfile: string | null;
    homeRating: number;
    awayRating: number;
    ratingSnapshotAt: string | null;
    ratingAgeMinutes: number | null;
    ratingSourceState: "live" | "artifact" | "persisted" | "unknown";
    ratingArtifactId?: string;
    ratingArtifactSha256?: string;
    homeAdvantageElo: number | null;
    config: typeof ELO_CHAMPION_CONFIG | null;
  };
  marketComparisons: MarketComparisonObservation[];
  result: {
    homeScore: number;
    awayScore: number;
    winner: "home" | "away" | "draw";
  } | null;
  method: ClubSeasonSnapshotMethod;
}

export interface MissedForecastCheckpoint {
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  home: string;
  away: string;
  checkpointPolicyId: string;
  recordedAt: string;
  reason: "fixture_unpriced" | "no_eligible_pre_kickoff_forecast";
}

export interface EvaluationSegment {
  modelId: string;
  modelVersion: string;
  contributorId: string;
  contributorVersion: string;
  competitionId: string;
  seasonId: string;
  checkpointPolicyId: string;
  ratingSourceState: string;
  sampleCount: number;
  metrics: EvaluationMetrics;
}

export interface ClubSeasonEvaluationArtifact {
  schemaVersion: 2;
  competitions: string[];
  method: ClubSeasonSnapshotMethod;
  builtAt: string;
  updatedAt: string;
  disclaimer: string;
  fixtures: ClubSeasonSnapshotFixture[];
  missedCheckpoints: MissedForecastCheckpoint[];
  metrics: EvaluationMetrics;
  evaluation: {
    metricVersion: "multiclass-v1";
    segments: EvaluationSegment[];
    exclusions: {
      total: number;
      byReason: {
        legacyPartialProvenance: number;
        incompleteInputProvenance: number;
        postKickoffForecast: number;
        invalidForecastTimestamp: number;
      };
    };
  };
}

type LegacyArtifact = Partial<Omit<ClubSeasonEvaluationArtifact, "fixtures">> & {
  fixtures?: Array<Partial<ClubSeasonSnapshotFixture> & {
    competitionId: string;
    fixtureId: number;
    utcDate: string;
    date: string;
    stage: string;
    home: string;
    away: string;
    homeElo: number;
    awayElo: number;
    pHome: number;
    pDraw: number;
    pAway: number;
    pOver2_5: number;
    pUnder2_5: number;
    pBttsYes: number;
    pBttsNo: number;
    snapshottedAt: string;
  }>;
};

// This history accumulates irreplaceable pre-kickoff evidence on the mounted
// volume. Deploys replace the container image, never this path.
const ARTIFACT_RELATIVE_PATH = "evaluation/club-season.json";

const DEFAULT_DISCLAIMER = "Immutable pre-kickoff Pundit Fundamental forecasts captured by a "
  + "deterministic checkpoint policy. Market rows are timestamped comparison evidence, not inputs.";

function actualOutcome(homeScore: number, awayScore: number): "home" | "away" | "draw" {
  if (homeScore > awayScore) return "home";
  if (homeScore < awayScore) return "away";
  return "draw";
}

function predictedOutcome(pHome: number, pDraw: number, pAway: number): "home" | "away" | "draw" {
  if (pHome >= pDraw && pHome >= pAway) return "home";
  if (pDraw >= pHome && pDraw >= pAway) return "draw";
  return "away";
}

function fixtureKey(competitionId: string, fixtureId: number): string {
  return `${competitionId}:${fixtureId}`;
}

function forecastIdentity(fixture: ModelFixture): string {
  const provenance = fixture.forecastProvenance;
  const contributor = provenance?.contributorId ?? ELO_CHAMPION.id;
  const version = provenance?.contributorVersion ?? ELO_CHAMPION.version;
  return `${fixture.competitionId}:${fixture.fixtureId}:${contributor}@${version}:`
    + PRE_KICKOFF_CHECKPOINT_POLICY_ID;
}

type OfficialExclusionReason = "legacyPartialProvenance" | "incompleteInputProvenance"
  | "postKickoffForecast"
  | "invalidForecastTimestamp";

function validArtifactInputProvenance(inputs: ClubSeasonSnapshotFixture["inputs"]): boolean {
  if (inputs.ratingSourceState !== "artifact") return true;
  const sha = inputs.ratingArtifactSha256;
  return typeof sha === "string"
    && /^[a-f0-9]{64}$/.test(sha)
    && inputs.ratingArtifactId === `clubelo@1:${sha}`;
}

function officialExclusionReason(fixture: ClubSeasonSnapshotFixture): OfficialExclusionReason | null {
  if (fixture.provenanceCompleteness !== "complete" || fixture.schemaVersion !== 2) {
    return fixture.provenanceCompleteness === "legacy_partial" || fixture.schemaVersion !== 2
      ? "legacyPartialProvenance"
      : "incompleteInputProvenance";
  }
  if (!fixture.inputs.ratingSnapshotAt || fixture.inputs.ratingSourceState === "unknown"
    || fixture.inputs.config === null || fixture.inputs.homeAdvantageElo === null
    || !validArtifactInputProvenance(fixture.inputs)) {
    return "incompleteInputProvenance";
  }
  const forecastAt = Date.parse(fixture.forecastAt);
  const kickoff = Date.parse(fixture.utcDate);
  if (!Number.isFinite(forecastAt) || !Number.isFinite(kickoff)) {
    return "invalidForecastTimestamp";
  }
  return forecastAt >= kickoff ? "postKickoffForecast" : null;
}

function seasonId(utcDate: string): string {
  const date = new Date(utcDate);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6 ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function toEvaluationFixture(snapshot: ClubSeasonSnapshotFixture): EvaluationFixture | null {
  if (!snapshot.result) return null;
  return {
    id: snapshot.fixtureId,
    utcDate: snapshot.utcDate,
    stage: snapshot.stage,
    group: null,
    home: snapshot.home,
    away: snapshot.away,
    homeElo: snapshot.homeElo,
    awayElo: snapshot.awayElo,
    pHome: snapshot.pHome,
    pDraw: snapshot.pDraw,
    pAway: snapshot.pAway,
    pOver2_5: snapshot.pOver2_5,
    pUnder2_5: snapshot.pUnder2_5,
    pBttsYes: snapshot.pBttsYes,
    pBttsNo: snapshot.pBttsNo,
    result: snapshot.result,
    predictedOutcome: predictedOutcome(snapshot.pHome, snapshot.pDraw, snapshot.pAway),
    method: "snapshot",
  };
}

function computeArtifactMetrics(fixtures: ClubSeasonSnapshotFixture[]): EvaluationMetrics {
  return computeEvaluationMetrics(
    fixtures
      .filter((fixture) => officialExclusionReason(fixture) === null)
      .map(toEvaluationFixture)
      .filter((fixture): fixture is EvaluationFixture => fixture !== null)
  );
}

function computeSegments(fixtures: ClubSeasonSnapshotFixture[]): EvaluationSegment[] {
  const groups = new Map<string, ClubSeasonSnapshotFixture[]>();
  for (const fixture of fixtures) {
    if (!fixture.result || officialExclusionReason(fixture) !== null) continue;
    const sourceState = fixture.inputs.ratingSourceState;
    const key = [
      fixture.modelId,
      fixture.modelVersion,
      fixture.contributorId,
      fixture.contributorVersion,
      fixture.competitionId,
      seasonId(fixture.utcDate),
      fixture.checkpointPolicyId,
      sourceState,
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(fixture);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const metrics = computeArtifactMetrics(group);
    return {
      modelId: first.modelId,
      modelVersion: first.modelVersion,
      contributorId: first.contributorId,
      contributorVersion: first.contributorVersion,
      competitionId: first.competitionId,
      seasonId: seasonId(first.utcDate),
      checkpointPolicyId: first.checkpointPolicyId,
      ratingSourceState: first.inputs.ratingSourceState,
      sampleCount: metrics.fixtureCount,
      metrics,
    };
  }).sort((a, b) => [a.modelId, a.modelVersion, a.competitionId, a.ratingSourceState].join("|")
    .localeCompare([b.modelId, b.modelVersion, b.competitionId, b.ratingSourceState].join("|")));
}

function withComputedEvaluation(
  artifact: Omit<ClubSeasonEvaluationArtifact, "metrics" | "evaluation">
): ClubSeasonEvaluationArtifact {
  const exclusions = {
    legacyPartialProvenance: 0,
    incompleteInputProvenance: 0,
    postKickoffForecast: 0,
    invalidForecastTimestamp: 0,
  };
  for (const fixture of artifact.fixtures) {
    const reason = officialExclusionReason(fixture);
    if (reason) exclusions[reason] += 1;
  }
  return {
    ...artifact,
    metrics: computeArtifactMetrics(artifact.fixtures),
    evaluation: {
      metricVersion: "multiclass-v1",
      segments: computeSegments(artifact.fixtures),
      exclusions: {
        total: Object.values(exclusions).reduce((sum, count) => sum + count, 0),
        byReason: exclusions,
      },
    },
  };
}

function emptyArtifact(now = new Date().toISOString()): ClubSeasonEvaluationArtifact {
  return withComputedEvaluation({
    schemaVersion: CLUB_SEASON_LEDGER_SCHEMA_VERSION,
    competitions: ["eng.1", "uefa.champions_qual"],
    method: "snapshot",
    builtAt: now,
    updatedAt: now,
    disclaimer: DEFAULT_DISCLAIMER,
    fixtures: [],
    missedCheckpoints: [],
  });
}

function migrateFixture(fixture: LegacyArtifact["fixtures"] extends Array<infer T> | undefined ? T : never): ClubSeasonSnapshotFixture {
  if (fixture.schemaVersion === 2 && fixture.forecastId && fixture.inputs) {
    return {
      ...fixture,
      schemaVersion: 2,
      marketComparisons: fixture.marketComparisons ?? [],
    } as ClubSeasonSnapshotFixture;
  }
  const snapshotAt = fixture.snapshottedAt;
  return {
    ...fixture,
    schemaVersion: 1,
    forecastId: `legacy:${fixture.competitionId}:${fixture.fixtureId}:${snapshotAt}`,
    forecastAt: snapshotAt,
    checkpointPolicyId: "legacy-transition-v0",
    checkpointReason: "legacy_transition",
    modelId: PUNDIT_FUNDAMENTAL_MODEL_ID,
    modelVersion: "legacy-unversioned",
    contributorId: ELO_CHAMPION.id,
    contributorVersion: "legacy-unversioned",
    methodId: ELO_CHAMPION.methodId,
    provenanceCompleteness: "legacy_partial",
    inputs: {
      ratingProfile: null,
      homeRating: fixture.homeElo,
      awayRating: fixture.awayElo,
      ratingSnapshotAt: null,
      ratingAgeMinutes: null,
      ratingSourceState: "unknown",
      homeAdvantageElo: null,
      config: null,
    },
    marketComparisons: [],
    result: fixture.result ?? null,
    method: "snapshot",
  } as ClubSeasonSnapshotFixture;
}

export function migrateClubSeasonEvaluationArtifact(
  parsed: LegacyArtifact | null
): ClubSeasonEvaluationArtifact {
  if (!parsed) return emptyArtifact();
  const fixtures = (parsed.fixtures ?? []).map(migrateFixture)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  return withComputedEvaluation({
    schemaVersion: CLUB_SEASON_LEDGER_SCHEMA_VERSION,
    competitions: parsed.competitions ?? ["eng.1", "uefa.champions_qual"],
    method: "snapshot",
    builtAt: parsed.builtAt ?? new Date().toISOString(),
    updatedAt: parsed.updatedAt ?? parsed.builtAt ?? new Date().toISOString(),
    disclaimer: DEFAULT_DISCLAIMER,
    fixtures,
    missedCheckpoints: parsed.missedCheckpoints ?? [],
  });
}

export function getClubSeasonEvaluationArtifactPath(): string {
  return resolveDataPath(ARTIFACT_RELATIVE_PATH);
}

export function loadClubSeasonEvaluationArtifact(): ClubSeasonEvaluationArtifact {
  const parsed = readJsonFile<LegacyArtifact>(getClubSeasonEvaluationArtifactPath())
    ?? readJsonFile<LegacyArtifact>(resolveRepoDataPath(ARTIFACT_RELATIVE_PATH));
  return migrateClubSeasonEvaluationArtifact(parsed);
}

export function buildSnapshotFromModel(
  fixture: ModelFixture,
  snapshottedAt: string,
  checkpointReason: ClubSeasonSnapshotFixture["checkpointReason"] = "scheduled_window",
  marketComparisons: MarketComparisonObservation[] = []
): ClubSeasonSnapshotFixture {
  const provenance = fixture.forecastProvenance;
  const forecastAt = provenance?.forecastAt ?? snapshottedAt;
  return {
    schemaVersion: CLUB_SEASON_LEDGER_SCHEMA_VERSION,
    forecastId: forecastIdentity(fixture),
    competitionId: fixture.competitionId,
    fixtureId: fixture.fixtureId,
    utcDate: fixture.utcDate,
    date: fixture.date,
    stage: fixture.stage,
    home: fixture.home,
    away: fixture.away,
    homeElo: fixture.homeElo,
    awayElo: fixture.awayElo,
    pHome: fixture.pHome,
    pDraw: fixture.pDraw,
    pAway: fixture.pAway,
    pOver2_5: fixture.pOver2_5,
    pUnder2_5: fixture.pUnder2_5,
    pBttsYes: fixture.pBttsYes,
    pBttsNo: fixture.pBttsNo,
    snapshottedAt,
    forecastAt,
    checkpointPolicyId: PRE_KICKOFF_CHECKPOINT_POLICY_ID,
    checkpointReason,
    modelId: provenance?.modelId ?? PUNDIT_FUNDAMENTAL_MODEL_ID,
    modelVersion: provenance?.modelVersion ?? PUNDIT_FUNDAMENTAL_MODEL_VERSION,
    contributorId: provenance?.contributorId ?? ELO_CHAMPION.id,
    contributorVersion: provenance?.contributorVersion ?? ELO_CHAMPION.version,
    methodId: provenance?.methodId ?? ELO_CHAMPION.methodId,
    provenanceCompleteness: !provenance
      ? "legacy_partial"
      : provenance.ratingSnapshotAt && provenance.ratingSourceState !== "unknown"
        && validArtifactInputProvenance({
          ratingProfile: provenance.ratingProfile,
          homeRating: fixture.homeElo,
          awayRating: fixture.awayElo,
          ratingSnapshotAt: provenance.ratingSnapshotAt,
          ratingAgeMinutes: provenance.ratingAgeMinutes,
          ratingSourceState: provenance.ratingSourceState,
          ratingArtifactId: provenance.ratingArtifactId,
          ratingArtifactSha256: provenance.ratingArtifactSha256,
          homeAdvantageElo: provenance.homeAdvantageElo,
          config: provenance.config,
        })
        ? "complete"
        : "source_partial",
    inputs: {
      ratingProfile: provenance?.ratingProfile ?? null,
      homeRating: fixture.homeElo,
      awayRating: fixture.awayElo,
      ratingSnapshotAt: provenance?.ratingSnapshotAt ?? null,
      ratingAgeMinutes: provenance?.ratingAgeMinutes ?? null,
      ratingSourceState: provenance?.ratingSourceState ?? "unknown",
      ...(provenance?.ratingArtifactId ? { ratingArtifactId: provenance.ratingArtifactId } : {}),
      ...(provenance?.ratingArtifactSha256
        ? { ratingArtifactSha256: provenance.ratingArtifactSha256 }
        : {}),
      homeAdvantageElo: provenance?.homeAdvantageElo ?? null,
      config: provenance?.config ?? null,
    },
    marketComparisons: [...marketComparisons],
    result: fixture.result
      ? {
          homeScore: fixture.result.homeScore,
          awayScore: fixture.result.awayScore,
          winner: actualOutcome(fixture.result.homeScore, fixture.result.awayScore),
        }
      : null,
    method: "snapshot",
  };
}

export interface SnapshotTransitionInput {
  previousStatusByKey: Map<string, string>;
  lastScheduledModelByKey: Map<string, ModelFixture>;
  currentMatches: FootballMatch[];
  modelFixtures: ModelFixture[];
  now?: Date;
}

function isEligibleForecast(fixture: ModelFixture, now: Date): boolean {
  const kickoff = Date.parse(fixture.utcDate);
  const forecastAt = Date.parse(fixture.forecastProvenance?.forecastAt ?? now.toISOString());
  const untilKickoff = kickoff - now.getTime();
  return Number.isFinite(kickoff)
    && Number.isFinite(forecastAt)
    && forecastAt < kickoff
    && untilKickoff > 0
    && untilKickoff <= PRE_KICKOFF_CHECKPOINT_WINDOW_MS;
}

function isEligibleCachedFallback(fixture: ModelFixture): boolean {
  const kickoff = Date.parse(fixture.utcDate);
  const forecastAt = Date.parse(fixture.forecastProvenance?.forecastAt ?? "");
  return Number.isFinite(kickoff)
    && Number.isFinite(forecastAt)
    && forecastAt < kickoff
    && kickoff - forecastAt <= PRE_KICKOFF_CHECKPOINT_WINDOW_MS;
}

export function collectSnapshotTransitions(input: SnapshotTransitionInput): {
  keysToSnapshot: Set<string>;
  statusUpdates: Map<string, string>;
  snapshotModels: ModelFixture[];
  checkpointReasons: Map<string, ClubSeasonSnapshotFixture["checkpointReason"]>;
} {
  const now = input.now ?? new Date();
  const keysToSnapshot = new Set<string>();
  const statusUpdates = new Map<string, string>();
  const snapshotModels: ModelFixture[] = [];
  const checkpointReasons = new Map<string, ClubSeasonSnapshotFixture["checkpointReason"]>();
  const modelByKey = new Map(
    input.modelFixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );

  for (const match of input.currentMatches) {
    const key = fixtureKey(match.competitionId, match.id);
    const previousStatus = input.previousStatusByKey.get(key);
    statusUpdates.set(key, match.status);
    const current = modelByKey.get(key);

    if (match.status === "SCHEDULED" && current && isEligibleForecast(current, now)) {
      keysToSnapshot.add(key);
      snapshotModels.push(current);
      checkpointReasons.set(key, "scheduled_window");
      continue;
    }

    const transitioned = previousStatus === "SCHEDULED"
      && (match.status === "IN_PLAY" || match.status === "FINISHED");
    if (!transitioned) continue;
    const cached = current ?? input.lastScheduledModelByKey.get(key);
    if (cached && isEligibleCachedFallback(cached)) {
      keysToSnapshot.add(key);
      snapshotModels.push(cached);
      checkpointReasons.set(key, "pre_kickoff_cached_fallback");
    }
  }

  return { keysToSnapshot, statusUpdates, snapshotModels, checkpointReasons };
}

export function mergeSnapshots(
  artifact: ClubSeasonEvaluationArtifact,
  modelFixtures: ModelFixture[],
  keysToSnapshot: Set<string>,
  snapshottedAt: string,
  checkpointReasons: Map<string, ClubSeasonSnapshotFixture["checkpointReason"]> = new Map()
): ClubSeasonEvaluationArtifact {
  const fixtures = [...artifact.fixtures];
  const forecastIds = new Set(fixtures.map((fixture) => fixture.forecastId));
  for (const modelFixture of modelFixtures) {
    const key = fixtureKey(modelFixture.competitionId, modelFixture.fixtureId);
    if (!keysToSnapshot.has(key)) continue;
    const snapshot = buildSnapshotFromModel(
      modelFixture,
      snapshottedAt,
      checkpointReasons.get(key) ?? "scheduled_window"
    );
    // Identity deliberately excludes refresh time. Repeated refreshes of the
    // same contributor/checkpoint are idempotent, while another contributor or
    // checkpoint policy can append its own immutable row for the fixture.
    if (forecastIds.has(snapshot.forecastId)) continue;
    forecastIds.add(snapshot.forecastId);
    fixtures.push(snapshot);
  }

  fixtures.sort((a, b) => a.utcDate.localeCompare(b.utcDate)
    || a.forecastId.localeCompare(b.forecastId));
  return withComputedEvaluation({
    ...artifact,
    updatedAt: snapshottedAt,
    fixtures,
  });
}

export function persistClubSeasonEvaluationArtifact(artifact: ClubSeasonEvaluationArtifact): void {
  backupLegacyClubSeasonArtifact();
  writeJsonFileAtomic(getClubSeasonEvaluationArtifactPath(), withComputedEvaluation({
    ...artifact,
    schemaVersion: CLUB_SEASON_LEDGER_SCHEMA_VERSION,
  }));
}

/**
 * Preserve the exact durable schema-v1 bytes before the first schema-v2 write.
 * This is intentionally local to the configured PUNDIT_DATA_DIR target: a
 * checked-in seed artifact is never presented as a production backup.
 */
export function backupLegacyClubSeasonArtifact(now = new Date()): string | null {
  const target = getClubSeasonEvaluationArtifactPath();
  if (!fs.existsSync(target)) return null;
  const parsed = readJsonFile<{ schemaVersion?: number }>(target);
  if (parsed?.schemaVersion === CLUB_SEASON_LEDGER_SCHEMA_VERSION) return null;
  const stamp = now.toISOString().replaceAll(":", "-");
  const backup = path.join(path.dirname(target), `club-season.json.backup-${stamp}`);
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

let previousStatusByKey = new Map<string, string>();
let lastScheduledModelByKey = new Map<string, ModelFixture>();

export function resetClubSeasonSnapshotState(): void {
  previousStatusByKey = new Map();
  lastScheduledModelByKey = new Map();
}

export function updateClubSeasonSnapshots(
  currentMatches: FootballMatch[],
  modelFixtures: ModelFixture[],
  now = new Date()
): ClubSeasonEvaluationArtifact {
  const snapshottedAt = now.toISOString();
  const priorStatuses = previousStatusByKey;
  const { keysToSnapshot, statusUpdates, snapshotModels, checkpointReasons } = collectSnapshotTransitions({
    previousStatusByKey,
    lastScheduledModelByKey,
    currentMatches,
    modelFixtures,
    now,
  });
  previousStatusByKey = statusUpdates;

  const modelByKey = new Map(
    modelFixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );
  for (const match of currentMatches) {
    if (match.status !== "SCHEDULED") continue;
    const key = fixtureKey(match.competitionId, match.id);
    const modelFixture = modelByKey.get(key);
    if (modelFixture) lastScheduledModelByKey.set(key, modelFixture);
  }

  let artifact = loadClubSeasonEvaluationArtifact();
  let shouldPersist = false;
  const beforeCount = artifact.fixtures.length;
  if (keysToSnapshot.size > 0) {
    artifact = mergeSnapshots(
      artifact,
      snapshotModels,
      keysToSnapshot,
      snapshottedAt,
      checkpointReasons
    );
    shouldPersist = artifact.fixtures.length > beforeCount;
  }

  let fixturesWithEvidence = artifact.fixtures;
  let evidenceUpdated = false;
  for (const match of currentMatches) {
    const key = fixtureKey(match.competitionId, match.id);
    const matching = fixturesWithEvidence.filter(
      (fixture) => fixtureKey(fixture.competitionId, fixture.fixtureId) === key
    );
    if (match.status === "FINISHED"
      && match.score?.home !== null
      && match.score?.away !== null
      && matching.some((fixture) => !fixture.result)) {
      fixturesWithEvidence = fixturesWithEvidence.map((fixture) =>
        fixtureKey(fixture.competitionId, fixture.fixtureId) !== key || fixture.result
          ? fixture
          : {
              ...fixture,
              result: {
                homeScore: match.score!.home!,
                awayScore: match.score!.away!,
                winner: actualOutcome(match.score!.home!, match.score!.away!),
              },
            }
      );
      evidenceUpdated = true;
    }

    const transitionedPastKickoff = priorStatuses.get(key) === "SCHEDULED"
      && (match.status === "IN_PLAY" || match.status === "FINISHED");
    const kickoff = Date.parse(match.utcDate);
    const directlyObservedPastKickoff = (match.status === "IN_PLAY" || match.status === "FINISHED")
      && Number.isFinite(kickoff)
      && now.getTime() >= kickoff;
    // The absence of an in-memory SCHEDULED state after a restart must not make
    // a missed checkpoint disappear. A direct post-kickoff observation with no
    // sealed row is durable evidence that this policy did not capture one.
    if (matching.length === 0
      && (transitionedPastKickoff || directlyObservedPastKickoff)
      && !keysToSnapshot.has(key)) {
      const alreadyRecorded = artifact.missedCheckpoints.some(
        (entry) => fixtureKey(entry.competitionId, entry.fixtureId) === key
      );
      if (!alreadyRecorded) {
        artifact.missedCheckpoints.push({
          competitionId: match.competitionId,
          fixtureId: match.id,
          utcDate: match.utcDate,
          home: match.homeTeam,
          away: match.awayTeam,
          checkpointPolicyId: PRE_KICKOFF_CHECKPOINT_POLICY_ID,
          recordedAt: snapshottedAt,
          reason: transitionedPastKickoff && !lastScheduledModelByKey.has(key)
            ? "fixture_unpriced"
            : lastScheduledModelByKey.has(key)
            ? "no_eligible_pre_kickoff_forecast"
            : "no_eligible_pre_kickoff_forecast",
        });
        evidenceUpdated = true;
      }
    }
  }

  if (evidenceUpdated) {
    artifact = withComputedEvaluation({
      ...artifact,
      updatedAt: snapshottedAt,
      fixtures: [...fixturesWithEvidence].sort((a, b) => a.utcDate.localeCompare(b.utcDate)
        || a.forecastId.localeCompare(b.forecastId)),
    });
    shouldPersist = true;
  }

  if (shouldPersist) {
    persistClubSeasonEvaluationArtifact(artifact);
    const captured = artifact.fixtures.length - beforeCount;
    if (captured > 0) {
      console.log(`[ClubSeason] Sealed ${captured} forecast(s). Total: ${artifact.fixtures.length}.`);
    }
  }
  return artifact;
}

export function appendMarketComparisons(
  comparisonsByFixture: Map<string, MarketComparisonObservation[]>,
  now = new Date()
): ClubSeasonEvaluationArtifact {
  let artifact = loadClubSeasonEvaluationArtifact();
  let changed = false;
  const fixtures = artifact.fixtures.map((fixture) => {
    if (now.getTime() >= Date.parse(fixture.utcDate)) return fixture;
    const incoming = comparisonsByFixture.get(fixtureKey(fixture.competitionId, fixture.fixtureId)) ?? [];
    if (incoming.length === 0) return fixture;
    const identities = new Set(fixture.marketComparisons.map((row) =>
      `${row.source}:${row.sourceTimestamp}:${row.pHome}:${row.pDraw}:${row.pAway}`
    ));
    const additions = incoming.filter((row) => !identities.has(
      `${row.source}:${row.sourceTimestamp}:${row.pHome}:${row.pDraw}:${row.pAway}`
    ));
    if (additions.length === 0) return fixture;
    changed = true;
    return { ...fixture, marketComparisons: [...fixture.marketComparisons, ...additions] };
  });
  if (changed) {
    artifact = withComputedEvaluation({ ...artifact, updatedAt: now.toISOString(), fixtures });
    persistClubSeasonEvaluationArtifact(artifact);
  }
  return artifact;
}

export function seedClubSeasonSnapshotState(
  matches: FootballMatch[],
  fixtures: ModelFixture[],
  snapshottedAt: string
): ClubSeasonEvaluationArtifact {
  previousStatusByKey = new Map(
    matches.map((match) => [fixtureKey(match.competitionId, match.id), match.status])
  );
  lastScheduledModelByKey = new Map(
    fixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );
  const keys = new Set(fixtures.map((fixture) => fixtureKey(fixture.competitionId, fixture.fixtureId)));
  return mergeSnapshots(emptyArtifact(snapshottedAt), fixtures, keys, snapshottedAt);
}
