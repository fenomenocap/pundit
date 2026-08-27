import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendMarketComparisons,
  backupLegacyClubSeasonArtifact,
  buildSnapshotFromModel,
  collectSnapshotTransitions,
  loadClubSeasonEvaluationArtifact,
  mergeSnapshots,
  migrateClubSeasonEvaluationArtifact,
  persistClubSeasonEvaluationArtifact,
  resetClubSeasonSnapshotState,
  seedClubSeasonSnapshotState,
  updateClubSeasonSnapshots,
} from "./club-season-snapshots";
import type { ModelFixture } from "./model-data";
import { ELO_CHAMPION_CONFIG } from "./model-contributors";

const originalDataDir = process.env.PUNDIT_DATA_DIR;
let tempDataDir: string | null = null;

const sampleModelFixture = (overrides: Partial<ModelFixture> = {}): ModelFixture => ({
  competitionId: "eng.1",
  competition: "Premier League",
  fixtureId: 101,
  utcDate: "2026-08-15T14:00:00.000Z",
  date: "2026-08-15",
  group: null,
  stage: "match",
  home: "Arsenal",
  away: "Liverpool",
  homeElo: 1850,
  awayElo: 1840,
  pHome: 0.42,
  pDraw: 0.28,
  pAway: 0.30,
  pOver2_5: 0.55,
  pUnder2_5: 0.45,
  pBttsYes: 0.58,
  pBttsNo: 0.42,
  topScores: [{ score: "1-1", probability: 0.12 }],
  scorelines: [{ score: "1-1", probability: 0.12 }],
  stakePHome: null,
  stakePDraw: null,
  stakePAway: null,
  result: null,
  forecastProvenance: {
    modelId: "pundit-fundamental",
    modelVersion: "1",
    contributorId: "clubelo",
    contributorVersion: "1",
    methodId: "clubelo-elo-to-goals-dixon-coles",
    forecastAt: "2026-08-15T13:30:00.000Z",
    ratingProfile: "eng-clubs",
    ratingSnapshotAt: "2026-08-15T13:00:00.000Z",
    ratingAgeMinutes: 30,
    ratingSourceState: "live",
    homeAdvantageElo: 42,
    config: ELO_CHAMPION_CONFIG,
  },
  ...overrides,
});

