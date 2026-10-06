import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCachedMatches, getCachedSeasonSchedule, seasonScheduleStatus } from "./football-data";
import { getCachedModelData, getModelRefreshState, type ModelFixture } from "./model-data";
import { getCachedClubRatings, clubRatingsAreCurrent } from "./club-ratings";
import { getRecognizedFixtureSnapshot, type RecognizedFixture } from "./fixture-registry";
import { resolveDataPath, resolveRepoDataPath } from "./persistent-store";
import { getRuntimeVersion } from "./runtime-version";
import {
  buildProspectiveBatch, buildProspectiveResult, candidateDigest, persistProspectiveSeal,
  persistProspectiveResult, verifyCandidateSources,
  type FrozenProspectiveCandidate, type ProspectiveSeal, type ProspectiveResult,
} from "./prospective-model-seals";
import type { FootballMatch } from "./football-data";
import { canonicalClubName } from "../lib/team-names";
import { validateFrozenCandidateSeal } from "./prospective-model-evaluation";

export const PROSPECTIVE_COLLECTOR_INTERVAL_MS = 5 * 60_000;
const END_AT = "2027-07-01T00:00:00.000Z";
const LIMIT = 1000;
const SHA = /^[a-f0-9]{64}$/;

interface Observation {
  models: ModelFixture[];
  registry: RecognizedFixture[];
  recent: FootballMatch[];
  ratingArtifacts: ReadonlyMap<string, unknown>;
}
interface Cohort { schemaVersion: 1; candidateSha256: string; activatedAt: string; endsAt: string; releaseSha: string | null }
interface Seen { fixtureId: number; kickoff: string; firstObservedAt: string }
export interface ProspectiveCollectorStatus {
  enabled: boolean; active: boolean; candidateSha256: string | null; activatedAt: string | null;
  endsAt: string; intervalMs: number; lastAttemptAt: string | null; lastSuccessAt: string | null;
  largestPollGapMs: number; observedFixtures: number; sealedFixtures: number;
  failedSeals: number; missedCheckpoints: number; resultObservations: number; error: string | null;
  publicForecastsChanged: false; promotionApproved: false;
}

