import { describe, expect, it } from "vitest";
import { ActiveFixture } from "./active-fixtures";
import { buildActiveModelFixtures, buildModelFixtureFromActive } from "./model-data";

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

  it("uses default Elo when a team is missing from ClubElo", () => {
    const model = buildModelFixtureFromActive(
      activeFixture({ awayTeam: "Unknown FC" }),
      ratings
    );
    expect(model?.awayElo).toBe(1400);
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
});
