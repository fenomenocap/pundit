import { getCompetitionById } from "../config/competitions";
import { normalizeTeamName } from "../lib/team-names";
import { getCachedMatches, type FootballMatch } from "./football-data";
import type { ModelFixture } from "./model-data";
import { readJsonFile, resolveDataPath, writeJsonFileAtomic } from "./persistent-store";

export type FixtureCompetitionCategory =
  | "domestic-league"
  | "domestic-cup"
  | "club-continental"
  | "club-friendly"
  | "international-tournament"
  | "international-qualifier"
  | "international-friendly";

export type RecognizedFixtureStatus =
  | "scheduled"
  | "in-play"
  | "completed"
  | "postponed"
  | "cancelled";

export interface CanonicalTeam {
  id: string;
  name: string;
}

/**
 * A discovery hint only. Candidates can be shown as unrecognized, but must
 * never be persisted, used as grounding, or passed to the model.
 */
export interface FixtureCandidate {
  candidateId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff?: string;
  competition?: string;
  discoveredBy: "user" | "search";
}

export interface FixtureObservedSource {
  source: "espn" | "official-competition" | "official-federation" | "official-club";
  sourceFixtureId: string;
  authority: "authoritative" | "corroborating";
  observedAt: string;
}

export interface FixtureObservation {
  source: FixtureObservedSource["source"];
  sourceFixtureId: string;
  observedAt: string;
  kickoff: string;
  venue: string | null;
  neutralVenue: boolean | null;
  status: RecognizedFixtureStatus;
}

export interface RecognizedFixture {
  fixtureId: string;
  primarySource: FixtureObservedSource["source"];
  primarySourceFixtureId: string;
  homeTeam: CanonicalTeam;
  awayTeam: CanonicalTeam;
  kickoff: string;
  venue: string | null;
  neutralVenue: boolean | null;
  competition: {
    id: string;
    name: string;
    category: FixtureCompetitionCategory;
  };
  status: RecognizedFixtureStatus;
  recognition: "authoritative" | "corroborated";
  observedSources: FixtureObservedSource[];
  observationHistory: FixtureObservation[];
}

export type FixtureCapability =
  | { status: "priced"; modelFixtureId: string }
  | {
      status: "temporarily-unpriced";
      reason: "model-initializing" | "ratings-refreshing";
    }
  | {
      status: "outside-coverage";
      reason: "unsupported-competition" | "friendly-policy-disabled" | "model-policy-disabled";
    }
  | {
      status: "insufficient-model-input";
      reason: "ratings-unavailable" | "neutral-venue-unknown" | "required-context-missing";
    };

interface FixtureRegistryArtifact {
  schemaVersion: 1;
  updatedAt: string;
  fixtures: RecognizedFixture[];
}

const REGISTRY_FILE = "fixture-registry/recognized-fixtures-v1.json";
const LAST_GOOD_FILE = "fixture-registry/recognized-fixtures-v1.last-good.json";
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

let registry = new Map<string, RecognizedFixture>();
let updatedAt: Date | null = null;
let loadedFrom: "empty" | "primary" | "last-good" = "empty";
let timer: ReturnType<typeof setInterval> | null = null;
let lastError: string | null = null;

const ROUTING_PAST_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const ROUTING_FUTURE_HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

export function fixtureRegistryExpansionEnabled(): boolean {
  return process.env.FIXTURE_REGISTRY_ENABLED === "true";
}

function canonicalTeam(name: string): CanonicalTeam {
  return { id: normalizeTeamName(name), name };
}

function competitionCategory(competitionId: string): FixtureCompetitionCategory {
  if (/club(?:\.|-)?friendly|friendly\.club/i.test(competitionId)) return "club-friendly";
  if (/international(?:\.|-)?friendly|fifa\.friendly/i.test(competitionId)) {
    return "international-friendly";
  }
  if (/qual/i.test(competitionId) && !competitionId.startsWith("uefa.champions")) {
    return "international-qualifier";
  }
  if (competitionId === "eng.1") return "domestic-league";
  if (competitionId.startsWith("uefa.")) return "club-continental";
  if (competitionId.startsWith("fifa.")) return "international-tournament";
  const competition = getCompetitionById(competitionId);
  return competition?.type === "league" ? "domestic-league" : "domestic-cup";
}

function recognizedStatus(status: string): RecognizedFixtureStatus {
  if (status === "IN_PLAY") return "in-play";
  if (status === "FINISHED") return "completed";
  if (status === "POSTPONED") return "postponed";
  if (status === "CANCELLED") return "cancelled";
  return "scheduled";
}

