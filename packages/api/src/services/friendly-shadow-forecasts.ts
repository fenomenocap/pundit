import { createHash } from "node:crypto";
import fs from "node:fs";
import { computeMatchModel } from "./dixon-coles";
import type { RecognizedFixture } from "./fixture-registry";
import { readJsonFile, resolveDataPath, writeJsonFileAtomic } from "./persistent-store";

export const FRIENDLY_SHADOW_POLICY_ID = "club-friendly-shadow";
export const FRIENDLY_SHADOW_POLICY_VERSION = "1";
export const FRIENDLY_SHADOW_LEDGER_SCHEMA_VERSION = 1;
export const FRIENDLY_SHADOW_CHECKPOINT_ID = "pre-kickoff-shadow-v1";
export const FRIENDLY_SHADOW_MODEL_VERSION = "dixon-coles-club-v1";

const LEDGER_PATH = "evaluation/friendly-shadow-v1.json";
const UNCERTAINTY_SHRINKAGE = 0.2;

export interface FriendlyShadowContext {
  homeRating: number;
  awayRating: number;
  ratingSnapshotAt: string;
  expectedSquadEvidenceIds: string[];
  rotationAssessment: "low" | "medium" | "high";
  substitutionLimit: number;
  observedAt: string;
}

export type FriendlyShadowFailure =
  | "policy-disabled"
  | "not-club-friendly"
  | "fixture-not-authoritative"
  | "neutral-venue-unknown"
  | "ratings-unavailable"
  | "rotation-context-missing"
  | "substitution-format-missing"
  | "required-context-missing";

export interface FriendlyShadowForecast {
  schemaVersion: 1;
  forecastId: string;
  fixtureId: string;
  fixtureSource: RecognizedFixture["primarySource"];
  sourceFixtureId: string;
  kickoff: string;
  forecastAt: string;
  policyId: typeof FRIENDLY_SHADOW_POLICY_ID;
  policyVersion: typeof FRIENDLY_SHADOW_POLICY_VERSION;
  checkpointPolicyId: typeof FRIENDLY_SHADOW_CHECKPOINT_ID;
  visibility: "private-shadow";
  home: string;
  away: string;
  venue: string | null;
  neutralVenue: boolean;
  homeFieldAdvantageElo: 0;
  uncertaintyShrinkage: typeof UNCERTAINTY_SHRINKAGE;
  rotationAssessment: FriendlyShadowContext["rotationAssessment"];
  substitutionLimit: number;
  expectedSquadEvidenceIds: string[];
  ratingSnapshotAt: string;
  homeRating: number;
  awayRating: number;
  modelVersion: typeof FRIENDLY_SHADOW_MODEL_VERSION;
  pHome: number;
  pDraw: number;
  pAway: number;
  result: {
    homeScore: number;
    awayScore: number;
    observedAt: string;
    source: RecognizedFixture["primarySource"];
    sourceFixtureId: string;
    fixtureStatus: "finished";
  } | null;
}

export interface FriendlyShadowLedger {
  schemaVersion: 1;
  policyId: typeof FRIENDLY_SHADOW_POLICY_ID;
  policyVersion: typeof FRIENDLY_SHADOW_POLICY_VERSION;
  visibility: "private-shadow";
  updatedAt: string;
  forecasts: FriendlyShadowForecast[];
}

export type FriendlyShadowBuildResult =
  | { ok: true; forecast: FriendlyShadowForecast }
  | { ok: false; reason: FriendlyShadowFailure };

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function shrink(probability: number): number {
  return probability * (1 - UNCERTAINTY_SHRINKAGE) + (1 / 3) * UNCERTAINTY_SHRINKAGE;
}

function evidenceIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => /^S\d+$/.test(id)))].sort();
}

function forecastIdentity(fixture: RecognizedFixture): string {
  return createHash("sha256").update([
    fixture.fixtureId,
    fixture.kickoff,
    FRIENDLY_SHADOW_POLICY_ID,
    FRIENDLY_SHADOW_POLICY_VERSION,
    FRIENDLY_SHADOW_CHECKPOINT_ID,
  ].join("|")).digest("hex");
}

export function friendlyShadowEnabled(): boolean {
  return process.env.FRIENDLY_SHADOW_ENABLED === "true";
}

/**
 * Builds a private forecast only when every friendly-specific input is known.
 * The policy deliberately applies no home-field advantage and shrinks 1X2
 * probabilities toward one third. It is never registered as a public model.
 */
