import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalClubName, normalizeTeamName } from "../lib/team-names";
import { matrixTo1x2, scoreMatrix } from "./dixon-coles";
import { GOAL_CALIBRATION_CANDIDATES, historicalGoalLambdas, type HistoricalGoalFit } from "./historical-goal-calibration";

export const EPL_GOAL_CALIBRATION_METHOD_ID = "outcome-anchored-shrunk-goals-v2";
export const EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN = "2026-10-07T00:00:00.000Z";
// Registration is separate from activation; the release owner pins reviewed bytes.
export const EPL_GOAL_CALIBRATION_ARTIFACT_SHA256 = "a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7";
export const EPL_GOAL_CALIBRATION_MAX_AGE_MS = 30 * 86_400_000;
const SHA256 = /^[a-f0-9]{64}$/;

export interface GoalCalibrationEvidenceRef { path: string; sha256: string }
export interface EplGoalCalibrationArtifact {
  schemaVersion: 1;
  methodId: typeof EPL_GOAL_CALIBRATION_METHOD_ID;
  competitionId: "eng.1";
  fit: HistoricalGoalFit;
  review: {
    experimentId: "outcome-anchored-goal-rates-v2";
    source: GoalCalibrationEvidenceRef[];
    training: GoalCalibrationEvidenceRef[];
    evaluation: GoalCalibrationEvidenceRef[];
  };
}
export interface ValidatedEplGoalCalibrationArtifact {
  readonly artifact: EplGoalCalibrationArtifact;
  readonly artifactId: string;
  readonly artifactSha256: string;
  readonly origin: string;
  readonly ageDays: number;
}
export class EplGoalCalibrationArtifactError extends Error {}
const validatedArtifacts = new WeakSet<object>();
const cachedFiles = new Map<string, Buffer>();

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function goalCalibrationClubNameIsValid(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 100
    && name === name.trim() && name === name.normalize("NFKC") && !/\s{2}/.test(name)
    && /^[\p{Lu}\p{N}][\p{L}\p{N} .&'’\-]*$/u.test(name)
    && !["Constructor", "Prototype"].includes(name)
    && canonicalClubName(name) === name;
}
export function goalCalibrationUtcInstant(value: unknown): number {
  const parts = typeof value === "string"
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value) : null;
  if (!parts) {
    throw new EplGoalCalibrationArtifactError("Calibration dates must be explicit UTC instants");
  }
  const normalized = `${parts[1]}:${parts[2] ?? "00"}.${(parts[3] ?? "0").padEnd(3, "0")}Z`;
  const stamp = Date.parse(normalized);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== normalized) {
    throw new EplGoalCalibrationArtifactError("Invalid calibration calendar date");
  }
  return stamp;
}
function checkFreshness(origin: string, now: Date): number {
  const age = now.getTime() - goalCalibrationUtcInstant(origin);
  if (!Number.isFinite(age) || age < 0 || age > EPL_GOAL_CALIBRATION_MAX_AGE_MS) {
    throw new EplGoalCalibrationArtifactError("EPL goal calibration origin is future or older than 30 days");
  }
  return age / 86_400_000;
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
function evidenceRefs(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(ref => record(ref)
    && typeof ref.path === "string" && ref.path.length > 0 && !path.isAbsolute(ref.path)
    && !ref.path.includes("\\") && !ref.path.split("/").some(part => part === ".." || part === "" || part === ".")
    && typeof ref.sha256 === "string" && SHA256.test(ref.sha256));
}

export function validateEplGoalCalibrationArtifact(
  raw: string | Buffer, expectedSha256: string, now = new Date()
): ValidatedEplGoalCalibrationArtifact {
  if (!SHA256.test(expectedSha256)) throw new EplGoalCalibrationArtifactError("Invalid pinned calibration SHA-256");
  const artifactSha256 = createHash("sha256").update(raw).digest("hex");
  if (artifactSha256 !== expectedSha256) throw new EplGoalCalibrationArtifactError("EPL goal calibration raw-file hash mismatch");
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString()); } catch { throw new EplGoalCalibrationArtifactError("Malformed EPL goal calibration JSON"); }
  if (!record(parsed) || parsed.schemaVersion !== 1 || parsed.methodId !== EPL_GOAL_CALIBRATION_METHOD_ID
    || parsed.competitionId !== "eng.1" || !record(parsed.fit) || !record(parsed.review)) {
    throw new EplGoalCalibrationArtifactError("Unsupported EPL goal calibration schema/method/scope");
  }
  const fit = parsed.fit;
  const origin = goalCalibrationUtcInstant(fit.origin);
  if (origin !== Date.parse(EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN)) {
    throw new EplGoalCalibrationArtifactError("Calibration origin does not match reviewed activation");
  }
  const ageDays = checkFreshness(fit.origin as string, now);
  if (fit.methodId !== "shrunk-event-rate-elo-allocation-v1" || fit.converged !== true
    || typeof fit.gradientNorm !== "number" || !Number.isFinite(fit.gradientNorm) || fit.gradientNorm < 0 || fit.gradientNorm > 1e-7
    || ![fit.intercept, fit.allocationSlope, fit.homeOffset, fit.rho].every(value => typeof value === "number" && Number.isFinite(value))
    || (fit.allocationSlope as number) <= 0 || (fit.rho as number) < -0.2 || (fit.rho as number) > 0.15
    || !record(fit.options) || !GOAL_CALIBRATION_CANDIDATES.some(option => option.decayDays === (fit.options as Record<string, unknown>).decayDays
      && option.teamPrecision === (fit.options as Record<string, unknown>).teamPrecision)) {
    throw new EplGoalCalibrationArtifactError("Invalid or unconverged calibration coefficients/options");
  }
  if (!Number.isSafeInteger(fit.trainingCount) || (fit.trainingCount as number) < 100
    || !Number.isSafeInteger(fit.allocationTrainingCount) || (fit.allocationTrainingCount as number) < 30
    || (fit.allocationTrainingCount as number) > (fit.trainingCount as number)
    || typeof fit.trainingSha256 !== "string" || !SHA256.test(fit.trainingSha256)
    || goalCalibrationUtcInstant(fit.trainingThrough) > origin - 86_400_000) {
    throw new EplGoalCalibrationArtifactError("Invalid or post-cutoff calibration training provenance");
  }
  if (!record(fit.teamEffects) || !Object.keys(fit.teamEffects).length
    || Object.entries(fit.teamEffects).some(([name, value]) => !goalCalibrationClubNameIsValid(name)
      || typeof value !== "number" || !Number.isFinite(value))
    || new Set(Object.keys(fit.teamEffects).map(normalizeTeamName)).size !== Object.keys(fit.teamEffects).length) {
    throw new EplGoalCalibrationArtifactError("Calibration team effects must have finite canonical unique club names");
  }
  const effects = [0, ...Object.values(fit.teamEffects) as number[]];
  const minEffect = effects.reduce((minimum, value) => Math.min(minimum, value), 0);
  const maxEffect = effects.reduce((maximum, value) => Math.max(maximum, value), 0);
  const minimumRate = Math.exp((fit.intercept as number) + 2 * minEffect);
  const maximumRate = Math.exp((fit.intercept as number) + 2 * maxEffect);
  if (!Number.isFinite(minimumRate) || !Number.isFinite(maximumRate) || minimumRate < 1.5 || maximumRate > 4.5) {
    throw new EplGoalCalibrationArtifactError("Known and zero-effect scoring rates must remain in the declared 1.5–4.5 domain");
  }
  // Positive finite coefficients alone do not ensure a representable logistic
  // allocation. Check actual rate/grid arithmetic at both rating-domain ends.
  const rateClub = Object.keys(fit.teamEffects)[0];
  for (const [homeElo, awayElo] of [[500, 3000], [3000, 500]]) {
    const rates = historicalGoalLambdas(fit as unknown as HistoricalGoalFit,
      { homeCanonicalName: rateClub, awayCanonicalName: rateClub, homeElo, awayElo });
    const matrix = scoreMatrix(rates[0], rates[1], fit.rho as number);
    if (!rates.every(value => Number.isFinite(value) && value > 0)
      || matrix.some(row => row.some(value => !Number.isFinite(value) || value < 0))
      || !matrixTo1x2(matrix).every(value => Number.isFinite(value) && value > 0)) {
      throw new EplGoalCalibrationArtifactError("Calibration allocation is not representable across the declared rating domain");
    }
  }
  if (parsed.review.experimentId !== "outcome-anchored-goal-rates-v2"
    || ![parsed.review.source, parsed.review.training, parsed.review.evaluation].every(evidenceRefs)) {
    throw new EplGoalCalibrationArtifactError("Reviewed source/training/evaluation references required");
  }
  const artifact = parsed as unknown as EplGoalCalibrationArtifact;
  const validated = freezeDeep({ artifact, artifactId: `${EPL_GOAL_CALIBRATION_METHOD_ID}:${artifactSha256}`,
    artifactSha256, origin: artifact.fit.origin, ageDays });
  validatedArtifacts.add(validated);
  return validated;
}