export function recognizeEspnFixture(
  fixture: FootballMatch,
  observedAt = new Date().toISOString()
): RecognizedFixture {
  const sourceFixtureId = String(fixture.id);
  const source: FixtureObservedSource = {
    source: "espn",
    sourceFixtureId,
    authority: "authoritative",
    observedAt,
  };
  return {
    fixtureId: `espn:${fixture.competitionId}:${sourceFixtureId}`,
    primarySource: "espn",
    primarySourceFixtureId: sourceFixtureId,
    homeTeam: canonicalTeam(fixture.homeTeam),
    awayTeam: canonicalTeam(fixture.awayTeam),
    kickoff: fixture.utcDate,
    venue: fixture.venue ?? null,
    neutralVenue: fixture.neutralVenue ?? null,
    competition: {
      id: fixture.competitionId,
      name: fixture.competition,
      category: competitionCategory(fixture.competitionId),
    },
    status: recognizedStatus(fixture.status),
    recognition: "authoritative",
    observedSources: [source],
    observationHistory: [{
      source: "espn",
      sourceFixtureId,
      observedAt,
      kickoff: fixture.utcDate,
      venue: fixture.venue ?? null,
      neutralVenue: fixture.neutralVenue ?? null,
      status: recognizedStatus(fixture.status),
    }],
  };
}

export function isRecognizedFixture(value: unknown): value is RecognizedFixture {
  if (!value || typeof value !== "object") return false;
  const fixture = value as Partial<RecognizedFixture>;
  const validSources = new Set<FixtureObservedSource["source"]>([
    "espn",
    "official-competition",
    "official-federation",
    "official-club",
  ]);
  const validCategories = new Set<FixtureCompetitionCategory>([
    "domestic-league",
    "domestic-cup",
    "club-continental",
    "club-friendly",
    "international-tournament",
    "international-qualifier",
    "international-friendly",
  ]);
  const validStatuses = new Set<RecognizedFixtureStatus>([
    "scheduled",
    "in-play",
    "completed",
    "postponed",
    "cancelled",
  ]);
  const validInstant = (instant: unknown) =>
    typeof instant === "string" && Number.isFinite(Date.parse(instant));
  return typeof fixture.fixtureId === "string"
    && fixture.fixtureId.trim().length > 0
    && validSources.has(fixture.primarySource as FixtureObservedSource["source"])
    && typeof fixture.primarySourceFixtureId === "string"
    && fixture.primarySourceFixtureId.trim().length > 0
    && validInstant(fixture.kickoff)
    && (fixture.venue === null || typeof fixture.venue === "string")
    && (fixture.neutralVenue === null || typeof fixture.neutralVenue === "boolean")
    && typeof fixture.homeTeam?.id === "string"
    && fixture.homeTeam.id.trim().length > 0
    && typeof fixture.homeTeam?.name === "string"
    && fixture.homeTeam.name.trim().length > 0
    && typeof fixture.awayTeam?.id === "string"
    && fixture.awayTeam.id.trim().length > 0
    && typeof fixture.awayTeam?.name === "string"
    && fixture.awayTeam.name.trim().length > 0
    && typeof fixture.competition?.id === "string"
    && fixture.competition.id.trim().length > 0
    && typeof fixture.competition?.name === "string"
    && fixture.competition.name.trim().length > 0
    && validCategories.has(fixture.competition.category as FixtureCompetitionCategory)
    && validStatuses.has(fixture.status as RecognizedFixtureStatus)
    && Array.isArray(fixture.observedSources)
    && fixture.observedSources.length > 0
    && fixture.observedSources.every((source) =>
      validSources.has(source?.source)
      && typeof source.sourceFixtureId === "string"
      && source.sourceFixtureId.trim().length > 0
      && (source.authority === "authoritative" || source.authority === "corroborating")
      && validInstant(source.observedAt)
    )
    && Array.isArray(fixture.observationHistory)
    && fixture.observationHistory.length > 0
    && fixture.observationHistory.every((observation) =>
      validSources.has(observation?.source)
      && typeof observation.sourceFixtureId === "string"
      && observation.sourceFixtureId.trim().length > 0
      && validInstant(observation.observedAt)
      && validInstant(observation.kickoff)
      && (observation.venue === null || typeof observation.venue === "string")
      && (observation.neutralVenue === null || typeof observation.neutralVenue === "boolean")
      && validStatuses.has(observation.status)
    )
    && (fixture.recognition === "authoritative" || fixture.recognition === "corroborated");
}

