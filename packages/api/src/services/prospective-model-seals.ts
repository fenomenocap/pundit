import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalClubName } from "../lib/team-names";
import { eloToLambdas, matrixTo1x2, matrixToBtts, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { forecastFittedDixonColes, type FittedDixonColesArtifact } from "./dixon-coles-mle";
import type { ModelFixture } from "./model-data";
import type { RecognizedFixture } from "./fixture-registry";
import { ELO_CHAMPION, ELO_CHAMPION_CONFIG } from "./model-contributors";
import { validateClubStrengthArtifact, type ClubStrengthArtifact } from "./club-strength-artifact";

/** Private prospective evidence only. No public model selector or runtime hook. */
export const PROSPECTIVE_POLICY = "frozen-candidate-pre-kickoff-90m-v1";
const SHA = /^[a-f0-9]{64}$/;
const CHECKPOINT_MS = 90 * 60_000;

export interface FrozenProspectiveCandidate {
  schemaVersion: 1;
  methodId: "globally-feasible-fitted-dixon-coles-v1";
  frozenAt: string;
  trainingThrough: string;
  trainingResultAvailableAt: string;
  trainingDataSha256: string;
  sourceHashes: Record<string, string>;
  params: FittedDixonColesArtifact["params"];
  meanElo: number;
  fit: { converged: boolean; gradientNorm: number; stopReason: "gradient-converged" };
}

export interface ProspectiveObservation {
  fixture: ModelFixture;
  status: string;
  neutralVenue: boolean | null;
}

export interface ProspectiveSeal {
  schemaVersion: 1;
  policy: typeof PROSPECTIVE_POLICY;
  visibility: "private-research";
  candidateSha256: string;
  candidateFrozenAt: string;
  trainingThrough: string;
  trainingResultAvailableAt: string;
  fixtureId: number;
  competitionId: "eng.1";
  kickoff: string;
  observedAt: string;
  home: string;
  away: string;
  inputs: { homeElo: number | null; awayElo: number | null;
    recoveredHomeElo: number | null; recoveredAwayElo: number | null;
    ratingArtifactId: string; ratingArtifactSha256: string; ratingSnapshotAt: string };
  ratingArtifact: ClubStrengthArtifact | null;
  failure: string | null;
  champion: ReturnType<typeof ELO_CHAMPION.forecast> | null;
  candidate: ReturnType<typeof forecastFittedDixonColes>;
  championGrid: number[][] | null;
  candidateGrid: number[][] | null;
}

export function candidateDigest(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function validateFrozenCandidate(value: FrozenProspectiveCandidate): void {
  const params = value?.params;
  const keys = Object.keys(params?.attack ?? {}).sort();
  const defenceKeys = Object.keys(params?.defence ?? {}).sort();
  if (value?.schemaVersion !== 1 || value.methodId !== "globally-feasible-fitted-dixon-coles-v1"
    || !SHA.test(value.trainingDataSha256 ?? "")
    || !Number.isFinite(Date.parse(value.frozenAt)) || !Number.isFinite(Date.parse(value.trainingThrough))
    || Date.parse(value.trainingThrough) + 86_400_000 > Date.parse(value.frozenAt)
    || !Number.isFinite(Date.parse(value.trainingResultAvailableAt))
    || Date.parse(value.trainingResultAvailableAt) < Date.parse(value.trainingThrough) + 86_400_000
    || Date.parse(value.trainingResultAvailableAt) > Date.parse(value.frozenAt)
    || value.fit?.converged !== true || value.fit.stopReason !== "gradient-converged"
    || !Number.isFinite(value.fit.gradientNorm) || value.fit.gradientNorm > 1e-6
    || value.fit.gradientNorm < 0 || !Number.isFinite(value.meanElo)
    || !params || ![params.intercept, params.homeAdvantage, params.rho, params.timeDecayXi,
      params.clubEloPriorStrength].every(Number.isFinite)
    || params.timeDecayXi < 0 || params.clubEloPriorStrength < 0 || Math.abs(params.rho) > 0.35
    || keys.length < 2 || JSON.stringify(keys) !== JSON.stringify(defenceKeys)
    || [...Object.values(params.attack), ...Object.values(params.defence)].some((n) => !Number.isFinite(n))
    || !Object.keys(value.sourceHashes ?? {}).length
    || Object.entries(value.sourceHashes).some(([file, hash]) =>
      path.isAbsolute(file) || file.split(/[\\/]/).includes("..") || !SHA.test(hash))) {
    throw new Error("Invalid or unconverged frozen candidate");
  }
}

/** Source-bound capture prevents silently evaluating a changed forecast implementation. */
export function verifyCandidateSources(candidate: FrozenProspectiveCandidate, repoRoot: string): void {
  validateFrozenCandidate(candidate);
  const required = ["packages/api/src/services/dixon-coles-mle.ts", "packages/api/src/services/dixon-coles.ts",
    "packages/api/src/services/prospective-model-seals.ts", "packages/api/src/lib/team-names.ts",
    "packages/api/src/services/club-strength-artifact.ts",
    "packages/api/src/services/model-contributors.ts", "packages/api/scripts/capture-prospective-model.ts"];
  if (required.some((file) => !candidate.sourceHashes[file])) throw new Error("Missing forecast source bindings");
  for (const [file, expected] of Object.entries(candidate.sourceHashes)) {
    if (candidateDigest(fs.readFileSync(path.join(repoRoot, file), "utf8")) !== expected) {
      throw new Error(`Frozen candidate source changed: ${file}`);
    }
  }
}

/** Withheld public rows still count as observed checkpoint attempts. */
export function buildUnpricedProspectiveSeal(candidate: FrozenProspectiveCandidate, candidateSha256: string,
  fixture: RecognizedFixture, now = new Date()): ProspectiveSeal | null {
  validateFrozenCandidate(candidate);
  if (!SHA.test(candidateSha256) || !Number.isFinite(now.getTime()) || Date.parse(candidate.frozenAt) > now.getTime()) {
    throw new Error("Invalid or pre-freeze prospective observation");
  }
  const kickoff = Date.parse(fixture.kickoff);
  const id = Number(fixture.primarySourceFixtureId);
  if (fixture.competition.id !== "eng.1" || fixture.primarySource !== "espn" || fixture.recognition !== "authoritative"
    || !Number.isInteger(id) || id < 1 || fixture.fixtureId !== `espn:eng.1:${id}`
    || !Number.isFinite(kickoff) || kickoff <= now.getTime() || kickoff - now.getTime() > CHECKPOINT_MS) return null;
  return { schemaVersion: 1, policy: PROSPECTIVE_POLICY, visibility: "private-research", candidateSha256,
    candidateFrozenAt: candidate.frozenAt, trainingThrough: candidate.trainingThrough,
    trainingResultAvailableAt: candidate.trainingResultAvailableAt,
    fixtureId: id, competitionId: "eng.1", kickoff: fixture.kickoff, observedAt: now.toISOString(),
    home: fixture.homeTeam.name, away: fixture.awayTeam.name,
    inputs: { homeElo: null, awayElo: null, recoveredHomeElo: null, recoveredAwayElo: null,
      ratingArtifactId: "", ratingArtifactSha256: "", ratingSnapshotAt: "" },
    failure: fixture.status !== "scheduled" ? "fixture-not-scheduled"
      : fixture.neutralVenue !== false ? "unsupported-or-unknown-neutral-venue" : "public-model-unavailable",
    ratingArtifact: null, champion: null, candidate: null, championGrid: null, candidateGrid: null };
}

export function prospectiveFixtureIdentityMatches(model: ModelFixture, registry: RecognizedFixture): boolean {
  return registry.fixtureId === `espn:${model.competitionId}:${model.fixtureId}`
    && registry.competition.id === model.competitionId && registry.primarySource === "espn"
    && registry.primarySourceFixtureId === String(model.fixtureId) && registry.recognition === "authoritative"
    && Date.parse(registry.kickoff) === Date.parse(model.utcDate)
    && canonicalClubName(registry.homeTeam.name) === canonicalClubName(model.home)
    && canonicalClubName(registry.awayTeam.name) === canonicalClubName(model.away);
}

export function buildProspectiveBatch(candidate: FrozenProspectiveCandidate, candidateSha256: string,
  models: readonly ModelFixture[], registry: readonly RecognizedFixture[], now = new Date(),
  ratingArtifacts: ReadonlyMap<string, unknown> = new Map()): ProspectiveSeal[] {
  if (new Set(registry.map((fixture) => fixture.fixtureId)).size !== registry.length
    || new Set(models.map((fixture) => `${fixture.competitionId}:${fixture.fixtureId}`)).size !== models.length) {
    throw new Error("Conflicting duplicate public identities");
  }
  const seals = models.map((fixture) => {
    const recognized = registry.find((r) => prospectiveFixtureIdentityMatches(fixture, r));
    return buildProspectiveSeal(candidate, candidateSha256, { fixture,
      status: recognized?.status ?? "unrecognized", neutralVenue: recognized?.neutralVenue ?? null }, now, ratingArtifacts);
  }).filter((seal) => seal !== null);
  for (const fixture of registry) {
    const missing = buildUnpricedProspectiveSeal(candidate, candidateSha256, fixture, now);
    if (missing && !seals.some((seal) => seal.fixtureId === missing.fixtureId)) seals.push(missing);
  }
  return seals;
}

/** First observation in the checkpoint window wins, including a failed candidate. */
export function buildProspectiveSeal(
  candidate: FrozenProspectiveCandidate,
  candidateSha256: string,
  observation: ProspectiveObservation,
  now = new Date(),
  ratingArtifacts: ReadonlyMap<string, unknown> = new Map()
): ProspectiveSeal | null {
  validateFrozenCandidate(candidate);
  if (!SHA.test(candidateSha256)) throw new Error("Invalid candidate hash");
  const fixture = observation.fixture;
  const kickoff = Date.parse(fixture.utcDate);
  if (!Number.isFinite(now.getTime()) || Date.parse(candidate.frozenAt) > now.getTime()) {
    throw new Error("Capture precedes candidate freeze");
  }
  if (fixture.competitionId !== "eng.1" || !Number.isInteger(fixture.fixtureId)
    || !Number.isFinite(kickoff) || kickoff <= now.getTime() || kickoff - now.getTime() > CHECKPOINT_MS) return null;
  const provenance = fixture.forecastProvenance;
  const ratedAt = Date.parse(provenance?.ratingSnapshotAt ?? "");
  const forecastAt = Date.parse(provenance?.forecastAt ?? "");
  let failure: string | null = null;
  if (observation.status === "unrecognized") failure = "unrecognized-or-conflicting-fixture";
  else if (observation.status !== "scheduled") failure = "fixture-not-scheduled";
  else if (observation.neutralVenue !== false) failure = "unsupported-or-unknown-neutral-venue";
  else if (!provenance || provenance.modelId !== "pundit-fundamental" || provenance.modelVersion !== "2"
    || provenance.contributorId !== ELO_CHAMPION.id || provenance.contributorVersion !== ELO_CHAMPION.version
    || provenance.methodId !== ELO_CHAMPION.methodId || provenance.ratingProfile !== "eng-clubs"
    || !["artifact", "persisted"].includes(provenance.ratingSourceState)
    || provenance.homeAdvantageElo !== ELO_CHAMPION_CONFIG.defaultHomeAdvantageElo
    || Object.entries(ELO_CHAMPION_CONFIG).some(([key, value]) =>
      provenance.config?.[key as keyof typeof ELO_CHAMPION_CONFIG] !== value)
    || !SHA.test(provenance.ratingArtifactSha256 ?? "") || !Number.isFinite(ratedAt)
    || !Number.isFinite(forecastAt) || ratedAt > forecastAt || forecastAt > now.getTime()
    || forecastAt >= kickoff || now.getTime() - forecastAt > 2 * 60 * 60_000
    || now.getTime() - ratedAt >= 30 * 86_400_000
    || ![fixture.homeElo, fixture.awayElo].every(Number.isFinite)) {
    failure = "unverifiable-champion-inputs";
  }
  let champion: ProspectiveSeal["champion"] = null;
  let forecast: ProspectiveSeal["candidate"] = null;
  let championGrid: number[][] | null = null;
  let candidateGrid: number[][] | null = null;
  let recoveredHomeElo: number | null = null, recoveredAwayElo: number | null = null;
  let ratingArtifact: ClubStrengthArtifact | null = null;
  if (!failure && provenance) {
    const sha = provenance.ratingArtifactSha256!;
    if (!ratingArtifacts.has(sha)) failure = "missing-rating-artifact";
    else try {
      const verified = validateClubStrengthArtifact(ratingArtifacts.get(sha), new Date(forecastAt));
      const home = verified.byProfile["eng-clubs"].get(canonicalClubName(fixture.home));
      const away = verified.byProfile["eng-clubs"].get(canonicalClubName(fixture.away));
      if (verified.artifact.payloadSha256 !== sha || verified.artifact.artifactId !== provenance.ratingArtifactId
        || verified.artifact.payload.snapshotAt !== provenance.ratingSnapshotAt
        || !Number.isFinite(home) || !Number.isFinite(away)
        || Math.round(home! * 10) / 10 !== fixture.homeElo
        || Math.round(away! * 10) / 10 !== fixture.awayElo) failure = "rating-provenance-mismatch";
      else {
        recoveredHomeElo = home!; recoveredAwayElo = away!;
        ratingArtifact = structuredClone(verified.artifact);
      }
    } catch { failure = "invalid-rating-artifact"; }
  }
  if (!failure && provenance) {
    champion = ELO_CHAMPION.forecast({ homeStrength: recoveredHomeElo!, awayStrength: recoveredAwayElo!,
      homeAdvantageElo: provenance.homeAdvantageElo });
    const fields = ["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"] as const;
    if (!Number.isFinite(provenance.homeAdvantageElo) || fields.some((field) =>
      !Number.isFinite(fixture[field]) || !Number.isFinite(champion![field])
      || Math.abs(fixture[field] - champion![field]) > 0.000051)) {
      failure = "champion-input-parity-failed";
      champion = null;
    } else {
      championGrid = scoreMatrix(...eloToLambdas(recoveredHomeElo!, recoveredAwayElo!, provenance.homeAdvantageElo));
      forecast = forecastFittedDixonColes(candidate.params, canonicalClubName(fixture.home), canonicalClubName(fixture.away),
        { meanElo: candidate.meanElo, homeElo: recoveredHomeElo!, awayElo: recoveredAwayElo! });
      if (!forecast) failure = "candidate-invalid-score-grid";
      else candidateGrid = scoreMatrix(forecast.lambdaHome, forecast.lambdaAway, candidate.params.rho);
    }
  }
  return {
    schemaVersion: 1, policy: PROSPECTIVE_POLICY, visibility: "private-research", candidateSha256,
    candidateFrozenAt: candidate.frozenAt, trainingThrough: candidate.trainingThrough,
    trainingResultAvailableAt: candidate.trainingResultAvailableAt,
    fixtureId: fixture.fixtureId, competitionId: "eng.1", kickoff: fixture.utcDate, observedAt: now.toISOString(),
    home: fixture.home, away: fixture.away,
    inputs: { homeElo: fixture.homeElo, awayElo: fixture.awayElo,
      recoveredHomeElo, recoveredAwayElo, ratingArtifactId: provenance?.ratingArtifactId ?? "",
      ratingArtifactSha256: provenance?.ratingArtifactSha256 ?? "", ratingSnapshotAt: provenance?.ratingSnapshotAt ?? "" },
    ratingArtifact, failure, champion, candidate: forecast, championGrid, candidateGrid,
  };
}

export function validateProspectiveSeal(seal: ProspectiveSeal): void {
  const observedAt = Date.parse(seal?.observedAt ?? ""), kickoff = Date.parse(seal?.kickoff ?? "");
  const freeze = Date.parse(seal?.candidateFrozenAt ?? ""), training = Date.parse(seal?.trainingThrough ?? "");
  const available = Date.parse(seal?.trainingResultAvailableAt ?? "");
  const matchesRecomputed = (actual: unknown, expected: unknown): boolean => {
    if (typeof expected === "number") return typeof actual === "number" && Number.isFinite(actual)
      && Math.abs(actual - expected) <= 1e-12;
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, index) => matchesRecomputed(actual[index], value));
    if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.entries(expected).every(([field, value]) => matchesRecomputed((actual as Record<string, unknown>)[field], value));
    return actual === expected;
  };
  // Validate at capture time, so historical seals remain verifiable after the
  // runtime pin changes or its freshness window expires. The embedded artifact
  // binds full precision; public one-decimal Elo alone cannot detect drift.
  let validInputs = false;
  try {
    if (seal.ratingArtifact === null) {
      validInputs = seal.inputs.recoveredHomeElo === null && seal.inputs.recoveredAwayElo === null
        && seal.champion === null && seal.candidate === null;
    } else {
      const verified = validateClubStrengthArtifact(seal.ratingArtifact, new Date(observedAt));
      const home = verified.byProfile["eng-clubs"].get(canonicalClubName(seal.home));
      const away = verified.byProfile["eng-clubs"].get(canonicalClubName(seal.away));
      validInputs = Number.isFinite(home) && Number.isFinite(away)
        && home === seal.inputs.recoveredHomeElo && away === seal.inputs.recoveredAwayElo
        && Math.round(home! * 10) / 10 === seal.inputs.homeElo
        && Math.round(away! * 10) / 10 === seal.inputs.awayElo
        && verified.artifact.payloadSha256 === seal.inputs.ratingArtifactSha256
        && verified.artifact.artifactId === seal.inputs.ratingArtifactId
        && verified.artifact.payload.snapshotAt === seal.inputs.ratingSnapshotAt;
      if (validInputs && seal.champion !== null) {
        const expected = ELO_CHAMPION.forecast({ homeStrength: home!, awayStrength: away!,
          homeAdvantageElo: ELO_CHAMPION_CONFIG.defaultHomeAdvantageElo });
        const expectedGrid = scoreMatrix(...eloToLambdas(home!, away!, ELO_CHAMPION_CONFIG.defaultHomeAdvantageElo));
        validInputs = matchesRecomputed(seal.champion, expected) && matchesRecomputed(seal.championGrid, expectedGrid);
      }
    }
  } catch { validInputs = false; }
  const validForecast = (forecast: ProspectiveSeal["candidate"] | ProspectiveSeal["champion"], grid: number[][] | null) => {
    if (forecast === null) return grid === null;
    if (!forecast || !Array.isArray(grid) || grid.length !== 11 || grid.some((row) => !Array.isArray(row)
      || row.length !== 11 || row.some((p) => !Number.isFinite(p) || p < 0 || p > 1))
      || Math.abs(grid.flat().reduce((sum, p) => sum + p, 0) - 1) > 1e-9) return false;
    const expected = [...matrixTo1x2(grid), ...matrixToTotals(grid, 2.5), ...matrixToBtts(grid)];
    const actual = [forecast.pHome, forecast.pDraw, forecast.pAway, forecast.pOver2_5, forecast.pUnder2_5,
      forecast.pBttsYes, forecast.pBttsNo];
    return actual.every((p, i) => Number.isFinite(p) && Math.abs(p - expected[i]) <= 1e-9);
  };
  if (seal?.schemaVersion !== 1 || seal.policy !== PROSPECTIVE_POLICY || seal.visibility !== "private-research"
    || !SHA.test(seal.candidateSha256 ?? "") || seal.competitionId !== "eng.1" || !Number.isInteger(seal.fixtureId)
    || seal.fixtureId < 1 || typeof seal.home !== "string" || !seal.home.trim() || typeof seal.away !== "string"
    || !seal.away.trim() || canonicalClubName(seal.home) === canonicalClubName(seal.away)
    || ![observedAt, kickoff, freeze, training, available].every(Number.isFinite)
    || training + 86_400_000 > available || available > freeze
    || freeze > observedAt || observedAt >= kickoff || kickoff - observedAt > CHECKPOINT_MS || !seal.inputs
    || !validInputs || !(seal.failure === null || (typeof seal.failure === "string" && seal.failure.length > 0))
    || (seal.candidate !== null && seal.champion === null)
    || !validForecast(seal.champion, seal.championGrid) || !validForecast(seal.candidate, seal.candidateGrid)
    || (seal.failure === null && (!seal.champion || !seal.candidate))
    || (seal.champion !== null && (!Number.isFinite(seal.inputs.homeElo) || !Number.isFinite(seal.inputs.awayElo)
      || !Number.isFinite(seal.inputs.recoveredHomeElo) || !Number.isFinite(seal.inputs.recoveredAwayElo)
      || Math.round(seal.inputs.recoveredHomeElo! * 10) / 10 !== seal.inputs.homeElo
      || Math.round(seal.inputs.recoveredAwayElo! * 10) / 10 !== seal.inputs.awayElo
      || seal.inputs.ratingArtifactId !== `clubelo@1:${seal.inputs.ratingArtifactSha256}`
      || !SHA.test(seal.inputs.ratingArtifactSha256) || !Number.isFinite(Date.parse(seal.inputs.ratingSnapshotAt))
      || Date.parse(seal.inputs.ratingSnapshotAt) > observedAt))) {
    throw new Error("Invalid or corrupt prospective seal");
  }
}

