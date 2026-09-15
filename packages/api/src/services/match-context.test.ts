import { afterEach, describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__/model-fixture";
import type { ModelFixture } from "./model-data";
import {
  buildMatchContext,
  formatFormMarks,
  formatScorersLine,
  formatTableLine,
} from "./match-context";
import { eloToLambdas } from "./dixon-coles";
import {
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "./football-data";

function finishedMatch(
  partial: Partial<FootballMatch> & Pick<FootballMatch, "id" | "homeTeam" | "awayTeam" | "utcDate">
): FootballMatch {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    stage: null,
    matchday: null,
    group: null,
    status: "FINISHED",
    score: { home: 1, away: 0 },
    ...partial,
  };
}

afterEach(() => {
  replaceFootballDataForTests({
    byCompetition: {},
    upcoming: [],
    recent: [],
    standings: [],
    lastUpdated: null,
    error: null,
    competitionErrors: {},
  });
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "unknown",
    fixtures: [],
    lastUpdated: null,
    error: null,
    servingLastGood: false,
  });
});

describe("buildMatchContext", () => {
  it("derives lambdas from fixture Elo and provenance HFA without mutating dixon-coles", () => {
    const model = fixture("Arsenal", "Coventry City", {
      homeElo: 1900,
      awayElo: 1600,
      forecastProvenance: {
        homeAdvantageElo: 42,
      } as ModelFixture["forecastProvenance"],
    });
    const context = buildMatchContext(model);
    const [lambdaHome, lambdaAway] = eloToLambdas(1900, 1600, 42);
    expect(context.lambdaHome).toBeCloseTo(lambdaHome, 6);
    expect(context.lambdaAway).toBeCloseTo(lambdaAway, 6);
    expect(context.totalXg).toBeCloseTo(lambdaHome + lambdaAway, 6);
  });

  it("joins form, table and scorers from club-form snapshot", () => {
    replaceFootballDataForTests({
      byCompetition: {
        "eng.1": {
          upcoming: [],
          recent: [],
          standings: [
            {
              competitionId: "eng.1",
              position: 3,
              team: "Arsenal",
              playedGames: 2,
              won: 2,
              draw: 0,
              lost: 0,
              points: 6,
              goalsFor: 5,
              goalsAgainst: 1,
              goalDifference: 4,
              group: null,
              advanced: false,
            },
          ],
          error: null,
        },
      },
    });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      lastUpdated: new Date("2026-09-09T12:00:00Z"),
      error: null,
      servingLastGood: false,
      fixtures: [
        finishedMatch({
          id: 1,
          homeTeam: "Arsenal",
          awayTeam: "Liverpool",
          utcDate: "2026-09-06T14:00:00Z",
          score: { home: 2, away: 1 },
          scorers: [
            { playerId: "saka", name: "Bukayo Saka", team: "Arsenal", position: "W" },
          ],
        }),
      ],
    });
    const context = buildMatchContext(fixture("Arsenal", "Coventry City"));
    expect(context.homeForm).toEqual(["W"]);
    expect(context.homeTable).toEqual({
      position: 3,
      points: 6,
      goalDifference: 4,
      playedGames: 2,
    });
    expect(context.homeScorers[0]).toMatchObject({ name: "Bukayo Saka", goals: 1 });
    expect(context.awayForm).toEqual([]);
  });
});

describe("match context formatters", () => {
  it("formats form, table and scorers compactly", () => {
    expect(formatFormMarks(["W", "D", "L"])).toBe("WDL");
    expect(formatFormMarks([])).toBe("—");
    expect(formatTableLine("Arsenal", {
      position: 1,
      points: 10,
      goalDifference: 7,
      playedGames: 4,
    })).toBe("Arsenal: 1st, 10 pts, +7 GD, 4 played");
    expect(formatScorersLine("Arsenal", [{
      id: "saka",
      name: "Bukayo Saka",
      team: "Arsenal",
      position: "FWD",
      goals: 3,
    }])).toBe("Arsenal scorers: Bukayo Saka (3)");
  });
});