export function buildFriendlyShadowForecast(
  fixture: RecognizedFixture,
  context: FriendlyShadowContext,
  options: { enabled?: boolean } = {}
): FriendlyShadowBuildResult {
  if (!(options.enabled ?? friendlyShadowEnabled())) return { ok: false, reason: "policy-disabled" };
  if (fixture.competition.category !== "club-friendly") return { ok: false, reason: "not-club-friendly" };
  if (fixture.recognition !== "authoritative" && fixture.recognition !== "corroborated") {
    return { ok: false, reason: "fixture-not-authoritative" };
  }
  if (fixture.neutralVenue === null) return { ok: false, reason: "neutral-venue-unknown" };
  if (!Number.isFinite(context.homeRating) || !Number.isFinite(context.awayRating)) {
    return { ok: false, reason: "ratings-unavailable" };
  }
  const ids = evidenceIds(context.expectedSquadEvidenceIds);
  if (!ids.length) return { ok: false, reason: "rotation-context-missing" };
  if (!Number.isInteger(context.substitutionLimit) || context.substitutionLimit <= 0) {
    return { ok: false, reason: "substitution-format-missing" };
  }
  const forecastAt = new Date(context.observedAt);
  const ratingAt = new Date(context.ratingSnapshotAt);
  const kickoff = new Date(fixture.kickoff);
  if (![forecastAt, ratingAt, kickoff].every((date) => Number.isFinite(date.getTime()))
    || forecastAt >= kickoff || ratingAt > forecastAt) {
    return { ok: false, reason: "required-context-missing" };
  }
  const raw = computeMatchModel(context.homeRating, context.awayRating, 0);
  const probabilities = [shrink(raw.pHome), shrink(raw.pDraw), shrink(raw.pAway)];
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  const [pHome, pDraw, pAway] = probabilities.map((probability) => rounded(probability / total));
  return {
    ok: true,
    forecast: {
      schemaVersion: 1,
      forecastId: forecastIdentity(fixture),
      fixtureId: fixture.fixtureId,
      fixtureSource: fixture.primarySource,
      sourceFixtureId: fixture.primarySourceFixtureId,
      kickoff: kickoff.toISOString(),
      forecastAt: forecastAt.toISOString(),
      policyId: FRIENDLY_SHADOW_POLICY_ID,
      policyVersion: FRIENDLY_SHADOW_POLICY_VERSION,
      checkpointPolicyId: FRIENDLY_SHADOW_CHECKPOINT_ID,
      visibility: "private-shadow",
      home: fixture.homeTeam.name,
      away: fixture.awayTeam.name,
      venue: fixture.venue,
      neutralVenue: fixture.neutralVenue,
      homeFieldAdvantageElo: 0,
      uncertaintyShrinkage: UNCERTAINTY_SHRINKAGE,
      rotationAssessment: context.rotationAssessment,
      substitutionLimit: context.substitutionLimit,
      expectedSquadEvidenceIds: ids,
      ratingSnapshotAt: ratingAt.toISOString(),
      homeRating: context.homeRating,
      awayRating: context.awayRating,
      modelVersion: FRIENDLY_SHADOW_MODEL_VERSION,
      pHome,
      pDraw,
      pAway,
      result: null,
    },
  };
}

function emptyLedger(now: string): FriendlyShadowLedger {
  return {
    schemaVersion: 1,
    policyId: FRIENDLY_SHADOW_POLICY_ID,
    policyVersion: FRIENDLY_SHADOW_POLICY_VERSION,
    visibility: "private-shadow",
    updatedAt: now,
    forecasts: [],
  };
}

function validLedger(value: FriendlyShadowLedger | null): value is FriendlyShadowLedger {
  return value?.schemaVersion === 1
    && value.policyId === FRIENDLY_SHADOW_POLICY_ID
    && value.policyVersion === FRIENDLY_SHADOW_POLICY_VERSION
    && value.visibility === "private-shadow"
    && Array.isArray(value.forecasts)
    && value.forecasts.every((forecast) =>
      forecast?.schemaVersion === 1
      && typeof forecast.forecastId === "string"
      && typeof forecast.fixtureId === "string"
      && ["espn", "official-competition", "official-federation", "official-club"]
        .includes(forecast.fixtureSource)
      && typeof forecast.sourceFixtureId === "string"
      && forecast.sourceFixtureId.trim().length > 0
      && forecast.visibility === "private-shadow"
      && forecast.modelVersion === FRIENDLY_SHADOW_MODEL_VERSION
      && Number.isFinite(forecast.homeRating)
      && Number.isFinite(forecast.awayRating)
      && Number.isFinite(forecast.pHome)
      && Number.isFinite(forecast.pDraw)
      && Number.isFinite(forecast.pAway)
    );
}

function readLedger(now: string): FriendlyShadowLedger {
  const primaryPath = resolveDataPath(LEDGER_PATH);
  const primary = readJsonFile<FriendlyShadowLedger>(primaryPath);
  if (validLedger(primary)) return primary;
  const lastGood = readJsonFile<FriendlyShadowLedger>(`${primaryPath}.last-good`);
  if (validLedger(lastGood)) return lastGood;
  if (fs.existsSync(primaryPath) || fs.existsSync(`${primaryPath}.last-good`)) {
    throw new Error("Friendly shadow ledger and last-good copy are invalid");
  }
  return emptyLedger(now);
}

function writeLedger(ledger: FriendlyShadowLedger): void {
  const primaryPath = resolveDataPath(LEDGER_PATH);
  writeJsonFileAtomic(primaryPath, ledger);
  writeJsonFileAtomic(`${primaryPath}.last-good`, ledger);
}

