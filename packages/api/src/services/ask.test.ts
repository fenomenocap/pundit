import { describe, expect, it } from "vitest";
import { AppError } from "../middleware";
import { ModelFixture } from "./model-data";
import {
  buildCompetitionGrounding,
  buildGrounding,
  findFixture,
  isCompetitionQuestion,
  resolveAskContext,
  resolveCompetitionContext,
  resolveQuestionTeams,
  resolveTeams,
  shouldUseCompetitionGrounding,
  shouldUseMatchGrounding,
} from "./ask";

function fixture(home: string, away: string, overrides: Partial<ModelFixture> = {}): ModelFixture {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 1,
    utcDate: "2026-08-02T15:00:00.000Z",
    date: "2026-08-02",
    group: null,
    stage: "match",
    home,
    away,
    homeElo: 1800,
    awayElo: 1700,
    pHome: 0.4,
    pDraw: 0.3,
    pAway: 0.3,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "1-1", probability: 0.12 }],
    scorelines: [{ score: "1-1", probability: 0.12 }, { score: "3-2", probability: 0.011 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
    ...overrides,
  };
}

const fixtures = [
  fixture("Arsenal", "Coventry City"),
  fixture("Liverpool", "Manchester United"),
  fixture("Brighton & Hove Albion", "Tottenham Hotspur"),
];

function standing(competitionId = "eng.1", team = "Arsenal") {
  return {
    competitionId,
    position: 1,
    team,
    playedGames: 0,
    won: 0,
    draw: 0,
    lost: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    group: null,
    advanced: false,
  };
}

describe("resolveTeams", () => {
  it("extracts aliases as canonical fixture names", () => {
    expect(resolveTeams("How does Manchester United vs Liverpool look?", fixtures))
      .toEqual(["Manchester United", "Liverpool"]);
    expect(resolveTeams("Brighton against Tottenham", fixtures))
      .toEqual(["Brighton & Hove Albion", "Tottenham Hotspur"]);
  });

  it("rejects questions naming more than one matchup", () => {
    expect(() => resolveTeams("Arsenal vs Liverpool, then Brighton", fixtures))
      .toThrowError(AppError);
  });
});

describe("resolveQuestionTeams", () => {
  it("resolves a plain matchup", () => {
    expect(resolveQuestionTeams("Arsenal vs Coventry City", fixtures))
      .toEqual(["Arsenal", "Coventry City"]);
  });

  it("returns undefined when no teams are named", () => {
    expect(resolveQuestionTeams("Who wins tonight?", fixtures)).toBeUndefined();
  });

  it("lets a multi-team competition question through ungrounded", () => {
    expect(resolveQuestionTeams(
      "Will Chelsea, Tottenham or Newcastle win the Premier League?",
      fixtures
    )).toBeUndefined();
  });
});

describe("findFixture", () => {
  it("finds a fixture regardless of requested team order", () => {
    expect(findFixture("Coventry City", "Arsenal", fixtures)).toEqual(fixtures[0]);
  });
});

describe("buildGrounding", () => {
  it("includes competition metadata and totals", () => {
    expect(buildGrounding(fixtures[0])).toMatchObject({
      kind: "match",
      competitionId: "eng.1",
      competition: "Premier League",
      homeFieldAdvantage: true,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.52,
      pBttsNo: 0.48,
      topScores: [{ score: "1-1", probability: 0.12 }],
    });
  });
});

describe("buildCompetitionGrounding", () => {
  it("returns standings rows for the requested competition", () => {
    expect(buildCompetitionGrounding("eng.1", [
      {
        competitionId: "eng.1",
        position: 1,
        team: "Arsenal",
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        group: null,
        advanced: false,
      },
      {
        competitionId: "uefa.champions_qual",
        position: 1,
        team: "Riga FC",
        playedGames: 0,
        won: 0,
        draw: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        group: null,
        advanced: false,
      },
    ], new Date("2026-07-27T09:00:00.000Z"))).toEqual({
      kind: "competition",
      competitionId: "eng.1",
      competition: "Premier League",
      updatedAt: "2026-07-27T09:00:00.000Z",
      standings: [{
        position: 1,
        team: "Arsenal",
        playedGames: 0,
        points: 0,
        goalDifference: 0,
      }],
    });
  });
});

describe("isCompetitionQuestion", () => {
  it.each([
    "Who wins the Premier League?",
    "Who is leading the title race?",
    "What does the top of the table look like?",
  ])("recognizes %s", (question) => {
    expect(isCompetitionQuestion(question)).toBe(true);
  });

  it("does not classify an ordinary matchup question", () => {
    expect(isCompetitionQuestion("Arsenal vs Coventry City")).toBe(false);
  });
});