function validArtifact(value: unknown): value is FixtureRegistryArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<FixtureRegistryArtifact>;
  return artifact.schemaVersion === 1
    && typeof artifact.updatedAt === "string"
    && Array.isArray(artifact.fixtures)
    && artifact.fixtures.every(isRecognizedFixture);
}

function artifactPath(lastGood = false): string {
  return resolveDataPath(lastGood ? LAST_GOOD_FILE : REGISTRY_FILE);
}

export function loadFixtureRegistry(): void {
  const primary = readJsonFile<unknown>(artifactPath());
  const fallback = validArtifact(primary)
    ? null
    : readJsonFile<unknown>(artifactPath(true));
  const artifact = validArtifact(primary)
    ? primary
    : validArtifact(fallback)
      ? fallback
      : null;
  registry = new Map(artifact?.fixtures.map((fixture) => [fixture.fixtureId, fixture]) ?? []);
  updatedAt = artifact ? new Date(artifact.updatedAt) : null;
  loadedFrom = validArtifact(primary) ? "primary" : artifact ? "last-good" : "empty";
}

function persistFixtureRegistry(): void {
  const artifact: FixtureRegistryArtifact = {
    schemaVersion: 1,
    updatedAt: (updatedAt ?? new Date()).toISOString(),
    fixtures: [...registry.values()].sort((a, b) =>
      a.kickoff.localeCompare(b.kickoff) || a.fixtureId.localeCompare(b.fixtureId)
    ),
  };
  writeJsonFileAtomic(artifactPath(), artifact);
  writeJsonFileAtomic(artifactPath(true), artifact);
}

export function refreshFixtureRegistryFromEspn(
  fixtures: FootballMatch[],
  now = new Date()
): RecognizedFixture[] {
  const observedIds = new Set<string>();
  for (const fixture of fixtures) {
    const recognized = recognizeEspnFixture(fixture, now.toISOString());
    observedIds.add(recognized.fixtureId);
    const previous = registry.get(recognized.fixtureId);
    const currentObservation = recognized.observationHistory[0];
    const lastObservation = previous?.observationHistory.at(-1);
    const materiallyChanged = !lastObservation
      || lastObservation.kickoff !== currentObservation.kickoff
      || lastObservation.venue !== currentObservation.venue
      || lastObservation.neutralVenue !== currentObservation.neutralVenue
      || lastObservation.status !== currentObservation.status;
    registry.set(recognized.fixtureId, {
      ...recognized,
      observedSources: recognized.observedSources,
      observationHistory: materiallyChanged
        ? [...(previous?.observationHistory ?? []), currentObservation].slice(-64)
        : previous?.observationHistory ?? recognized.observationHistory,
    });
  }
  const oldest = now.getTime() - ROUTING_PAST_HORIZON_MS;
  const newest = now.getTime() + ROUTING_FUTURE_HORIZON_MS;
  for (const [fixtureId, fixture] of registry) {
    const kickoff = new Date(fixture.kickoff).getTime();
    if (!observedIds.has(fixtureId)
      && (!Number.isFinite(kickoff) || kickoff < oldest || kickoff > newest)) {
      registry.delete(fixtureId);
    }
  }
  updatedAt = now;
  loadedFrom = "primary";
  persistFixtureRegistry();
  lastError = null;
  return getRecognizedFixtures();
}

export function getRecognizedFixtures(): RecognizedFixture[] {
  return [...registry.values()];
}

export function getRecognizedFixture(fixtureId: string): RecognizedFixture | undefined {
  return registry.get(fixtureId);
}

