import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ActiveFixture } from "./active-fixtures";
import { backfillMissingClubRatings, getCachedClubRatings } from "./club-ratings";
import {
  MODEL_COLD_RETRY_MS,
  MODEL_REFRESH_INTERVAL_MS,
  buildActiveModelFixtures,
  buildModelFixtureFromActive,
  findMissingClubRatingTeams,
  getCachedModelData,
  getModelRefreshState,
  modelDataCoversActiveFixtures,
  modelRefreshDelay,
  refreshModelData,
} from "./model-data";

vi.mock("./club-ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./club-ratings")>();
  return {
    ...actual,
    getCachedClubRatings: vi.fn(),
    backfillMissingClubRatings: vi.fn(),
  };
});

function activeFixture(overrides: Partial<ActiveFixture> = {}): ActiveFixture {
  return {
    id: 1,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Coventry City",
    utcDate: "2026-08-02T15:00:00.000Z",
    status: "SCHEDULED",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    neutralVenue: false,
    featured: false,
    ...overrides,
  };
}

const ratings = {
  world: new Map<string, number>(),
  "eng-clubs": new Map([
    ["Arsenal", 1850],
    ["Coventry", 1600],
  ]),
  "uefa-clubs": new Map([
    ["Arsenal", 1850],
    ["Coventry", 1600],
  ]),
};

