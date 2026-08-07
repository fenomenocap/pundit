import { ModelFixture } from "./model-data";
import { FootballMatch } from "./football-data";
import { computeEvaluationMetrics, EvaluationFixture, EvaluationMetrics } from "./wc-evaluation";
import {
  readJsonFile,
  resolveDataPath,
  resolveRepoDataPath,
  writeJsonFileAtomic,
} from "./persistent-store";

export type ClubSeasonSnapshotMethod = "snapshot";

export interface ClubSeasonSnapshotFixture {
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
  result: {
    homeScore: number;
    awayScore: number;
    winner: "home" | "away" | "draw";
  } | null;
  method: ClubSeasonSnapshotMethod;
}

export interface ClubSeasonEvaluationArtifact {
  competitions: string[];
  method: ClubSeasonSnapshotMethod;
  builtAt: string;
  updatedAt: string;
  disclaimer: string;
  fixtures: ClubSeasonSnapshotFixture[];
  metrics: EvaluationMetrics;
}

// This history is the point of the artifact: it accumulates one pre-kickoff
// snapshot per fixture and can never be regenerated, because the probabilities
// were computed from ratings as they stood before kickoff. It therefore lives on
// the mounted volume rather than in the container image, which a deploy replaces.
const ARTIFACT_RELATIVE_PATH = "evaluation/club-season.json";

const DEFAULT_DISCLAIMER = "Pre-kickoff probabilities captured when fixtures leave the scheduled "
  + "window. Rolling club-season calibration — not a frozen backtest.";

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

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fixtureKey(competitionId: string, fixtureId: number): string {
  return `${competitionId}:${fixtureId}`;
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
  const finished = fixtures
    .map(toEvaluationFixture)
    .filter((fixture): fixture is EvaluationFixture => fixture !== null);
  return computeEvaluationMetrics(finished);
}

function emptyArtifact(): ClubSeasonEvaluationArtifact {
  const now = new Date().toISOString();
  return {
    competitions: ["eng.1", "uefa.champions_qual"],
    method: "snapshot",
    builtAt: now,
    updatedAt: now,
    disclaimer: DEFAULT_DISCLAIMER,
    fixtures: [],
    metrics: computeEvaluationMetrics([]),
  };
}

export function getClubSeasonEvaluationArtifactPath(): string {
  return resolveDataPath(ARTIFACT_RELATIVE_PATH);
}

export function loadClubSeasonEvaluationArtifact(): ClubSeasonEvaluationArtifact {
  // Falls back to the repo-committed copy when the volume has no history yet, so
  // a first deploy onto a fresh volume carries over whatever was shipped instead
  // of silently starting from zero.
  const parsed = readJsonFile<ClubSeasonEvaluationArtifact>(getClubSeasonEvaluationArtifactPath())
    ?? readJsonFile<ClubSeasonEvaluationArtifact>(resolveRepoDataPath(ARTIFACT_RELATIVE_PATH));
  if (!parsed) return emptyArtifact();
  return {
    ...parsed,
    metrics: computeArtifactMetrics(parsed.fixtures ?? []),
  };
}

