import { describe, expect, it } from "vitest";
import { getCachedMatches } from "./football-data";
import { buildLocalModelData } from "./model-data";
import { WORLD_CUP_GROUPS, WORLD_CUP_TEAMS } from "./world-cup-teams";

describe("model data contract", () => {
  it("generates fixtures and tournament probabilities without a companion payload", () => {
    const standings = Object.entries(WORLD_CUP_GROUPS).flatMap(([group, teams]) =>
      teams.map((team, index) => ({
        position: index + 1, team, playedGames: 3, won: 3 - index, draw: 0,
        lost: index, points: 9 - index, goalsFor: 4 - index, goalsAgainst: index,
        goalDifference: 4 - index * 2, group, advanced: index < 2,
      }))
    );
    const football = {
      upcoming: [{
        id: 2, competition: "FIFA World Cup", homeTeam: "Spain", awayTeam: "Argentina",
        utcDate: "2026-07-19T19:00Z", status: "SCHEDULED", stage: "final",
        matchday: null, group: null, score: null, winner: null,
      }],
      recent: [{
        id: 1, competition: "FIFA World Cup", homeTeam: "Mexico", awayTeam: "South Africa",
        utcDate: "2026-06-11T19:00Z", status: "FINISHED", stage: "group-stage",
        matchday: null, group: "A", score: { home: 2, away: 0 }, winner: "Mexico",
      }],
      standings,
      lastUpdated: new Date(),
      error: null,
    } as ReturnType<typeof getCachedMatches>;
    const local = buildLocalModelData(
      new Map(WORLD_CUP_TEAMS.map((team) => [team, 1500])),
      football,
      new Map([["Spain", 0.5]]),
      20
    );
    expect(local.teams).toHaveLength(48);
    expect(local.teams.reduce((sum, team) => sum + team.winProb, 0)).toBeCloseTo(1, 12);
    expect(local.fixtures).toHaveLength(2);
    expect(local.fixtures.find((fixture) => fixture.stage === "final"))
      .toMatchObject({ home: "Spain", away: "Argentina", result: null });
    expect(local.fixtures[0].result?.winner).toBe("Mexico");
  });
});
