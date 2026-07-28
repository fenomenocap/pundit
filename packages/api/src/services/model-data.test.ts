import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveFixture } from "./active-fixtures";
import { getCachedClubRatings } from "./club-ratings";
import {
  MODEL_COLD_RETRY_MS,
  MODEL_REFRESH_INTERVAL_MS,
  buildActiveModelFixtures,
  buildModelFixtureFromActive,
  findMissingClubRatingTeams,
  getCachedModelData,
  modelDataCoversActiveFixtures,
  modelRefreshDelay,
  refreshModelData,
} from "./model-data";

vi.mock("./club-ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./club-ratings")>();
  return {
    ...actual,
    getCachedClubRatings: vi.fn(),
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
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toEqual([]);
    expect(cached.error).toBe("Club ratings are not ready: network unavailable");
  });

  it("fails closed when a loaded ratings snapshot lacks an active team", async () => {
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: {
        world: new Map(),
        "eng-clubs": new Map([["Arsenal", 1850]]),
        "uefa-clubs": new Map([["Arsenal", 1850]]),
      },
      fetchedAt: new Date("2026-07-27T00:00:00.000Z"),
      error: null,
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toEqual([]);
    expect(cached.error).toBe(
      "Club ratings are missing for 1 active team(s): Coventry City."
    );
  });

  it("uses retained last-good ratings after a provider refresh error", async () => {
    vi.mocked(getCachedClubRatings).mockReturnValue({
      byProfile: ratings,
      fetchedAt: new Date("2026-07-27T00:00:00.000Z"),
      error: "latest refresh timed out",
    });

    await refreshModelData([activeFixture()]);
    const cached = getCachedModelData();

    expect(cached.fixtures).toHaveLength(1);
    expect(cached.fixtures[0]).toMatchObject({ homeElo: 1850, awayElo: 1600 });
    expect(cached.error).toBeNull();
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