export function buildSnapshotFromModel(
  fixture: ModelFixture,
  snapshottedAt: string
): ClubSeasonSnapshotFixture {
  return {
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
}

export function collectSnapshotTransitions(input: SnapshotTransitionInput): {
  keysToSnapshot: Set<string>;
  statusUpdates: Map<string, string>;
  snapshotModels: ModelFixture[];
} {
  const keysToSnapshot = new Set<string>();
  const statusUpdates = new Map<string, string>();
  const snapshotModels: ModelFixture[] = [];
  const modelByKey = new Map(
    input.modelFixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );

  for (const match of input.currentMatches) {
    const key = fixtureKey(match.competitionId, match.id);
    const previousStatus = input.previousStatusByKey.get(key);
    statusUpdates.set(key, match.status);

    const transitioned = previousStatus === "SCHEDULED"
      && (match.status === "IN_PLAY" || match.status === "FINISHED");
    if (!transitioned) continue;

    const modelFixture = modelByKey.get(key) ?? input.lastScheduledModelByKey.get(key);
    if (modelFixture) {
      keysToSnapshot.add(key);
      snapshotModels.push(modelFixture);
    }
  }

  return { keysToSnapshot, statusUpdates, snapshotModels };
}

export function mergeSnapshots(
  artifact: ClubSeasonEvaluationArtifact,
  modelFixtures: ModelFixture[],
  keysToSnapshot: Set<string>,
  snapshottedAt: string
): ClubSeasonEvaluationArtifact {
  const existing = new Map(
    artifact.fixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );
  const modelByKey = new Map(
    modelFixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
  );

  for (const key of keysToSnapshot) {
    const modelFixture = modelByKey.get(key);
    if (!modelFixture) continue;
    existing.set(key, buildSnapshotFromModel(modelFixture, snapshottedAt));
  }

  const fixtures = [...existing.values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  return {
    ...artifact,
    updatedAt: snapshottedAt,
    fixtures,
    metrics: computeArtifactMetrics(fixtures),
  };
}

export function persistClubSeasonEvaluationArtifact(artifact: ClubSeasonEvaluationArtifact): void {
  writeJsonFileAtomic(getClubSeasonEvaluationArtifactPath(), {
    ...artifact,
    metrics: computeArtifactMetrics(artifact.fixtures),
  });
}

// Tracks last-known fixture status and pre-kickoff model between refreshes.
let previousStatusByKey = new Map<string, string>();
let lastScheduledModelByKey = new Map<string, ModelFixture>();

export function resetClubSeasonSnapshotState(): void {
  previousStatusByKey = new Map();
  lastScheduledModelByKey = new Map();
}

export function updateClubSeasonSnapshots(
  currentMatches: FootballMatch[],
  modelFixtures: ModelFixture[]
): ClubSeasonEvaluationArtifact {
  const snapshottedAt = new Date().toISOString();
  const { keysToSnapshot, statusUpdates, snapshotModels } = collectSnapshotTransitions({
    previousStatusByKey,
    lastScheduledModelByKey,
    currentMatches,
    modelFixtures,
  });
  previousStatusByKey = statusUpdates;

  for (const match of currentMatches) {
    if (match.status !== "SCHEDULED") continue;
    const key = fixtureKey(match.competitionId, match.id);
    const modelFixture = modelFixtures.find(
      (fixture) => fixture.competitionId === match.competitionId && fixture.fixtureId === match.id
    );
    if (modelFixture) lastScheduledModelByKey.set(key, modelFixture);
  }

  let artifact = loadClubSeasonEvaluationArtifact();
  let shouldPersist = false;

  if (keysToSnapshot.size > 0) {
    artifact = mergeSnapshots(artifact, snapshotModels, keysToSnapshot, snapshottedAt);
    shouldPersist = true;
  }

  const finishedUpdates = currentMatches.filter(
    (match) => match.status === "FINISHED"
      && match.score?.home !== null
      && match.score?.away !== null
  );
  if (finishedUpdates.length > 0) {
    const byKey = new Map(
      artifact.fixtures.map((fixture) => [fixtureKey(fixture.competitionId, fixture.fixtureId), fixture])
    );
    let resultsUpdated = false;
    for (const match of finishedUpdates) {
      const key = fixtureKey(match.competitionId, match.id);
      const existing = byKey.get(key);
      if (!existing || existing.result) continue;
      existing.result = {
        homeScore: match.score!.home!,
        awayScore: match.score!.away!,
        winner: actualOutcome(match.score!.home!, match.score!.away!),
      };
      resultsUpdated = true;
    }
    if (resultsUpdated) {
      artifact = {
        ...artifact,
        updatedAt: snapshottedAt,
        fixtures: [...byKey.values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate)),
        metrics: computeArtifactMetrics([...byKey.values()]),
      };
      shouldPersist = true;
    }
  }

  if (shouldPersist) {
    persistClubSeasonEvaluationArtifact(artifact);
    if (keysToSnapshot.size > 0) {
      console.log(`[ClubSeason] Snapshotted ${keysToSnapshot.size} fixture(s). Total: ${artifact.fixtures.length}.`);
    }
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
  const keys = new Set(
    fixtures.map((fixture) => fixtureKey(fixture.competitionId, fixture.fixtureId))
  );
  const artifact = emptyArtifact();
  return mergeSnapshots(artifact, fixtures, keys, snapshottedAt);
}