describe("shouldUseCompetitionGrounding", () => {
  const competitionHistory = [
    { role: "user" as const, content: "Who wins the Premier League?" },
    { role: "assistant" as const, content: "Arsenal leads the table." },
  ];

  it("keeps referential competition follow-ups grounded", () => {
    expect(shouldUseCompetitionGrounding(
      "What about that table ranking?",
      competitionHistory
    )).toBe(true);
  });

  it("does not carry competition grounding into an unrelated new topic", () => {
    expect(shouldUseCompetitionGrounding(
      "How does a high defensive line change pressing risk?",
      competitionHistory
    )).toBe(false);
  });

  it("preserves the exact competition across multiple referential turns", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "The qualifying picture is still developing." },
      { role: "user" as const, content: "What about that ranking?" },
      { role: "assistant" as const, content: "There is no league-style table." },
      { role: "user" as const, content: "And what does that table mean?" },
      { role: "assistant" as const, content: "It would describe the current order." },
    ];

    expect(resolveCompetitionContext("What changed in those standings?", history))
      .toBe("uefa.champions_qual");
  });
});

describe("shouldUseMatchGrounding", () => {
  it("recognizes a match-specific follow-up", () => {
    expect(shouldUseMatchGrounding("What about the draw chance?")).toBe(true);
    expect(shouldUseMatchGrounding("Which side has the stronger model case, and why?"))
      .toBe(true);
    expect(shouldUseMatchGrounding("Which model input matters most to that edge?"))
      .toBe(true);
  });

  it("does not classify an unrelated tactical question", () => {
    expect(shouldUseMatchGrounding("Explain how a high defensive line works.")).toBe(false);
  });
});

describe("resolveAskContext", () => {
  it("keeps general chat available while the active model is empty or unready", () => {
    expect(resolveAskContext(
      "Explain how a high defensive line works.",
      [],
      undefined,
      [],
      []
    )).toEqual({ tier: "general" });
  });

  it("uses Premier League standings even when there are no active model fixtures", () => {
    expect(resolveAskContext(
      "Who wins the Premier League?",
      [],
      undefined,
      [],
      [standing()],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
  });

  it("reports an active matchup whose model row is unavailable", () => {
    expect(resolveAskContext(
      "Arsenal vs Coventry City",
      [],
      undefined,
      [],
      [],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({
      tier: "model-unavailable",
      teams: ["Arsenal", "Coventry City"],
    });
  });

  it("routes a two-team title question to competition grounding", () => {
    expect(resolveAskContext(
      "Will Arsenal or Coventry City win the Premier League?",
      [],
      undefined,
      fixtures,
      [standing()]
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
  });

  it("routes a clear named matchup to match grounding even when the competition is named", () => {
    expect(resolveAskContext(
      "Arsenal vs Coventry City in the Premier League",
      [],
      undefined,
      fixtures,
      [standing()]
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("preserves UCL qualifier context on a standings follow-up", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "Here is the current picture." },
    ];

    expect(resolveAskContext(
      "What about those standings?",
      history,
      undefined,
      fixtures,
      [standing("uefa.champions_qual", "Riga FC")]
    )).toEqual({
      tier: "competition",
      competitionId: "uefa.champions_qual",
    });
  });

  it("falls back to general analysis when the requested standings are unavailable", () => {
    expect(resolveAskContext(
      "How does UCL qualifying look?",
      [],
      undefined,
      fixtures,
      []
    )).toEqual({ tier: "general" });
  });

  it("reuses match context only for a relevant follow-up", () => {
    const history = [
      { role: "user" as const, content: "Arsenal vs Coventry City" },
      { role: "assistant" as const, content: "Arsenal is favoured." },
    ];
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];

    expect(resolveAskContext(
      "What about the draw chance?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(resolveAskContext(
      "Explain how a high defensive line works.",
      history,
      teamContext,
      fixtures,
      []
    )).toEqual({ tier: "general" });
    expect(resolveAskContext(
      "Which side has the stronger model case, and why?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(resolveAskContext(
      "Which model input matters most to that edge?",
      history,
      teamContext,
      fixtures,
      []
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("does not silently generalize a match follow-up while its model row is unavailable", () => {
    expect(resolveAskContext(
      "What about the draw chance?",
      [
        { role: "user", content: "Arsenal vs Coventry City" },
        { role: "assistant", content: "The model was previously available." },
      ],
      ["Arsenal", "Coventry City"],
      [],
      [],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({
      tier: "model-unavailable",
      teams: ["Arsenal", "Coventry City"],
    });
  });
});