describe("active club model", () => {
  beforeEach(() => {
    vi.mocked(getCachedClubRatings).mockReset();
    // Recovers nothing by default, so these cases exercise the unrated path
    // rather than reaching ClubElo's per-club feeds over the network.
    vi.mocked(backfillMissingClubRatings).mockReset().mockResolvedValue([]);
  });

  it("builds Dixon-Coles probabilities for an active fixture", () => {
    const model = buildModelFixtureFromActive(activeFixture(), ratings);
    expect(model).toMatchObject({
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Coventry City",
      homeElo: 1850,
      awayElo: 1600,
    });
    expect(model!.pHome + model!.pDraw + model!.pAway).toBeCloseTo(1, 4);
    expect(model!.pHome).toBeGreaterThan(model!.pAway);
  });

  it("does not construct a model row until neutral-venue state is known", () => {
    expect(buildModelFixtureFromActive(
      activeFixture({ neutralVenue: null }), ratings
    )).toBeNull();
    const neutral = buildModelFixtureFromActive(
      activeFixture({ neutralVenue: true }), ratings
    );
    expect(neutral?.forecastProvenance?.homeAdvantageElo).toBe(0);
  });

  it("preserves the exact deployed supported-fixture probability payload behind recognition", () => {
    const model = buildModelFixtureFromActive(activeFixture(), ratings, {
      forecastAt: new Date("2026-08-01T00:00:00.000Z"),
    })!;
    const protectedPayload = {
      pHome: model.pHome,
      pDraw: model.pDraw,
      pAway: model.pAway,
      pOver2_5: model.pOver2_5,
      pUnder2_5: model.pUnder2_5,
      pBttsYes: model.pBttsYes,
      pBttsNo: model.pBttsNo,
      topScores: model.topScores,
      scorelines: model.scorelines,
    };
    expect(createHash("sha256").update(JSON.stringify(protectedPayload)).digest("hex"))
      .toBe("d2dc2168b25f823cd681db912dc044914bde10b80e523f03f03d6720197590bb");
  });

  it("does not fabricate a default rating when a team is missing from ClubElo", () => {
    const model = buildModelFixtureFromActive(
      activeFixture({ awayTeam: "Unknown FC" }),
      ratings
    );
    expect(model).toBeNull();
  });

  it("reports the exact active teams missing from a ratings snapshot", () => {
    expect(findMissingClubRatingTeams([
      activeFixture({ awayTeam: "Unknown FC" }),
      activeFixture({ id: 2, homeTeam: "Another Missing FC" }),
    ], ratings)).toEqual(["Another Missing FC", "Unknown FC"]);
  });

  it("returns only fixtures for enabled competitions", () => {
    const fixtures = buildActiveModelFixtures([
      activeFixture(),
      activeFixture({
        id: 2,
        competitionId: "fifa.world",
        competition: "FIFA World Cup",
        homeTeam: "Spain",
        awayTeam: "Argentina",
      }),
    ], ratings);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].competitionId).toBe("eng.1");
  });

  it("marks a legitimate zero-active-fixture refresh ready without ratings", async () => {
    await refreshModelData([]);

    const cached = getCachedModelData();
    expect(getCachedClubRatings).not.toHaveBeenCalled();
    expect(cached.fixtures).toEqual([]);
    expect(cached.lastUpdated).toBeInstanceOf(Date);
    expect(cached.error).toBeNull();
  });

  it("keeps active fixtures unready when no ratings have ever loaded", async () => {
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: {
        world: new Map(),
        "eng-clubs": new Map(),
        "uefa-clubs": new Map(),
      },
      fetchedAt: null,
      error: "network unavailable",
      staleRatings: [],
      servingPersisted: false,
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toEqual([]);
    expect(cached.error).toBe("Club ratings are not ready: network unavailable");
  });

  it("skips a fixture whose team the ratings snapshot does not name", async () => {
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: {
        world: new Map(),
        "eng-clubs": new Map([["Arsenal", 1850]]),
        "uefa-clubs": new Map([["Arsenal", 1850]]),
      },
      fetchedAt: new Date("2026-07-27T00:00:00.000Z"),
      error: null,
      staleRatings: [],
      servingPersisted: false,
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toEqual([]);
    expect(cached.error).toBe(
      "Club ratings are missing for 1 active team(s): Coventry City."
      + " 1 fixture(s) are unpriced as a result."
    );
    expect(getModelRefreshState()).toEqual({
      refreshing: false,
      missingRatingTeamIds: new Set(["coventry"]),
    });
  });

  it("prices the fixtures it can when only some teams are unrated", async () => {
    // The regression this guards: an unrated team used to throw, discarding
    // every fixture in the window. A live qualifying round with five unmatched
    // names consequently left all twenty fixtures unpriced and the match tier
    // unreachable.
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: {
        world: new Map(),
        "eng-clubs": new Map([["Arsenal", 1850], ["Coventry", 1600]]),
        "uefa-clubs": new Map([["Arsenal", 1850], ["Coventry", 1600]]),
      },
      fetchedAt: new Date("2026-07-27T00:00:00.000Z"),
      error: null,
      staleRatings: [],
      servingPersisted: false,
    });

    await refreshModelData([
      activeFixture(),
      activeFixture({ id: 2, homeTeam: "Bodo/Glimt", awayTeam: "Olympiacos" }),
    ]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toHaveLength(1);
    expect(cached.fixtures[0].home).toBe("Arsenal");
    expect(cached.lastUpdated).not.toBeNull();
    expect(cached.error).toContain("Bodo/Glimt");
    expect(cached.error).toContain("1 fixture(s) are unpriced");
  });

  it("uses retained last-good ratings after a provider refresh error", async () => {
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: ratings,
      fetchedAt: new Date("2026-07-27T00:00:00.000Z"),
      error: "latest refresh timed out",
      staleRatings: [],
      servingPersisted: false,
      artifactId: "clubelo@1:test-artifact",
      artifactSha256: "test-artifact",
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toHaveLength(1);
    expect(cached.fixtures[0]).toMatchObject({ homeElo: 1850, awayElo: 1600 });
    expect(cached.fixtures[0].forecastProvenance).toMatchObject({
      ratingSourceState: "artifact",
      ratingArtifactId: "clubelo@1:test-artifact",
      ratingArtifactSha256: "test-artifact",
    });
    expect(cached.error).toBeNull();
  });

  it("does not misattribute a per-club fallback rating to the daily snapshot", () => {
    const model = buildModelFixtureFromActive(activeFixture(), ratings, {
      forecastAt: new Date("2026-08-02T12:00:00.000Z"),
      ratingSnapshotAt: new Date("2026-08-02T11:00:00.000Z"),
      ratingSourceState: "live",
      fallbackRatingClubs: new Set(["Coventry"]),
    });

    expect(model).not.toBeNull();
    expect(model!.homeElo).toBe(1850);
    expect(model!.awayElo).toBe(1600);
    expect(model!.forecastProvenance).toMatchObject({
      ratingSnapshotAt: null,
      ratingAgeMinutes: null,
      ratingSourceState: "unknown",
    });
  });

  it("marks refreshed model provenance unknown when backfill supplies an input", async () => {
    const fetchedAt = new Date("2026-08-02T11:00:00.000Z");
    vi.mocked(getCachedClubRatings)
      .mockReturnValueOnce({
        byProfile: {
          world: new Map(),
          "eng-clubs": new Map([["Arsenal", 1850]]),
          "uefa-clubs": new Map([["Arsenal", 1850]]),
        },
        fetchedAt,
        error: null,
        staleRatings: [],
        servingPersisted: false,
      })
      .mockReturnValue({
        byProfile: ratings,
        fetchedAt,
        error: null,
        staleRatings: [{ club: "Coventry", elo: 1600, asOf: "2026-07-01", ageDays: 32 }],
        servingPersisted: false,
      });

    await refreshModelData([activeFixture()]);

    const model = getCachedModelData().fixtures[0];
    expect(backfillMissingClubRatings).toHaveBeenCalledOnce();
    expect(model).toMatchObject({ homeElo: 1850, awayElo: 1600 });
    expect(model.forecastProvenance).toMatchObject({
      ratingSnapshotAt: null,
      ratingAgeMinutes: null,
      ratingSourceState: "unknown",
    });
  });

  it("uses fixture identities for readiness and adaptive retry timing", () => {
    const current = {
      fixtures: [buildModelFixtureFromActive(activeFixture(), ratings)!],
      lastUpdated: new Date(),
    };
    expect(modelDataCoversActiveFixtures(current, [activeFixture()])).toBe(true);
    expect(modelRefreshDelay(current, [activeFixture()])).toBe(MODEL_REFRESH_INTERVAL_MS);
    expect(modelDataCoversActiveFixtures(current, [activeFixture({ id: 2 })])).toBe(false);
    expect(modelRefreshDelay(current, [activeFixture({ id: 2 })])).toBe(MODEL_COLD_RETRY_MS);
  });
});
