import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./club-history-corpus";
import {
  FITTED_DIXON_COLES_CONTRIBUTOR_ID,
  FITTED_DIXON_COLES_METHOD_ID,
  FIT_SCOPE_ALL_JOINED_PL_ROWS,
  FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO,
  researchArtifactPath,
  type FittedDixonColesArtifact,
  type FittedDixonColesFitScope,
} from "./dixon-coles-mle";
import {
  DIXON_COLES_MLE_NOT_ACTIVATED,
  type ForecastContributor,
} from "./model-contributors";

export { DIXON_COLES_MLE_NOT_ACTIVATED };

/**
 * Fail-closed registration for the fitted Dixon-Coles challenger.
 * Appends to a caller-supplied list only when latest.json exists and validates.
 * Does not activate production: model-data.ts still uses ELO_CHAMPION only.
 */

export type ChallengerRegistrationStatus = "registered" | "blocked";

export interface DixonColesMleLatestPointer {
  artifactPath: string;
  artifactSha256: string;
  methodId?: string;
  trainingRowCount?: number;
}

export interface ChallengerRegistrationResult {
  status: ChallengerRegistrationStatus;
  reason: string;
  challengers: readonly ForecastContributor[];
  contributor: ForecastContributor | null;
  artifactSha256: string | null;
}

const ARTIFACT_FILE_NAME = /^[0-9a-f]{64}\.json$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function finiteParamMap(value: unknown): Record<string, number> | null {
  if (!isStringRecord(value)) return null;
  const mapped: Record<string, number> = {};
  for (const [club, param] of Object.entries(value)) {
    if (!club || !isFiniteNumber(param)) return null;
    mapped[club] = param;
  }
  return mapped;
}

function isValidFitScope(value: unknown): value is FittedDixonColesFitScope {
  return value === FIT_SCOPE_ALL_JOINED_PL_ROWS
    || value === FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO;
}

function sameClubKeys(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index]);
}

export function validateFittedDixonColesArtifact(
  value: unknown
): { ok: true; artifact: FittedDixonColesArtifact } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "invalid-fitted-artifact" };
  if (value.schemaVersion !== 1) return { ok: false, reason: "invalid-fitted-artifact" };
  if (!isRecord(value.contributor)) return { ok: false, reason: "invalid-fitted-artifact" };
  if (value.contributor.id !== FITTED_DIXON_COLES_CONTRIBUTOR_ID) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  if (value.contributor.methodId !== FITTED_DIXON_COLES_METHOD_ID) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  if (value.contributor.status !== "challenger") {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  if (!isRecord(value.params) || !isRecord(value.training)) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  const attack = finiteParamMap(value.params.attack);
  const defence = finiteParamMap(value.params.defence);
  if (!attack || !defence || Object.keys(attack).length < 2 || !sameClubKeys(attack, defence)) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  if (
    !isFiniteNumber(value.params.intercept)
    || !isFiniteNumber(value.params.homeAdvantage)
    || !isFiniteNumber(value.params.rho)
    || Math.abs(value.params.rho) > 1
    || !isFiniteNumber(value.params.timeDecayXi)
    || !isFiniteNumber(value.params.clubEloPriorStrength)
  ) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  if (
    typeof value.training.clubHistoryDatasetSha256 !== "string"
    || !SHA256_HEX.test(value.training.clubHistoryDatasetSha256)
    || typeof value.training.preKickoffEloDatasetSha256 !== "string"
    || !SHA256_HEX.test(value.training.preKickoffEloDatasetSha256)
    || !Array.isArray(value.training.splitManifest)
    || !isFiniteNumber(value.training.rowCount)
    || value.training.rowCount < 1
    || !isFiniteNumber(value.training.clubCount)
    || value.training.clubCount !== Object.keys(attack).length
    || !isValidFitScope(value.training.fitScope)
    || !isFiniteNumber(value.training.excludedFixtureCount)
    || value.training.excludedFixtureCount < 0
    || !isRecord(value.training.plFixtureCoverage)
    || !isFiniteNumber(value.training.plFixtureCoverage.covered)
    || !isFiniteNumber(value.training.plFixtureCoverage.n)
    || value.training.plFixtureCoverage.n < value.training.plFixtureCoverage.covered
    || value.training.rowCount < 1
    || value.training.rowCount > value.training.plFixtureCoverage.covered
    || value.training.excludedFixtureCount !== (
      value.training.plFixtureCoverage.n - value.training.plFixtureCoverage.covered
    )
    || (value.training.fitScope === FIT_SCOPE_ALL_JOINED_PL_ROWS
      && (value.training.rowCount !== value.training.plFixtureCoverage.covered
        || value.training.excludedFixtureCount !== 0))
    || typeof value.training.converged !== "boolean"
    || !isFiniteNumber(value.training.iterations)
    || !isFiniteNumber(value.training.logLikelihood)
  ) {
    return { ok: false, reason: "invalid-fitted-artifact" };
  }
  return { ok: true, artifact: value as FittedDixonColesArtifact };
}

