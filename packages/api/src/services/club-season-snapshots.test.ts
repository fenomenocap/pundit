import { describe, expect, it, beforeEach } from "vitest";
import {
  buildSnapshotFromModel,
  collectSnapshotTransitions,
  mergeSnapshots,
  resetClubSeasonSnapshotState,
  seedClubSeasonSnapshotState,
} from "./club-season-snapshots";
import type { ModelFixture } from "./model-data";

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
  ...overrides,
});

describe("club-season snapshots", () => {
  beforeEach(() => {
    resetClubSeasonSnapshotState();
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

  it("builds snapshot rows with method snapshot", () => {
    const snapshot = buildSnapshotFromModel(sampleModelFixture(), "2026-08-15T13:59:00.000Z");
    expect(snapshot.method).toBe("snapshot");
    expect(snapshot.pHome).toBe(0.42);
    expect(snapshot.result).toBeNull();
  });
});