export function assertValidatedEplGoalCalibrationArtifact(
  artifact: ValidatedEplGoalCalibrationArtifact, now = new Date()
): void {
  if (!artifact || !validatedArtifacts.has(artifact)) {
    throw new EplGoalCalibrationArtifactError("EPL forecasting requires a validated calibration artifact");
  }
  checkFreshness(artifact.origin, now);
}
export interface EplGoalCalibrationLoadOptions { filePath?: string; expectedSha256?: string; now?: Date }
export function loadEplGoalCalibrationArtifact(options: EplGoalCalibrationLoadOptions = {}): ValidatedEplGoalCalibrationArtifact {
  const expectedSha256 = options.expectedSha256 ?? EPL_GOAL_CALIBRATION_ARTIFACT_SHA256;
  const filePath = options.filePath ?? path.resolve(__dirname, "../../data/model-artifacts/epl-goal-calibration", `${expectedSha256}.json`);
  const key = `${filePath}:${expectedSha256}`;
  try {
    const raw = cachedFiles.get(key) ?? readFileSync(filePath);
    const validated = validateEplGoalCalibrationArtifact(raw, expectedSha256, options.now);
    cachedFiles.set(key, raw);
    return validated;
  } catch (error) {
    throw new EplGoalCalibrationArtifactError(`EPL goal calibration unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
export function getEplGoalCalibrationReadiness(options: EplGoalCalibrationLoadOptions = {}) {
  try {
    const artifact = loadEplGoalCalibrationArtifact(options);
    return { ready: true, artifactId: artifact.artifactId, artifactSha256: artifact.artifactSha256,
      origin: artifact.origin, ageDays: artifact.ageDays, error: null };
  } catch (error) {
    return { ready: false, artifactId: null, artifactSha256: null, origin: null, ageDays: null,
      error: error instanceof Error ? error.message : "Unknown calibration load failure" };
  }
}