function withLedgerLock<T>(operation: () => T): T {
  const lockPath = `${resolveDataPath(LEDGER_PATH)}.lock`;
  fs.mkdirSync(resolveDataPath("evaluation"), { recursive: true });
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch {
    throw new Error("Friendly shadow ledger is already being updated");
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

/** Same identity is idempotent; an existing forecast is never overwritten. */
export function appendFriendlyShadowForecast(
  forecast: FriendlyShadowForecast,
  now = new Date()
): { inserted: boolean; conflict: boolean; ledger: FriendlyShadowLedger } {
  return withLedgerLock(() => {
    const ledger = readLedger(now.toISOString());
    const checkpoint = ledger.forecasts.find((entry) =>
      entry.fixtureId === forecast.fixtureId
      && entry.policyVersion === forecast.policyVersion
      && entry.checkpointPolicyId === forecast.checkpointPolicyId
    );
    if (checkpoint) {
      return {
        inserted: false,
        conflict: JSON.stringify(checkpoint) !== JSON.stringify(forecast),
        ledger,
      };
    }
    const next = {
      ...ledger,
      updatedAt: now.toISOString(),
      forecasts: [...ledger.forecasts, forecast].sort((a, b) =>
        a.kickoff.localeCompare(b.kickoff) || a.forecastId.localeCompare(b.forecastId)
      ),
    };
    writeLedger(next);
    return { inserted: true, conflict: false, ledger: next };
  });
}

/** Results append to an immutable forecast row; probability and input fields survive byte-for-byte. */
export function appendFriendlyShadowResult(
  forecastId: string,
  result: NonNullable<FriendlyShadowForecast["result"]>,
  now = new Date()
): { updated: boolean; ledger: FriendlyShadowLedger } {
  return withLedgerLock(() => {
    const ledger = readLedger(now.toISOString());
    const observedAt = Date.parse(result.observedAt);
    if (!Number.isFinite(observedAt)
      || !Number.isInteger(result.homeScore)
      || !Number.isInteger(result.awayScore)
      || result.homeScore < 0
      || result.awayScore < 0
      || observedAt > now.getTime()
      || result.fixtureStatus !== "finished"
      || !result.source.trim()
      || !result.sourceFixtureId.trim()) {
      return { updated: false, ledger };
    }
    let updated = false;
    const forecasts = ledger.forecasts.map((forecast) => {
      if (forecast.forecastId !== forecastId || forecast.result
        || result.source !== forecast.fixtureSource
        || result.sourceFixtureId !== forecast.sourceFixtureId
        || observedAt < Date.parse(forecast.kickoff)) return forecast;
      updated = true;
      return { ...forecast, result };
    });
    if (!updated) return { updated: false, ledger };
    const next = { ...ledger, updatedAt: now.toISOString(), forecasts };
    writeLedger(next);
    return { updated: true, ledger: next };
  });
}

export function friendlyShadowMetrics(ledger: FriendlyShadowLedger): {
  sampleCount: number;
  brier: number | null;
  logLoss: number | null;
  calibration: Array<{ bucket: string; count: number; meanForecast: number; observedRate: number }>;
  segments: Array<{ neutralVenue: boolean; rotationAssessment: string; sampleCount: number }>;
} {
  const finished = ledger.forecasts.filter((forecast) => forecast.result);
  if (!finished.length) return { sampleCount: 0, brier: null, logLoss: null, calibration: [], segments: [] };
  let brier = 0;
  let logLoss = 0;
  const buckets = new Map<string, { count: number; forecast: number; observed: number }>();
  const segments = new Map<string, number>();
  for (const forecast of finished) {
    const winner = forecast.result!.homeScore > forecast.result!.awayScore ? 0
      : forecast.result!.homeScore === forecast.result!.awayScore ? 1 : 2;
    const probabilities = [forecast.pHome, forecast.pDraw, forecast.pAway];
    brier += probabilities.reduce((sum, probability, index) =>
      sum + (probability - (index === winner ? 1 : 0)) ** 2, 0
    );
    logLoss += -Math.log(Math.max(probabilities[winner], 1e-15));
    const favourite = Math.max(...probabilities);
    const lower = Math.floor(favourite * 10) / 10;
    const bucket = `${lower.toFixed(1)}-${Math.min(1, lower + 0.1).toFixed(1)}`;
    const row = buckets.get(bucket) ?? { count: 0, forecast: 0, observed: 0 };
    row.count += 1;
    row.forecast += favourite;
    row.observed += probabilities.indexOf(favourite) === winner ? 1 : 0;
    buckets.set(bucket, row);
    const segment = `${forecast.neutralVenue}|${forecast.rotationAssessment}`;
    segments.set(segment, (segments.get(segment) ?? 0) + 1);
  }
  return {
    sampleCount: finished.length,
    brier: brier / finished.length,
    logLoss: logLoss / finished.length,
    calibration: [...buckets].map(([bucket, row]) => ({
      bucket,
      count: row.count,
      meanForecast: row.forecast / row.count,
      observedRate: row.observed / row.count,
    })),
    segments: [...segments].map(([key, sampleCount]) => {
      const [neutralVenue, rotationAssessment] = key.split("|");
      return { neutralVenue: neutralVenue === "true", rotationAssessment, sampleCount };
    }),
  };
}
