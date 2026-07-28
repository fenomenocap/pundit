import { describe, expect, it } from "vitest";
import { FootballMatch } from "./football-data";
import { ModelFixture } from "./model-data";
import {
  isFeaturedFootballMatch,
  selectFeaturedActiveFixtures,
  selectFeaturedFixtures,
} from "./featured-fixtures";

function football(
  competitionId: string,
  utcDate: string,
  status = "SCHEDULED",
  home = "Arsenal",
  away = "Coventry City"
): FootballMatch {
  return {
    id: 1,
    competitionId,
    competition: competitionId === "eng.1" ? "Premier League" : "UEFA Champions League Qualifiers",
    homeTeam: home,
    awayTeam: away,
    utcDate,
    status,
    stage: null,
    matchday: null,
    group: null,
    score: null,
  };
}

function model(competitionId: string, home: string, away: string): ModelFixture {
  return {
    competitionId,
    competition: competitionId === "eng.1" ? "Premier League" : "UEFA Champions League Qualifiers",
    fixtureId: 1,
    utcDate: "2026-08-02T15:00:00.000Z",
    date: "2026-08-02",
    group: null,
    stage: "match",
    home,
    away,
    homeElo: 1800,
    awayElo: 1600,
    pHome: 0.5,
    pDraw: 0.25,
    pAway: 0.25,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  };
}

describe("featured fixtures", () => {
  it("prioritises Premier League fixtures and limits the count", () => {
    const selected = selectFeaturedActiveFixtures([
      football("uefa.champions_qual", "2026-08-03T15:00:00.000Z"),
      football("eng.1", "2026-08-02T15:00:00.000Z"),
    ], 1);
    expect(selected).toHaveLength(1);
    expect(selected[0].competitionId).toBe("eng.1");
  });

  it("excludes completed and placeholder matches", () => {
    expect(isFeaturedFootballMatch(football("eng.1", "2026-08-02T15:00:00.000Z", "FINISHED"))).toBe(false);
    expect(isFeaturedFootballMatch(football("eng.1", "2026-08-02T15:00:00.000Z", "SCHEDULED", "TBD", "Arsenal"))).toBe(false);
  });

  it("joins an active ESPN fixture to model data", () => {
    const footballMatch = football("eng.1", "2026-08-02T15:00:00.000Z");
    expect(selectFeaturedFixtures([footballMatch], [model("eng.1", "Arsenal", "Coventry City")]))
      .toHaveLength(1);
  });
});
