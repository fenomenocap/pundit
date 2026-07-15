import { describe, expect, it } from "vitest";
import { FootballMatch } from "./football-data";
import { ModelFixture } from "./model-data";
import { isFeaturedFootballMatch, selectFeaturedFixtures } from "./featured-fixtures";

function football(stage: string, status: string, home = "England", away = "Argentina"): FootballMatch {
  return {
    id: 1, competition: "FIFA World Cup", homeTeam: home, awayTeam: away,
    utcDate: "2026-07-15T19:00:00Z", status, stage, matchday: null, group: null, score: null,
  };
}

const model: ModelFixture = {
  date: "2026-07-15", group: null, stage: "semifinals", home: "England", away: "Argentina",
  pHome: 0.25, pDraw: 0.25, pAway: 0.5, pOver2_5: 0.5, pUnder2_5: 0.5,
  pBttsYes: 0.5, pBttsNo: 0.5, topScores: [], stakePHome: null,
  stakePDraw: null, stakePAway: null, result: null,
};

describe("featured fixtures", () => {
  it("includes active semifinals and the final, but not third place", () => {
    expect(isFeaturedFootballMatch(football("semifinals", "SCHEDULED"))).toBe(true);
    expect(isFeaturedFootballMatch(football("final", "IN_PLAY"))).toBe(true);
    expect(isFeaturedFootballMatch(football("3rd-place-match", "SCHEDULED"))).toBe(false);
  });

  it("excludes completed and placeholder matches while preserving them outside the derived view", () => {
    expect(isFeaturedFootballMatch(football("semifinals", "FINISHED"))).toBe(false);
    expect(isFeaturedFootballMatch(football("final", "SCHEDULED", "TBD", "Argentina"))).toBe(false);
    expect(isFeaturedFootballMatch(football(
      "final",
      "SCHEDULED",
      "Spain",
      "Semifinal 2 Winner"
    ))).toBe(false);
    expect(isFeaturedFootballMatch(football(
      "semifinals",
      "SCHEDULED",
      "Quarterfinal 4 Loser",
      "England"
    ))).toBe(false);
  });

  it("joins an active ESPN fixture to model data", () => {
    expect(selectFeaturedFixtures([football("semifinals", "SCHEDULED")], [model]))
      .toHaveLength(1);
  });
});
