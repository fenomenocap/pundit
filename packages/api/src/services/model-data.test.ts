import { describe, expect, it } from "vitest";
import { getCachedMatches } from "./football-data";
import { buildLocalModelData, parseFixtures, parseTeams } from "./model-data";
import { WORLD_CUP_GROUPS, WORLD_CUP_TEAMS } from "./world-cup-teams";

const rawFixture = {
  date: "2026-06-11", group: "A", stage: "group", home: "Mexico", away: "South Africa",
  p_home: 0.7, p_draw: 0.2, p_away: 0.1, p_over_2_5: 0.6, p_under_2_5: 0.4,
  p_btts_yes: 0.45, p_btts_no: 0.55, top_scores: [["2-0", 0.14], ["1-0", 0.12]],
  stake_p_home: null, stake_p_draw: null, stake_p_away: null,
  result: { home_score: 2, away_score: 0, status: "FT", winner: "Mexico" },
};

describe("model data contract", () => {
  it("retains every fixture with analytical fields and completed results", () => {
    const parsed = parseFixtures([rawFixture, { ...rawFixture, date: "2026-06-12", result: null }]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      pOver2_5: 0.6,
      pBttsYes: 0.45,
      result: { winner: "Mexico" },
    });
    expect(parsed[0].topScores[0]).toEqual({ score: "2-0", probability: 0.14 });
  });

  it("preserves unavailable market values as null", () => {
    expect(parseTeams({ Mexico: {
      win_prob: 0.1, sf_prob: 0.2, qf_prob: 0.3, market_price: null, edge: null,
    } })[0]).toMatchObject({ marketPrice: null, edge: null });
  });

  it("rejects malformed probabilities instead of coercing them to zero", () => {
    expect(() => parseFixtures([{ ...rawFixture, p_home: "bad" }])).toThrow(/p_home/);
  });

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