describe("club-season snapshots", () => {
  beforeEach(() => {
    resetClubSeasonSnapshotState();
  });

  afterEach(() => {
    if (tempDataDir) fs.rmSync(tempDataDir, { recursive: true, force: true });
    tempDataDir = null;
    if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
    else process.env.PUNDIT_DATA_DIR = originalDataDir;
  });

  it("detects scheduled-to-in-play transitions", () => {
    const previousStatusByKey = new Map([["eng.1:101", "SCHEDULED"]]);
    const lastScheduledModelByKey = new Map([["eng.1:101", sampleModelFixture()]]);
    const { keysToSnapshot, snapshotModels } = collectSnapshotTransitions({
      previousStatusByKey,
      lastScheduledModelByKey,
      currentMatches: [{
        id: 101,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Liverpool",
        utcDate: "2026-08-15T14:00:00.000Z",
        status: "IN_PLAY",
        stage: null,
        matchday: 1,
        group: null,
        score: { home: 0, away: 0 },
      }],
      modelFixtures: [],
    });
    expect([...keysToSnapshot]).toEqual(["eng.1:101"]);
    expect(snapshotModels).toHaveLength(1);
  });

  it("captures inside the deterministic pre-kickoff window without a status transition", () => {
    const { keysToSnapshot, checkpointReasons } = collectSnapshotTransitions({
      previousStatusByKey: new Map(),
      lastScheduledModelByKey: new Map(),
      currentMatches: [sampleMatch()],
      modelFixtures: [sampleModelFixture()],
      now: new Date("2026-08-15T13:15:00.000Z"),
    });
    expect([...keysToSnapshot]).toEqual(["eng.1:101"]);
    expect(checkpointReasons.get("eng.1:101")).toBe("scheduled_window");
  });

  it("uses cached scheduled model when fixture already left active set", () => {
    const cached = sampleModelFixture();
    const { keysToSnapshot, snapshotModels } = collectSnapshotTransitions({
      previousStatusByKey: new Map([["eng.1:101", "SCHEDULED"]]),
      lastScheduledModelByKey: new Map([["eng.1:101", cached]]),
      currentMatches: [{
        id: 101,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Liverpool",
        utcDate: "2026-08-15T14:00:00.000Z",
        status: "FINISHED",
        stage: null,
        matchday: 1,
        group: null,
        score: { home: 2, away: 1 },
      }],
      modelFixtures: [],
    });
    expect([...keysToSnapshot]).toEqual(["eng.1:101"]);
    expect(snapshotModels[0]).toEqual(cached);
  });

  it("ignores fixtures that were already in play", () => {
    const previousStatusByKey = new Map([["eng.1:101", "IN_PLAY"]]);
    const { keysToSnapshot } = collectSnapshotTransitions({
      previousStatusByKey,
      lastScheduledModelByKey: new Map(),
      currentMatches: [{
        id: 101,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam: "Arsenal",
        awayTeam: "Liverpool",
        utcDate: "2026-08-15T14:00:00.000Z",
        status: "FINISHED",
        stage: null,
        matchday: 1,
        group: null,
        score: { home: 2, away: 1 },
      }],
      modelFixtures: [sampleModelFixture()],
    });
    expect(keysToSnapshot.size).toBe(0);
  });

  it("merges new snapshots without dropping existing rows", () => {
    const snapshottedAt = "2026-08-15T13:59:00.000Z";
    const artifact = seedClubSeasonSnapshotState([], [sampleModelFixture()], snapshottedAt);
    const merged = mergeSnapshots(
      artifact,
      [sampleModelFixture({ fixtureId: 102, home: "Chelsea", away: "Tottenham Hotspur" })],
      new Set(["eng.1:102"]),
      "2026-08-16T13:59:00.000Z"
    );
    expect(merged.fixtures).toHaveLength(2);
    expect(merged.fixtures.map((fixture) => fixture.fixtureId).sort()).toEqual([101, 102]);
  });

  it("never overwrites an already sealed forecast with a later recalculation", () => {
    const first = seedClubSeasonSnapshotState(
      [],
      [sampleModelFixture()],
      "2026-08-15T13:31:00.000Z"
    );
    const merged = mergeSnapshots(
      first,
      [sampleModelFixture({ pHome: 0.99, pDraw: 0.005, pAway: 0.005 })],
      new Set(["eng.1:101"]),
      "2026-08-15T13:45:00.000Z"
    );
    expect(merged.fixtures).toHaveLength(1);
    expect(merged.fixtures[0].pHome).toBe(0.42);
    expect(merged.fixtures[0].forecastId).toBe(first.fixtures[0].forecastId);
  });

  it("keys identity by contributor version and checkpoint, not refresh time", () => {
    const first = seedClubSeasonSnapshotState(
      [],
      [sampleModelFixture()],
      "2026-08-15T13:31:00.000Z"
    );
    const repeated = mergeSnapshots(
      first,
      [sampleModelFixture({
        pHome: 0.99,
        forecastProvenance: {
          ...sampleModelFixture().forecastProvenance!,
          forecastAt: "2026-08-15T13:45:00.000Z",
        },
      })],
      new Set(["eng.1:101"]),
      "2026-08-15T13:45:00.000Z"
    );
    expect(repeated.fixtures).toHaveLength(1);
    expect(repeated.fixtures[0].pHome).toBe(0.42);

    const withDistinctContributor = mergeSnapshots(
      repeated,
      [sampleModelFixture({
        pHome: 0.5,
        forecastProvenance: {
          ...sampleModelFixture().forecastProvenance!,
          contributorId: "offline-test-contributor",
          contributorVersion: "2",
          forecastAt: "2026-08-15T13:45:00.000Z",
        },
      })],
      new Set(["eng.1:101"]),
      "2026-08-15T13:45:00.000Z"
    );
    expect(withDistinctContributor.fixtures).toHaveLength(2);
    expect(new Set(withDistinctContributor.fixtures.map((fixture) => fixture.forecastId)).size)
      .toBe(2);
  });

  it("builds snapshot rows with method snapshot", () => {
    const snapshot = buildSnapshotFromModel(sampleModelFixture(), "2026-08-15T13:59:00.000Z");
    expect(snapshot.method).toBe("snapshot");
    expect(snapshot.pHome).toBe(0.42);
    expect(snapshot.result).toBeNull();
    expect(snapshot.provenanceCompleteness).toBe("complete");
    expect(snapshot.inputs).toMatchObject({
      homeRating: 1850,
      awayRating: 1840,
      ratingSnapshotAt: "2026-08-15T13:00:00.000Z",
      ratingAgeMinutes: 30,
      ratingSourceState: "live",
      homeAdvantageElo: 42,
    });
    expect(snapshot.modelId).toBe("pundit-fundamental");
  });

  it("migrates old rows without inventing missing provenance", () => {
    const legacy = buildSnapshotFromModel(sampleModelFixture(), "2026-08-15T13:59:00.000Z");
    const { schemaVersion: _schema, forecastId: _id, forecastAt: _forecastAt,
      checkpointPolicyId: _policy, checkpointReason: _reason, modelId: _model,
      modelVersion: _modelVersion, contributorId: _contributor,
      contributorVersion: _contributorVersion, methodId: _method,
      provenanceCompleteness: _completeness, inputs: _inputs,
      marketComparisons: _markets, ...oldRow } = legacy;
    const migrated = migrateClubSeasonEvaluationArtifact({
      builtAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-15T13:59:00.000Z",
      fixtures: [oldRow],
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.fixtures[0]).toMatchObject({
      schemaVersion: 1,
      provenanceCompleteness: "legacy_partial",
      inputs: { ratingSnapshotAt: null, ratingAgeMinutes: null },
    });
    expect(migrated.metrics).toMatchObject({
      fixtureCount: 0,
      brierScore: null,
      logLoss: null,
      winnerAccuracy: null,
    });
    expect(migrated.evaluation.exclusions).toEqual({
      total: 1,
      byReason: {
        legacyPartialProvenance: 1,
        incompleteInputProvenance: 0,
        postKickoffForecast: 0,
        invalidForecastTimestamp: 0,
      },
    });
  });

  it("preserves but excludes a forecast whose rating source provenance is incomplete", () => {
    const row = buildSnapshotFromModel(sampleModelFixture({
      result: { homeScore: 2, awayScore: 1, status: "FINISHED", winner: "Arsenal" },
      forecastProvenance: {
        ...sampleModelFixture().forecastProvenance!,
        ratingSnapshotAt: null,
        ratingAgeMinutes: null,
        ratingSourceState: "unknown",
      },
    }), "2026-08-15T13:31:00.000Z");
    const artifact = migrateClubSeasonEvaluationArtifact({ fixtures: [row] });
    expect(artifact.fixtures[0].provenanceCompleteness).toBe("source_partial");
    expect(artifact.metrics.fixtureCount).toBe(0);
    expect(artifact.evaluation.exclusions.byReason.incompleteInputProvenance).toBe(1);
  });

  it("excludes artifact-backed forecasts without matching immutable identity provenance", () => {
    const completeSha = "a".repeat(64);
    const makeRow = (ratingArtifactId?: string, ratingArtifactSha256?: string) =>
      buildSnapshotFromModel(sampleModelFixture({
        result: { homeScore: 2, awayScore: 1, status: "FINISHED", winner: "Arsenal" },
        forecastProvenance: {
          ...sampleModelFixture().forecastProvenance!,
          ratingSourceState: "artifact",
          ratingArtifactId,
          ratingArtifactSha256,
        },
      }), "2026-08-15T13:31:00.000Z");

    for (const row of [
      makeRow(),
      makeRow(`clubelo@1:${completeSha}`, "b".repeat(64)),
      makeRow(`clubelo@1:${completeSha}`, "not-a-sha"),
    ]) {
      const artifact = migrateClubSeasonEvaluationArtifact({ fixtures: [row] });
      expect(artifact.fixtures[0].provenanceCompleteness).toBe("source_partial");
      expect(artifact.metrics.fixtureCount).toBe(0);
      expect(artifact.evaluation.exclusions.byReason.incompleteInputProvenance).toBe(1);
    }

    const valid = migrateClubSeasonEvaluationArtifact({
      fixtures: [makeRow(`clubelo@1:${completeSha}`, completeSha)],
    });
    expect(valid.fixtures[0].provenanceCompleteness).toBe("complete");
    expect(valid.metrics.fixtureCount).toBe(1);
  });

  it("timestamp-backs up the exact legacy bytes before migration persistence", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const legacy = "{\"fixtures\":[]}\n";
    fs.writeFileSync(target, legacy, "utf8");
    expect(loadClubSeasonEvaluationArtifact().fixtures).toEqual([]);
    const backup = backupLegacyClubSeasonArtifact(new Date("2026-08-12T01:02:03.004Z"));
    expect(backup).toBe(path.join(
      tempDataDir!,
      "evaluation",
      "club-season.json.backup-2026-08-12T01-02-03.004Z"
    ));
    expect(fs.readFileSync(backup!, "utf8")).toBe(legacy);
    expect(fs.readFileSync(target, "utf8")).toBe(legacy);
  });

  it("uses the repository seed only when the configured ledger is absent", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");

    const artifact = loadClubSeasonEvaluationArtifact();

    expect(artifact.fixtures).toEqual([]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("fails closed on corrupt configured bytes without seeding or creating a backup", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const corrupt = "{broken\n";
    fs.writeFileSync(target, corrupt, "utf8");

    expect(() => loadClubSeasonEvaluationArtifact()).toThrow(/Invalid configured ledger JSON/);
    expect(() => persistClubSeasonEvaluationArtifact(migrateClubSeasonEvaluationArtifact(null)))
      .toThrow(/Invalid configured ledger JSON/);

    expect(fs.readFileSync(target, "utf8")).toBe(corrupt);
    expect(fs.readdirSync(path.dirname(target))
      .filter((entry) => entry.startsWith("club-season.json.backup-"))).toEqual([]);
  });

  it("fails closed on an unreadable configured ledger path without writing", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(target, { recursive: true });

    expect(() => loadClubSeasonEvaluationArtifact()).toThrow(/Cannot read configured ledger/);
    expect(() => persistClubSeasonEvaluationArtifact(migrateClubSeasonEvaluationArtifact(null)))
      .toThrow(/Cannot read configured ledger/);
    expect(fs.readdirSync(path.dirname(target))
      .filter((entry) => entry.startsWith("club-season.json.backup-"))).toEqual([]);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("fails closed on a schema-invalid configured ledger", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const invalid = JSON.stringify({ fixtures: { not: "an array" } });
    fs.writeFileSync(target, invalid, "utf8");

    expect(() => loadClubSeasonEvaluationArtifact()).toThrow(/Invalid configured ledger schema/);
    expect(() => persistClubSeasonEvaluationArtifact(migrateClubSeasonEvaluationArtifact(null)))
      .toThrow(/Invalid configured ledger schema/);
    expect(fs.readFileSync(target, "utf8")).toBe(invalid);
    expect(fs.readdirSync(path.dirname(target))
      .filter((entry) => entry.startsWith("club-season.json.backup-"))).toEqual([]);
  });

  it("rejects a truncated schema-v2 envelope without replacing its bytes", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    const valid = seedClubSeasonSnapshotState(
      [],
      [sampleModelFixture()],
      "2026-08-15T13:31:00.000Z"
    );
    persistClubSeasonEvaluationArtifact(valid);
    const truncated = JSON.stringify({ schemaVersion: 2, fixtures: [] });
    fs.writeFileSync(target, truncated, "utf8");

    expect(() => loadClubSeasonEvaluationArtifact()).toThrow(/Invalid configured ledger schema/);
    expect(() => persistClubSeasonEvaluationArtifact(migrateClubSeasonEvaluationArtifact(null)))
      .toThrow(/Invalid configured ledger schema/);
    expect(fs.readFileSync(target, "utf8")).toBe(truncated);
    expect(fs.readdirSync(path.dirname(target))
      .filter((entry) => entry.startsWith("club-season.json.backup-"))).toEqual([]);
  });

  it("migrates a fixtures-only configured ledger with source-partial v2 rows", () => {
    useTempDataDir();
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    const row = buildSnapshotFromModel(sampleModelFixture({
      forecastProvenance: {
        ...sampleModelFixture().forecastProvenance!,
        ratingSnapshotAt: null,
        ratingAgeMinutes: null,
        ratingSourceState: "unknown",
      },
    }), "2026-08-15T13:31:00.000Z");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ fixtures: [row] }), "utf8");

    const artifact = loadClubSeasonEvaluationArtifact();

    expect(artifact.fixtures).toHaveLength(1);
    expect(artifact.fixtures[0].provenanceCompleteness).toBe("source_partial");
    expect(artifact.metrics.fixtureCount).toBe(0);
  });

  it("does not consume transition state before a failed durable read", () => {
    useTempDataDir();
    const scheduled = sampleMatch();
    const model = sampleModelFixture();
    seedClubSeasonSnapshotState([scheduled], [model], "2026-08-15T13:31:00.000Z");

    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{broken\n", "utf8");
    const inPlay = sampleMatch({ status: "IN_PLAY", score: { home: 0, away: 0 } });

    expect(() => updateClubSeasonSnapshots(
      [inPlay],
      [],
      new Date("2026-08-15T14:01:00.000Z")
    )).toThrow(/Invalid configured ledger JSON/);

    fs.writeFileSync(target, JSON.stringify({ fixtures: [] }), "utf8");
    const recovered = updateClubSeasonSnapshots(
      [inPlay],
      [],
      new Date("2026-08-15T14:01:00.000Z")
    );

    expect(recovered.fixtures).toHaveLength(1);
    expect(recovered.fixtures[0].checkpointReason).toBe("pre_kickoff_cached_fallback");
  });

  it("keeps transition state available when a durable write fails once", () => {
    useTempDataDir();
    const scheduled = sampleMatch();
    const model = sampleModelFixture();
    seedClubSeasonSnapshotState([scheduled], [model], "2026-08-15T13:31:00.000Z");
    const inPlay = sampleMatch({ status: "IN_PLAY", score: { home: 0, away: 0 } });
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated durable write failure");
    });

    try {
      expect(() => updateClubSeasonSnapshots(
        [inPlay],
        [],
        new Date("2026-08-15T14:01:00.000Z")
      )).toThrow(/simulated durable write failure/);
    } finally {
      renameSpy.mockRestore();
    }

    const recovered = updateClubSeasonSnapshots(
      [inPlay],
      [],
      new Date("2026-08-15T14:01:00.000Z")
    );

    expect(recovered.fixtures).toHaveLength(1);
    expect(recovered.fixtures[0].checkpointReason).toBe("pre_kickoff_cached_fallback");
    expect(loadClubSeasonEvaluationArtifact().fixtures[0].checkpointReason)
      .toBe("pre_kickoff_cached_fallback");
  });

  it("excludes a post-kickoff forecast from official metrics", () => {
    const row = buildSnapshotFromModel(sampleModelFixture({
      result: { homeScore: 2, awayScore: 1, status: "FINISHED", winner: "Arsenal" },
      forecastProvenance: {
        ...sampleModelFixture().forecastProvenance!,
        forecastAt: "2026-08-15T14:00:00.000Z",
      },
    }), "2026-08-15T14:01:00.000Z");
    const artifact = migrateClubSeasonEvaluationArtifact({ fixtures: [row] });
    expect(artifact.fixtures).toHaveLength(1);
    expect(artifact.metrics.fixtureCount).toBe(0);
    expect(artifact.evaluation.exclusions.byReason.postKickoffForecast).toBe(1);
  });

  it("records an idempotent missed checkpoint when no eligible forecast was captured", () => {
    useTempDataDir();
    updateClubSeasonSnapshots(
      [sampleMatch()],
      [sampleModelFixture({
        forecastProvenance: {
          ...sampleModelFixture().forecastProvenance!,
          forecastAt: "2026-08-15T10:00:00.000Z",
        },
      })],
      new Date("2026-08-15T10:00:00.000Z")
    );
    const inPlay = sampleMatch({ status: "IN_PLAY", score: { home: 0, away: 0 } });
    updateClubSeasonSnapshots(inPlay ? [inPlay] : [], [], new Date("2026-08-15T14:01:00.000Z"));
    updateClubSeasonSnapshots(inPlay ? [inPlay] : [], [], new Date("2026-08-15T14:02:00.000Z"));
    const artifact = loadClubSeasonEvaluationArtifact();
    expect(artifact.fixtures).toHaveLength(0);
    expect(artifact.missedCheckpoints).toHaveLength(1);
    expect(artifact.missedCheckpoints[0].reason).toBe("no_eligible_pre_kickoff_forecast");
  });

  it("records a missed checkpoint when restart first observes the fixture after kickoff", () => {
    useTempDataDir();
    resetClubSeasonSnapshotState();
    const inPlay = sampleMatch({ status: "IN_PLAY", score: { home: 0, away: 0 } });

    updateClubSeasonSnapshots([inPlay], [], new Date("2026-08-15T14:01:00.000Z"));
    resetClubSeasonSnapshotState();
    updateClubSeasonSnapshots([inPlay], [], new Date("2026-08-15T14:02:00.000Z"));

    const artifact = loadClubSeasonEvaluationArtifact();
    expect(artifact.fixtures).toHaveLength(0);
    expect(artifact.missedCheckpoints).toHaveLength(1);
    expect(artifact.missedCheckpoints[0]).toMatchObject({
      fixtureId: 101,
      reason: "no_eligible_pre_kickoff_forecast",
    });
  });

  it("appends timestamped market evidence without changing the sealed probabilities", () => {
    useTempDataDir();
    const sealed = seedClubSeasonSnapshotState(
      [],
      [sampleModelFixture()],
      "2026-08-15T13:31:00.000Z"
    );
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(sealed)}\n`, "utf8");
    const rows = new Map([["eng.1:101", [{
      source: "kalshi" as const,
      sourceTimestamp: "2026-08-15T13:35:00.000Z",
      pHome: 0.4,
      pDraw: 0.3,
      pAway: 0.3,
    }]]]);
    appendMarketComparisons(rows, new Date("2026-08-15T13:35:00.000Z"));
    appendMarketComparisons(rows, new Date("2026-08-15T13:36:00.000Z"));
    const artifact = loadClubSeasonEvaluationArtifact();
    expect(artifact.fixtures[0].pHome).toBe(0.42);
    expect(artifact.fixtures[0].marketComparisons).toHaveLength(1);
  });

  it("appends later result evidence to every matching immutable forecast", () => {
    useTempDataDir();
    const champion = seedClubSeasonSnapshotState(
      [],
      [sampleModelFixture()],
      "2026-08-15T13:31:00.000Z"
    );
    const ledger = mergeSnapshots(
      champion,
      [sampleModelFixture({
        pHome: 0.5,
        forecastProvenance: {
          ...sampleModelFixture().forecastProvenance!,
          contributorId: "offline-test-contributor",
          contributorVersion: "2",
        },
      })],
      new Set(["eng.1:101"]),
      "2026-08-15T13:32:00.000Z"
    );
    const target = path.join(tempDataDir!, "evaluation", "club-season.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(ledger)}\n`, "utf8");
    resetClubSeasonSnapshotState();
    updateClubSeasonSnapshots([
      sampleMatch({ status: "FINISHED", score: { home: 2, away: 1 } }),
    ], [], new Date("2026-08-15T16:00:00.000Z"));
    const completed = loadClubSeasonEvaluationArtifact();
    expect(completed.fixtures).toHaveLength(2);
    expect(completed.fixtures.every((fixture) => fixture.result?.winner === "home")).toBe(true);
    expect(new Set(completed.fixtures.map((fixture) => fixture.pHome))).toEqual(new Set([0.42, 0.5]));
  });
});

function sampleMatch(overrides: Partial<import("./football-data").FootballMatch> = {}) {
  return {
    id: 101,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    utcDate: "2026-08-15T14:00:00.000Z",
    status: "SCHEDULED",
    stage: null,
    matchday: 1,
    group: null,
    score: null,
    ...overrides,
  };
}

function useTempDataDir(): void {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-ledger-"));
  process.env.PUNDIT_DATA_DIR = tempDataDir;
}