/** Exclusive file creation; later runs cannot replace a forecast after results arrive. */
export function persistProspectiveSeal(directory: string, seal: ProspectiveSeal): { inserted: boolean; path: string } {
  validateProspectiveSeal(seal);
  if (!SHA.test(seal.candidateSha256) || !Number.isInteger(seal.fixtureId) || seal.fixtureId < 0
    || seal.competitionId !== "eng.1") throw new Error("Invalid prospective identity");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${seal.candidateSha256}-eng.1-${seal.fixtureId}.json`);
  const temp = path.join(directory, `.capture-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(seal, null, 2)}\n`, { flag: "wx" });
    // Atomic, exclusive publication on the same filesystem. A crash cannot
    // expose a partially written forecast and cannot overwrite an earlier seal.
    fs.linkSync(temp, file);
    return { inserted: true, path: file };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = JSON.parse(fs.readFileSync(file, "utf8")) as ProspectiveSeal;
    validateProspectiveSeal(previous);
    if (previous.schemaVersion !== 1 || previous.policy !== PROSPECTIVE_POLICY
      || previous.candidateSha256 !== seal.candidateSha256 || previous.fixtureId !== seal.fixtureId) {
      throw new Error("Existing prospective seal is corrupt or has a different identity");
    }
    return { inserted: false, path: file };
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export interface ProspectiveResult {
  sealSha256: string;
  candidateSha256: string;
  fixtureId: number;
  competitionId: "eng.1";
  source: "espn";
  sourceStatus: "FINISHED";
  observedAt: string;
  homeScore: number;
  awayScore: number;
}

/** Results are separate immutable observations. Corrections never rewrite forecasts. */
export function buildProspectiveResult(sealBody: string, match: {
  id: number; competitionId: string; utcDate: string; homeTeam: string; awayTeam: string; status: string;
  score: { home: number | null; away: number | null } | null;
}, now = new Date()): ProspectiveResult | null {
  const seal = JSON.parse(sealBody) as ProspectiveSeal;
  validateProspectiveSeal(seal);
  if (seal.policy !== PROSPECTIVE_POLICY || seal.competitionId !== "eng.1" || !SHA.test(seal.candidateSha256)
    || !Number.isFinite(Date.parse(seal.kickoff)) || !Number.isFinite(Date.parse(seal.observedAt))
    || Date.parse(seal.observedAt) >= Date.parse(seal.kickoff)) throw new Error("Invalid prospective seal");
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(seal.kickoff) + 90 * 60_000
    || match.id !== seal.fixtureId || match.competitionId !== "eng.1" || match.status !== "FINISHED"
    || Date.parse(match.utcDate) !== Date.parse(seal.kickoff)
    || canonicalClubName(match.homeTeam) !== canonicalClubName(seal.home)
    || canonicalClubName(match.awayTeam) !== canonicalClubName(seal.away)
    || !match.score || ![match.score.home, match.score.away].every((n) => Number.isInteger(n) && n! >= 0)) return null;
  return { sealSha256: candidateDigest(sealBody), candidateSha256: seal.candidateSha256,
    fixtureId: seal.fixtureId, competitionId: "eng.1", source: "espn", sourceStatus: "FINISHED",
    observedAt: now.toISOString(), homeScore: match.score.home!, awayScore: match.score.away! };
}

export function persistProspectiveResult(directory: string, result: ProspectiveResult): string {
  if (!SHA.test(result.sealSha256) || !SHA.test(result.candidateSha256)) throw new Error("Invalid result identity");
  fs.mkdirSync(directory, { recursive: true });
  const body = `${JSON.stringify(result, null, 2)}\n`;
  const file = path.join(directory, `${candidateDigest(body)}.json`);
  const temp = path.join(directory, `.result-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, body, { flag: "wx" });
    fs.linkSync(temp, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (fs.readFileSync(file, "utf8") !== body) throw new Error("Result digest conflict");
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return file;
}