function parseLatestPointer(value: unknown): DixonColesMleLatestPointer | null {
  if (!isRecord(value)) return null;
  if (typeof value.artifactPath !== "string" || !ARTIFACT_FILE_NAME.test(value.artifactPath)) {
    return null;
  }
  if (typeof value.artifactSha256 !== "string" || !SHA256_HEX.test(value.artifactSha256)) {
    return null;
  }
  if (value.methodId !== undefined && value.methodId !== FITTED_DIXON_COLES_METHOD_ID) {
    return null;
  }
  return {
    artifactPath: value.artifactPath,
    artifactSha256: value.artifactSha256,
    ...(typeof value.methodId === "string" ? { methodId: value.methodId } : {}),
    ...(isFiniteNumber(value.trainingRowCount) ? { trainingRowCount: value.trainingRowCount } : {}),
  };
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function loadValidatedDixonColesMleArtifact(dataDir: string):
  | { ok: true; artifact: FittedDixonColesArtifact; artifactSha256: string }
  | { ok: false; reason: string } {
  const latestPath = researchArtifactPath(dataDir, "dixon-coles-mle/latest.json");
  if (!fs.existsSync(latestPath)) {
    return { ok: false, reason: "missing-fitted-artifact" };
  }
  const pointer = parseLatestPointer(readJson(latestPath));
  if (!pointer) {
    return { ok: false, reason: "invalid-latest-pointer" };
  }
  const artifactPath = path.join(dataDir, "research/dixon-coles-mle", pointer.artifactPath);
  if (!fs.existsSync(artifactPath)) {
    return { ok: false, reason: "missing-fitted-artifact-payload" };
  }
  const body = fs.readFileSync(artifactPath, "utf8");
  const digest = sha256(body);
  if (digest !== pointer.artifactSha256) {
    return { ok: false, reason: "artifact-hash-mismatch" };
  }
  const parsed = validateFittedDixonColesArtifact(readJson(artifactPath));
  if (!parsed.ok) return parsed;
  return { ok: true, artifact: parsed.artifact, artifactSha256: digest };
}

function notActivated(): never {
  throw new Error(DIXON_COLES_MLE_NOT_ACTIVATED);
}

export function dixonColesMleContributorFromArtifact(
  artifact: FittedDixonColesArtifact,
  artifactSha256: string
): ForecastContributor {
  return {
    id: artifact.contributor.id,
    version: artifactSha256,
    methodId: artifact.contributor.methodId,
    status: "challenger",
    forecast: notActivated,
    sampleScore: notActivated,
  };
}

/**
 * Would append dixon-coles-mle to `current` only when the reviewed artifact
 * exists and validates. Without it, returns `current` unchanged (production
 * REGISTERED_CHALLENGERS stays []). Registration is not activation.
 */
export function appendDixonColesMleChallenger(
  current: readonly ForecastContributor[],
  dataDir: string
): ChallengerRegistrationResult {
  const loaded = loadValidatedDixonColesMleArtifact(dataDir);
  if (!loaded.ok) {
    return {
      status: "blocked",
      reason: loaded.reason,
      challengers: current,
      contributor: null,
      artifactSha256: null,
    };
  }
  const contributor = dixonColesMleContributorFromArtifact(loaded.artifact, loaded.artifactSha256);
  if (current.some((entry) => entry.id === contributor.id && entry.version === contributor.version)) {
    return {
      status: "registered",
      reason: "already-registered",
      challengers: current,
      contributor,
      artifactSha256: loaded.artifactSha256,
    };
  }
  return {
    status: "registered",
    reason: "artifact-valid",
    challengers: [...current, contributor],
    contributor,
    artifactSha256: loaded.artifactSha256,
  };
}