/** Exclusive publication permits overlapping rolling-deploy processes without overwriting evidence. */
function publish(file: string, value: unknown): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.linkSync(temporary, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function files(directory: string, limit = LIMIT): string[] {
  const entries = fs.existsSync(directory) ? fs.readdirSync(directory).filter((file) => file.endsWith(".json")) : [];
  if (entries.length > limit) throw new Error("Prospective cohort storage limit exceeded");
  return entries.sort();
}

/** Fresh ESPN result caches may overlap; conflicting completed observations cannot silently win. */
export function mergeProspectiveResults(...sources: readonly FootballMatch[][]): FootballMatch[] {
  const merged = new Map<number, FootballMatch>();
  for (const match of sources.flat()) {
    if (match.competitionId !== "eng.1" || match.status !== "FINISHED") continue;
    const previous = merged.get(match.id);
    if (previous && (Date.parse(previous.utcDate) !== Date.parse(match.utcDate)
      || canonicalClubName(previous.homeTeam) !== canonicalClubName(match.homeTeam)
      || canonicalClubName(previous.awayTeam) !== canonicalClubName(match.awayTeam)
      || previous.score?.home !== match.score?.home || previous.score?.away !== match.score?.away))
      throw new Error("Conflicting completed prospective result caches");
    merged.set(match.id, match);
  }
  return [...merged.values()];
}

export function freshProspectiveRecentResults(state: {
  lastUpdated: Date | null; error: string | null; competitionErrors: Record<string, string>;
  byCompetition: Record<string, { error: string | null }>; recent: FootballMatch[];
}, now: Date): FootballMatch[] {
  return state.lastUpdated !== null && state.error === null && !state.competitionErrors["eng.1"]
    && !state.byCompetition["eng.1"]?.error && state.lastUpdated.getTime() <= now.getTime()
    && now.getTime() - state.lastUpdated.getTime() < 60 * 60_000 ? state.recent : [];
}

/** Private research only. This collector consumes existing caches and has no fetch or public-model write. */
export function createProspectiveCollector(options: {
  candidateFile: string; repoRoot: string; directory: string;
  observe: () => Observation; now?: () => Date; releaseSha?: string | null;
}) {
  const now = options.now ?? (() => new Date());
  const status: ProspectiveCollectorStatus = { enabled: true, active: false, candidateSha256: null,
    activatedAt: null, endsAt: END_AT, intervalMs: PROSPECTIVE_COLLECTOR_INTERVAL_MS,
    lastAttemptAt: null, lastSuccessAt: null, largestPollGapMs: 0, observedFixtures: 0,
    sealedFixtures: 0, failedSeals: 0, missedCheckpoints: 0, resultObservations: 0,
    error: null, publicForecastsChanged: false, promotionApproved: false };
  let busy = false;
  const tick = (): void => {
    if (busy) return;
    busy = true;
    const timestamp = now();
    try {
      if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid collector clock");
      if (status.lastAttemptAt) {
        const gap = timestamp.getTime() - Date.parse(status.lastAttemptAt);
        if (gap < 0) throw new Error("Prospective collector clock moved backwards");
        status.largestPollGapMs = Math.max(status.largestPollGapMs, gap);
      }
      status.lastAttemptAt = timestamp.toISOString();
      const body = fs.readFileSync(options.candidateFile, "utf8");
      const candidate = JSON.parse(body) as FrozenProspectiveCandidate;
      const digest = candidateDigest(body);
      if (path.basename(options.candidateFile) !== `${digest}.json`) throw new Error("Frozen candidate filename digest differs");
      if (!["packages/api/src/services/prospective-model-collector.ts", "packages/api/src/services/prospective-model-evaluation.ts"]
        .every((file) => candidate.sourceHashes[file]))
        throw new Error("Missing collector source binding");
      verifyCandidateSources(candidate, options.repoRoot);
      if (Date.parse(candidate.frozenAt) > timestamp.getTime()) throw new Error("Capture precedes candidate freeze");
      status.candidateSha256 = digest;
      const cohortDirectory = path.join(options.directory, digest);
      const cohortFile = path.join(cohortDirectory, "cohort.json");
      if (timestamp.getTime() >= Date.parse(END_AT) && !fs.existsSync(cohortFile)) {
        status.active = false; status.error = "Prospective cohort window ended"; return;
      }
      publish(cohortFile, { schemaVersion: 1, candidateSha256: digest, activatedAt: timestamp.toISOString(),
        endsAt: END_AT, releaseSha: options.releaseSha ?? null } satisfies Cohort);
      const cohort = JSON.parse(fs.readFileSync(cohortFile, "utf8")) as Cohort;
      if (cohort.schemaVersion !== 1 || cohort.candidateSha256 !== digest || cohort.endsAt !== END_AT
        || !Number.isFinite(Date.parse(cohort.activatedAt))
        || Date.parse(cohort.activatedAt) < Date.parse(candidate.frozenAt)
        || Date.parse(cohort.activatedAt) > timestamp.getTime()
        || (cohort.releaseSha !== null && !/^[a-f0-9]{40}$/.test(cohort.releaseSha))) throw new Error("Invalid prospective cohort");
      status.activatedAt = cohort.activatedAt;
      if (timestamp.getTime() >= Date.parse(END_AT)) {
        status.active = false; status.error = "Prospective cohort window ended"; return;
      }
      const observation = options.observe();
      const sealsDirectory = path.join(cohortDirectory, "seals");
      const resultsDirectory = path.join(cohortDirectory, "results");
      const claimsDirectory = path.join(cohortDirectory, "result-claims");
      const seenDirectory = path.join(cohortDirectory, "seen");
      const missedDirectory = path.join(cohortDirectory, "missed");
      const storedSeals = files(sealsDirectory).map((file) => {
        const storedBody = fs.readFileSync(path.join(sealsDirectory, file), "utf8");
        const seal = JSON.parse(storedBody) as ProspectiveSeal;
        validateFrozenCandidateSeal(candidate, seal);
        if (seal.candidateSha256 !== digest || file !== `${digest}-eng.1-${seal.fixtureId}.json`
          || Date.parse(seal.observedAt) < Date.parse(cohort.activatedAt)
          || Date.parse(seal.observedAt) > timestamp.getTime()
          || Date.parse(seal.kickoff) >= Date.parse(END_AT)) throw new Error("Stored seal conflicts with prospective cohort");
        return { body: storedBody, seal };
      });
      const validateResult = (result: ProspectiveResult): ProspectiveResult => {
        const stored = storedSeals.find(({ body: storedBody }) => candidateDigest(storedBody) === result.sealSha256);
        const rebuilt = stored && buildProspectiveResult(stored.body, {
          id: result.fixtureId, competitionId: "eng.1", utcDate: stored.seal.kickoff,
          homeTeam: stored.seal.home, awayTeam: stored.seal.away, status: "FINISHED",
          score: { home: result.homeScore, away: result.awayScore },
        }, new Date(result.observedAt));
        if (!rebuilt || JSON.stringify(result) !== JSON.stringify(rebuilt)
          || result.candidateSha256 !== digest || Date.parse(result.observedAt) > timestamp.getTime())
          throw new Error("Corrupt prospective result");
        return result;
      };
      const resultDigest = (result: ProspectiveResult) => candidateDigest(`${JSON.stringify(result, null, 2)}\n`);
      const priorResults = files(resultsDirectory, LIMIT * 4).map((file) => {
        const body = fs.readFileSync(path.join(resultsDirectory, file), "utf8");
        if (file !== `${candidateDigest(body)}.json`) throw new Error("Corrupt prospective result filename");
        return validateResult(JSON.parse(body));
      });
      const claims = files(claimsDirectory, LIMIT * 4).map((file) => {
        const claim = JSON.parse(fs.readFileSync(path.join(claimsDirectory, file), "utf8")) as {
          predecessorSha256: string | null; result: ProspectiveResult;
        };
        const result = validateResult(claim.result);
        if (!(claim.predecessorSha256 === null || SHA.test(claim.predecessorSha256))
          || file !== `${result.sealSha256}-${claim.predecessorSha256 ?? "root"}.json`)
          throw new Error("Corrupt prospective transition claim");
        return { ...claim, result, digest: resultDigest(result) };
      });
      const latestBySeal = new Map<string, ProspectiveResult>();
      for (const stored of storedSeals) {
        const sealDigest = candidateDigest(stored.body), chain = claims.filter((claim) => claim.result.sealSha256 === sealDigest);
        if (!chain.length) continue;
        const roots = chain.filter((claim) => claim.predecessorSha256 === null);
        if (roots.length !== 1) throw new Error("Prospective result chain has no unique root");
        let current: typeof roots[number] | undefined = roots[0], previousAt = -Infinity;
        const visited = new Set<string>();
        while (current) {
          if (visited.has(current.digest) || Date.parse(current.result.observedAt) <= previousAt)
            throw new Error("Prospective result chain is cyclic or retrodated");
          visited.add(current.digest); previousAt = Date.parse(current.result.observedAt);
          latestBySeal.set(sealDigest, current.result);
          if (!priorResults.some((row) => resultDigest(row) === current!.digest)) {
            if (priorResults.length >= LIMIT * 4) throw new Error("Prospective result storage limit exceeded");
            persistProspectiveResult(resultsDirectory, current.result); priorResults.push(current.result);
          }
          const next = chain.filter((claim) => claim.predecessorSha256 === current!.digest);
          if (next.length > 1) throw new Error("Prospective result chain has competing successors");
          current = next[0];
        }
        if (visited.size !== chain.length) throw new Error("Prospective result chain has orphan transitions");
      }
      if (priorResults.some((result) => !claims.some((claim) => claim.digest === resultDigest(result))))
        throw new Error("Prospective result has no immutable transition claim");
      let seenCount = files(seenDirectory).length;
      for (const fixture of observation.registry) {
        const id = Number(fixture.primarySourceFixtureId);
        const existing = storedSeals.find((row) => row.seal.fixtureId === id);
        if (existing && Date.parse(existing.seal.kickoff) !== Date.parse(fixture.kickoff))
          throw new Error("Prospective fixture was rescheduled or reidentified");
        if (fixture.competition.id !== "eng.1" || fixture.primarySource !== "espn"
          || fixture.recognition !== "authoritative" || fixture.fixtureId !== `espn:eng.1:${id}`
          || !Number.isInteger(id) || id < 1 || fixture.status !== "scheduled"
          || Date.parse(fixture.kickoff) <= timestamp.getTime()
          || Date.parse(fixture.kickoff) >= Date.parse(END_AT)) continue;
        const kickoff = new Date(fixture.kickoff).toISOString();
        const seenFile = path.join(seenDirectory, `${id}-${candidateDigest(kickoff)}.json`);
        if (!fs.existsSync(seenFile) && seenCount >= LIMIT) throw new Error("Prospective fixture storage limit exceeded");
        if (publish(seenFile, { fixtureId: id, kickoff, firstObservedAt: timestamp.toISOString() } satisfies Seen)) seenCount += 1;
      }
      const checkpointSeals = buildProspectiveBatch(candidate, digest, observation.models,
        observation.registry, timestamp, observation.ratingArtifacts)
        .filter((seal) => Date.parse(seal.kickoff) > Date.parse(cohort.activatedAt)
          && Date.parse(seal.kickoff) < Date.parse(END_AT));
      for (const seal of checkpointSeals) {
        const existing = storedSeals.find((row) => row.seal.fixtureId === seal.fixtureId);
        if (existing && (Date.parse(existing.seal.kickoff) !== Date.parse(seal.kickoff) || existing.seal.home !== seal.home
          || existing.seal.away !== seal.away)) throw new Error("Prospective fixture was rescheduled or reidentified");
        if (!existing && storedSeals.length >= LIMIT) throw new Error("Prospective seal storage limit exceeded");
        const outcome = persistProspectiveSeal(sealsDirectory, seal);
        if (outcome.inserted) storedSeals.push({ seal, body: fs.readFileSync(outcome.path, "utf8") });
      }
      for (const stored of storedSeals) {
        const match = observation.recent.find((row) => row.competitionId === "eng.1" && row.id === stored.seal.fixtureId);
        if (!match) continue;
        const result = buildProspectiveResult(stored.body, match, timestamp);
        const previous = result ? latestBySeal.get(result.sealSha256) : undefined;
        if (result && (!previous || previous.homeScore !== result.homeScore || previous.awayScore !== result.awayScore)) {
          if (priorResults.length >= LIMIT * 4 || files(claimsDirectory, LIMIT * 4).length >= LIMIT * 4)
            throw new Error("Prospective result storage limit exceeded");
          // Rolling-deploy instances share one successor per prior observation,
          // even if one process crashes between the claim and final publication.
          const predecessor = previous ? resultDigest(previous) : null;
          const claimFile = path.join(claimsDirectory, `${result.sealSha256}-${predecessor ?? "root"}.json`);
          publish(claimFile, { predecessorSha256: predecessor, result });
          const claimed = JSON.parse(fs.readFileSync(claimFile, "utf8"));
          const verified = validateResult(claimed.result);
          if (claimed.predecessorSha256 !== predecessor
            || (previous && Date.parse(verified.observedAt) <= Date.parse(previous.observedAt)))
            throw new Error("Corrupt or retrodated prospective result transition");
          persistProspectiveResult(resultsDirectory, verified);
          if (!priorResults.some((row) => resultDigest(row) === resultDigest(verified))) priorResults.push(verified);
          latestBySeal.set(result.sealSha256, verified);
        }
      }
      const seen = files(seenDirectory).map((file) => {
        const row = JSON.parse(fs.readFileSync(path.join(seenDirectory, file), "utf8")) as Seen;
        if (!Number.isInteger(row.fixtureId) || row.fixtureId < 1
          || file !== `${row.fixtureId}-${candidateDigest(row.kickoff)}.json`
          || !Number.isFinite(Date.parse(row.kickoff)) || !Number.isFinite(Date.parse(row.firstObservedAt))
          || Date.parse(row.firstObservedAt) < Date.parse(cohort.activatedAt)
          || Date.parse(row.firstObservedAt) > timestamp.getTime()
          || Date.parse(row.firstObservedAt) >= Date.parse(row.kickoff)) throw new Error("Corrupt prospective coverage record");
        if (Date.parse(row.kickoff) <= timestamp.getTime()
          && !storedSeals.some(({ seal }) => seal.fixtureId === row.fixtureId && Date.parse(seal.kickoff) === Date.parse(row.kickoff)))
          publish(path.join(missedDirectory, file), { ...row, detectedAt: timestamp.toISOString(), reason: "checkpoint-not-sealed" });
        return row;
      });
      status.observedFixtures = seen.length;
      status.sealedFixtures = storedSeals.length;
      status.failedSeals = storedSeals.filter(({ seal }) => seal.failure).length;
      const missed = files(missedDirectory);
      for (const file of missed) {
        const row = JSON.parse(fs.readFileSync(path.join(missedDirectory, file), "utf8"));
        const original = seen.find((record) => record.fixtureId === row.fixtureId && record.kickoff === row.kickoff);
        if (!original || row.firstObservedAt !== original.firstObservedAt || row.reason !== "checkpoint-not-sealed"
          || file !== `${row.fixtureId}-${candidateDigest(row.kickoff)}.json`
          || !Number.isFinite(Date.parse(row.detectedAt)) || Date.parse(row.detectedAt) < Date.parse(row.kickoff)
          || Date.parse(row.detectedAt) > timestamp.getTime()) throw new Error("Corrupt prospective missed checkpoint");
      }
      status.missedCheckpoints = missed.length;
      status.resultObservations = priorResults.length;
      status.lastSuccessAt = timestamp.toISOString(); status.error = null; status.active = true;
    } catch (error) {
      status.active = false;
      status.error = error instanceof Error ? error.message : "Prospective collector failed";
    } finally { busy = false; }
  };
  return { tick, status: () => ({ ...status }) };
}

let runtime: ReturnType<typeof createProspectiveCollector> | null = null;
let initializationError: string | null = null;
export function getProspectiveCollectorStatus(): ProspectiveCollectorStatus | { enabled: boolean; active: false; error?: string } {
  return runtime?.status() ?? (initializationError
    ? { enabled: true, active: false, error: initializationError } : { enabled: false, active: false });
}

export function startProspectiveCollector(): void {
  if (runtime || process.env.PROSPECTIVE_MODEL_CAPTURE === "false") return;
  let selector: { schemaVersion: number; candidateSha256: string };
  try {
    selector = JSON.parse(fs.readFileSync(resolveRepoDataPath("model-artifacts/prospective/production.json"), "utf8"));
    if (selector.schemaVersion !== 1 || !SHA.test(selector.candidateSha256 ?? "")) throw new Error("Invalid prospective candidate selector");
  } catch (error) {
    initializationError = error instanceof Error ? error.message : "Prospective selector unavailable";
    return;
  }
  runtime = createProspectiveCollector({
    candidateFile: resolveRepoDataPath(`model-artifacts/prospective/${selector.candidateSha256}.json`),
    repoRoot: path.resolve(__dirname, "../../../.."), directory: resolveDataPath("prospective-model"),
    releaseSha: /^[a-f0-9]{40}$/.test(getRuntimeVersion().sha) ? getRuntimeVersion().sha : null,
    observe: () => {
      const model = getCachedModelData(), ratings = getCachedClubRatings();
      const refresh = getModelRefreshState();
      const registry = getRecognizedFixtureSnapshot({ modelFixtures: model.fixtures,
        modelInitialized: model.lastUpdated !== null, modelRefreshing: refresh.refreshing,
        ratingsAvailable: clubRatingsAreCurrent(ratings), missingRatingTeamIds: refresh.missingRatingTeamIds });
      const ratingArtifacts = new Map<string, unknown>();
      for (const sha of new Set(model.fixtures.map((row) => row.forecastProvenance?.ratingArtifactSha256))) {
        if (!SHA.test(sha ?? "")) continue;
        for (const location of [resolveRepoDataPath(`model-artifacts/clubelo/${sha}.json`),
          resolveDataPath(`model-artifacts/clubelo/${sha}.json`),
          resolveDataPath("cache/club-strength-artifact.json"),
          resolveDataPath("cache/club-strength-artifact.json.last-good")]) {
          if (fs.existsSync(location)) {
            try {
              const artifact = JSON.parse(fs.readFileSync(location, "utf8"));
              if (artifact.payloadSha256 !== sha) continue;
              ratingArtifacts.set(sha!, artifact);
            }
            catch { ratingArtifacts.set(sha!, null); }
            break;
          }
        }
      }
      const timestamp = new Date();
      const football = getCachedMatches(), season = getCachedSeasonSchedule();
      const seasonFresh = season.lastUpdated !== null && season.lastUpdated.getTime() <= timestamp.getTime()
        && seasonScheduleStatus(season, timestamp).ready;
      return { models: model.fixtures, registry: registry.fixtures.map((row) => row.fixture),
        recent: mergeProspectiveResults(freshProspectiveRecentResults(football, timestamp), seasonFresh ? season.fixtures : []),
        ratingArtifacts };
    },
  });
  runtime.tick();
  setInterval(() => runtime?.tick(), PROSPECTIVE_COLLECTOR_INTERVAL_MS).unref();
}
