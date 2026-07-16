import { describe, expect, it } from "vitest";
import { AppError } from "../middleware";
import { ModelFixture } from "./model-data";
import {
  buildGrounding,
  findFixture,
  isTournamentQuestion,
  resolveQuestionTeams,
  resolveTeams,
} from "./ask";

function fixture(home: string, away: string): ModelFixture {
  return {
    date: "2026-06-11",
    group: "A",
    stage: "group",
    home,
    away,
    pHome: 0.4,
    pDraw: 0.3,
    pAway: 0.3,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "1-1", probability: 0.12 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  };
}

const fixtures = [
  fixture("USA", "England"),
  fixture("South Korea", "France"),
  fixture("Bosnia", "Morocco"),
  fixture("Brazil", "DR Congo"),
];

describe("resolveTeams", () => {
  it("extracts aliases as canonical fixture names", () => {
    expect(resolveTeams("How does United States vs England look?", fixtures))
      .toEqual(["USA", "England"]);
    expect(resolveTeams("Bosnia and Herzegovina against Morocco", fixtures))
      .toEqual(["Bosnia", "Morocco"]);
  });

  it("checks longer team search terms first", () => {
    expect(resolveTeams("South Korea vs France", fixtures))
      .toEqual(["South Korea", "France"]);
  });

  it("rejects questions naming more than one matchup", () => {
    expect(() => resolveTeams("France vs Morocco, then Brazil", fixtures))
      .toThrowError(AppError);
    try {
      resolveTeams("France vs Morocco, then Brazil", fixtures);
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("exactly one matchup"),
      });
    }
  });
});

describe("resolveQuestionTeams", () => {
  it("resolves a plain matchup", () => {
    expect(resolveQuestionTeams("USA vs England", fixtures)).toEqual(["USA", "England"]);
  });

  it("returns undefined when no teams are named", () => {
    expect(resolveQuestionTeams("Who wins tonight?", fixtures)).toBeUndefined();
  });

  it("lets a multi-team tournament question through ungrounded", () => {
    expect(resolveQuestionTeams(
      "Will France, England or Morocco win the World Cup?",
      fixtures
    )).toBeUndefined();
  });

  it("still rejects a multi-team matchup question", () => {
    expect(() => resolveQuestionTeams("France vs Morocco, then Brazil", fixtures))
      .toThrowError(AppError);
  });
});

describe("findFixture", () => {
  it("finds a fixture regardless of requested team order", () => {
    expect(findFixture("England", "USA", fixtures)).toEqual(fixtures[0]);
  });
});

describe("buildGrounding", () => {
  it("includes totals, BTTS, and model scorelines", () => {
    expect(buildGrounding(fixtures[0])).toMatchObject({
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.52,
      pBttsNo: 0.48,
      topScores: [{ score: "1-1", probability: 0.12 }],
    });
  });
});

describe("isTournamentQuestion", () => {
  it.each([
    "Who wins it all?",
    "Who is the favourite?",
    "Which team will win the World Cup?",
  ])("recognizes %s", (question) => {
    expect(isTournamentQuestion(question)).toBe(true);
  });

  it("does not classify an ordinary matchup question", () => {
    expect(isTournamentQuestion("France vs Morocco")).toBe(false);
  });
});