export function findRecognizedFixtureByTeams(
  teamA: string,
  teamB: string,
  fixtures: RecognizedFixture[] = getRecognizedFixtures()
): RecognizedFixture | undefined {
  const candidates = recognizedFixtureMatchesByTeams(teamA, teamB, fixtures);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function recognizedFixtureMatchesByTeams(
  teamA: string,
  teamB: string,
  fixtures: RecognizedFixture[] = getRecognizedFixtures()
): RecognizedFixture[] {
  const pair = new Set([normalizeTeamName(teamA), normalizeTeamName(teamB)]);
  const matching = fixtures.filter((fixture) =>
    pair.has(fixture.homeTeam.id) && pair.has(fixture.awayTeam.id)
  );
  const current = matching.filter((fixture) => fixture.status !== "completed");
  return current.length ? current : matching;
}

export function isModelPolicyEligible(fixture: RecognizedFixture): boolean {
  const competition = getCompetitionById(fixture.competition.id);
  return Boolean(competition?.enabled)
    && fixture.competition.category !== "club-friendly"
    && fixture.competition.category !== "international-friendly"
    && fixture.status !== "cancelled"
    && fixture.status !== "postponed";
}

export function modelFixtureId(fixture: Pick<ModelFixture, "competitionId" | "fixtureId">): string {
  return `${fixture.competitionId}:${fixture.fixtureId}`;
}

export interface CapabilityState {
  modelFixture?: ModelFixture;
  modelInitialized: boolean;
  modelRefreshing?: boolean;
  ratingsAvailable: boolean;
}

export function evaluateFixtureCapability(
  fixture: RecognizedFixture,
  state: CapabilityState
): FixtureCapability {
  if (fixture.competition.category === "club-friendly"
    || fixture.competition.category === "international-friendly") {
    return { status: "outside-coverage", reason: "friendly-policy-disabled" };
  }
  if (!getCompetitionById(fixture.competition.id)) {
    return { status: "outside-coverage", reason: "unsupported-competition" };
  }
  if (!isModelPolicyEligible(fixture)) {
    return { status: "outside-coverage", reason: "model-policy-disabled" };
  }
  if (state.modelFixture) {
    return { status: "priced", modelFixtureId: modelFixtureId(state.modelFixture) };
  }
  if (!state.modelInitialized) {
    return { status: "temporarily-unpriced", reason: "model-initializing" };
  }
  if (state.modelRefreshing) {
    return { status: "temporarily-unpriced", reason: "ratings-refreshing" };
  }
  if (!state.ratingsAvailable) {
    return { status: "insufficient-model-input", reason: "ratings-unavailable" };
  }
  return { status: "insufficient-model-input", reason: "required-context-missing" };
}

export function getFixtureRegistryStatus() {
  return {
    enabled: fixtureRegistryExpansionEnabled(),
    mode: fixtureRegistryExpansionEnabled() ? "enabled" as const : "shadow" as const,
    fixtureCount: registry.size,
    updatedAt: updatedAt?.toISOString() ?? null,
    loadedFrom,
    error: lastError,
  };
}

export function getRecognizedFixtureSnapshot(state: {
  modelFixtures: ModelFixture[];
  modelInitialized: boolean;
  modelRefreshing?: boolean;
  ratingsAvailable: boolean;
  missingRatingTeamIds?: ReadonlySet<string>;
}) {
  return {
    registry: getFixtureRegistryStatus(),
    fixtures: getRecognizedFixtures()
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.fixtureId.localeCompare(b.fixtureId))
      .map((fixture) => ({
        fixture,
        capability: evaluateFixtureCapability(fixture, {
          modelFixture: state.modelFixtures.find((model) =>
            model.competitionId === fixture.competition.id
            && String(model.fixtureId) === fixture.primarySourceFixtureId
          ),
          modelInitialized: state.modelInitialized,
          modelRefreshing: state.modelRefreshing,
          ratingsAvailable: state.ratingsAvailable
            && !state.missingRatingTeamIds?.has(fixture.homeTeam.id)
            && !state.missingRatingTeamIds?.has(fixture.awayTeam.id),
        }),
      })),
  };
}

function refreshFromFootballCache(): void {
  const football = getCachedMatches();
  refreshFixtureRegistryFromEspn([...football.upcoming, ...football.recent]);
}

export function refreshFixtureRegistryShadowSafely(): boolean {
  try {
    refreshFromFootballCache();
    lastError = null;
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error(`[FixtureRegistry] Shadow refresh failed: ${lastError}`);
    return false;
  }
}

export function startFixtureRegistryShadow(): void {
  try {
    loadFixtureRegistry();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error(`[FixtureRegistry] Last-good load failed: ${lastError}`);
  }
  refreshFixtureRegistryShadowSafely();
  if (timer) clearInterval(timer);
  timer = setInterval(refreshFixtureRegistryShadowSafely, REFRESH_INTERVAL_MS);
}

export function stopFixtureRegistryShadow(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test-only in-memory seam; production writes enter through approved sources. */
export function replaceFixtureRegistryForTests(fixtures: RecognizedFixture[]): void {
  registry = new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  updatedAt = new Date();
  loadedFrom = "empty";
  lastError = null;
}
