import { describe, expect, it } from "vitest";
import { AppError } from "../middleware";
import { ModelFixture } from "./model-data";
import { recognizeEspnFixture, type RecognizedFixture } from "./fixture-registry";
import {
  MATCH_ANSWER_GUARDS,
  MATCH_QUESTION_SCOPE,
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
  deterministicSearchQuery,
  evidenceAuthority,
  dropMisbucketedTotalsScorelines,
  renderEvidenceCitations,
  sanitizeFixtureCoverageAnswer,
  sanitizeContradictoryRationales,
  sanitizeManagerEraClaims,
  sanitizeMatchAnswer,
  sanitizeRuntimeResponseCorrectness,
  sanitizeUnrecognizedCandidateAnswer,
  verifiableCurrentClaims,
  verifyCurrentClaims,
  type FixtureGrounding,
  shouldHoldCoverageDeltas,
  stripUnvalidatedExternalMarketClaims,
} from "./ask";

describe("current-news evidence hardening", () => {
  it("deterministically pre-searches clearly current questions", () => {
    for (const question of [
      "Latest Arsenal injuries?",
      "Is Saka available today?",
      "Recent form and current manager?",
      "Any transfer or lineup news?",
      "What are the current odds?",
      "You're wrong about the manager — check again",
    ]) {
      expect(deterministicSearchQuery(question)).toContain("football latest");
    }
    expect(deterministicSearchQuery("Explain the offside rule")).toBeNull();
    expect(deterministicSearchQuery("Actually that manager is wrong", "Arsenal Pat Doe"))
      .toContain("Arsenal Pat Doe");
  });

  it("does not promote unknown search domains to reputable evidence", () => {
    expect(evidenceAuthority("https://www.uefa.com/story")).toBe("official");
    expect(evidenceAuthority("https://www.arsenal.com/news/team-update")).toBe("official");
    expect(evidenceAuthority("https://www.reuters.com/story")).toBe("reputable");
    expect(evidenceAuthority("https://football-rumours.example/story")).toBe("other");
  });

  it("fails closed on generated bookmaker numbers that lack a complete server-owned market", () => {
    const answer = [
      "The official fixture is scheduled for Saturday.",
      "Stake market: home 2.10, draw 3.40, away 3.60 (48.0%, 29.7%, 22.3%).",
    ].join("\n\n");
    const sanitized = stripUnvalidatedExternalMarketClaims(answer);
    expect(sanitized).toContain("official fixture is scheduled");
    expect(sanitized).toContain("complete same-source, same-time bookmaker 1X2 market");
    expect(sanitized).not.toContain("2.10");
    expect(sanitized).not.toContain("48.0%");
    expect(sanitizeMatchAnswer("Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%."))
      .toContain("omitted those numbers");
  });

  it("renders only a complete same-source, same-time market with third-party attribution", () => {
    const legs = [
      { outcome: "home" as const, decimalOdds: 2, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
      { outcome: "draw" as const, decimalOdds: 4, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
      { outcome: "away" as const, decimalOdds: 4, source: "Stake", observedAt: "2026-08-13T12:00:00Z" },
    ];
    const sanitized = stripUnvalidatedExternalMarketClaims(
      "Stake market: home 99%, draw 0.5%, away 0.5%.",
      [legs]
    );
    expect(sanitized).toContain("Stake market-implied probabilities (third-party data, not a Pundit forecast)");
    expect(sanitized).toContain("home 50.0%, draw 25.0%, away 25.0%");
    expect(sanitized).not.toContain("99%");

    expect(stripUnvalidatedExternalMarketClaims(
      "Stake market: home 50%, draw 25%, away 25%.",
      [legs.slice(0, 2)]
    )).toContain("omitted those numbers");
    expect(stripUnvalidatedExternalMarketClaims([
      "Stake market:",
      "home: 2.00",
      "draw: 4.00",
      "away: 4.00",
      "Safe unrelated sentence.",
    ].join("\n"))).toBe(
      "Safe unrelated sentence.\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market from server-owned evidence, so I have omitted those numbers."
    );
  });

  it("fails manager-era assertions closed unless the dated tenure record supports them", () => {
    const claim = "The win came during Mikel Arteta's tenure.";
    expect(sanitizeManagerEraClaims(claim)).toContain("could not be tied to a structured tenure record");
    expect(sanitizeManagerEraClaims(claim)).not.toContain("The win came");

    const context = {
      eventAt: "2024-02-01T00:00:00Z",
      tenures: [
        { manager: "Mikel Arteta", startedAt: "2019-12-22T00:00:00Z" },
      ],
    };
    expect(sanitizeManagerEraClaims(claim, context)).toBe(claim);
    expect(sanitizeManagerEraClaims("The win came under manager Unai Emery.", context))
      .toContain("attributes that date to Mikel Arteta");
    for (const normalProse of [
      "Arsenal struggled under sustained pressure.",
      "The match occurred during Premier League fixtures.",
      "They played under Arsenal floodlights.",
    ]) expect(sanitizeManagerEraClaims(normalProse)).toBe(normalProse);
  });

  it("removes both sides of a recognizable contradictory rationale", () => {
    const answer = [
      "The home side's midfield gives it an edge.",
      "The away side's midfield gives it an advantage.",
      "The fixture remains close.",
    ].join("\n");
    const sanitized = sanitizeContradictoryRationales(answer);
    expect(sanitized).not.toContain("home side's midfield");
    expect(sanitized).not.toContain("away side's midfield");
    expect(sanitized).toContain("Conflicting midfield rationales were omitted");
    expect(sanitized).toContain("fixture remains close");
    expect(sanitizeRuntimeResponseCorrectness(answer)).toBe(sanitized);
    const sameParagraph = "The home side's midfield gives it an edge. The away side's midfield gives it an advantage. The fixture remains close.";
    expect(sanitizeContradictoryRationales(sameParagraph)).not.toMatch(/home side|away side/);
    expect(sanitizeContradictoryRationales(sameParagraph)).toContain("fixture remains close");
  });

  it("extracts only server-marked external claims for the verifier", () => {
    expect(verifiableCurrentClaims(
      "Pundit's model has Arsenal at 45%. The manager is Pat Doe [[S1]]. Unverified aside."
    )).toEqual([{ id: "C1", text: "The manager is Pat Doe [[S1]]." }]);
  });

  it("binds accepted claims to the verifier-selected server evidence ID", async () => {
    const bundle = {
      queries: ["current manager"],
      providerCalls: 0,
      results: [
        { id: "S1", title: "Official", url: "https://uefa.com/one", date: "2026-08-13", snippet: "Pat Doe is manager." },
        { id: "S2", title: "Other", url: "https://news.example/two", date: "2026-08-13", snippet: "Unrelated." },
      ],
    };
    const checked = await verifyCurrentClaims(
      "Pat Doe is the current manager [[S2]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.slice(0, 1).map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "Pat Doe is manager.",
          retrievedAt: "2026-08-13T00:00:00.000Z",
        })),
        verify: async () => ({
          status: "verified",
          decisions: [{ claimId: "C1", outcome: "supported", evidenceIds: ["S1"] }],
          summary: "supported",
        }),
      }
    );
    expect(checked.answer).toContain("[[S1]]");
    expect(checked.answer).not.toContain("[[S2]]");
    expect(checked.verification).toEqual({
      status: "verified",
      supportedClaimCount: 1,
      removedClaimCount: 0,
    });
    expect(bundle.providerCalls).toBe(1);
  });

  it("preserves server-authored outside-coverage safety text while filtering factual claims", async () => {
    const bundle = {
      queries: ["fixture date"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Official",
        url: "https://uefa.com/fixture",
        date: "2026-08-13",
        snippet: "The fixture is Thursday.",
      }],
    };
    const checked = await verifyCurrentClaims(
      "This recognized fixture is outside Pundit's model coverage, so no Pundit probabilities or scoreline estimates are available.\n\n"
        + "The fixture is Thursday [[S1]]. An unsupported lineup is confirmed [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "The fixture is Thursday.",
          retrievedAt: "2026-08-13T00:00:00.000Z",
        })),
        verify: async () => ({
          status: "verified",
          decisions: [
            { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
            { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
          ],
          summary: "checked",
        }),
      }
    );
    expect(checked.answer).toMatch(/outside Pundit's model coverage/i);
    expect(checked.answer).toContain("The fixture is Thursday [[S1]].");
    expect(checked.answer).not.toContain("unsupported lineup");
  });

  it("does not let uncited generated bookmaker percentages use the structured-market exception", async () => {
    const checked = await verifyCurrentClaims(
      "Stake market: Arsenal 52%, draw 25%, away 23%. No verified injury update was established.",
      { queries: ["current odds"], providerCalls: 2, results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      true
    );
    expect(checked.verification.status).toBe("abstain");
    expect(checked.answer).not.toMatch(/52%|25%|23%/);
  });

  it("reconciles plain scoreline arithmetic even without a probability suffix", () => {
    expect(dropMisbucketedTotalsScorelines("A 1-1 result lands over 2.5 goals."))
      .toBe("A 1-1 scoreline has 2 total goals, so it is under 2.5.");
    expect(dropMisbucketedTotalsScorelines("Under 2.5 examples include 2-1 and 1-1."))
      .not.toContain("2-1");
  });

  it("deterministically strips public probabilities and scorelines from non-priced fixtures", () => {
    const fixture = recognizeEspnFixture({
      id: 900,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Arsenal",
      awayTeam: "AC Milan",
      utcDate: "2026-08-20T12:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    fixture.competition.category = "club-friendly";
    const grounding: FixtureGrounding = {
      kind: "fixture",
      fixture,
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    };
    const safe = sanitizeFixtureCoverageAnswer(
      "Arsenal 48%, draw 25%, Milan 27%. Likely score 2-1. The fixture is on Thursday [[S1]].",
      grounding
    );
    expect(safe).toMatch(/outside Pundit's model coverage/i);
    expect(safe).not.toMatch(/48%|2-1/);
  });

  it("keeps an unrecognized matchup candidate ungrounded and strips invented output", () => {
    expect(resolveAskContext(
      "Northbridge Athletic vs Southbank Rovers tomorrow",
      [],
      undefined,
      [],
      []
    )).toEqual({ tier: "candidate" });
    const safe = sanitizeUnrecognizedCandidateAnswer(
      "Pundit's probabilities are 50%, 25%, 25%. Likely score 2-1."
    );
    expect(safe).toMatch(/could not establish an authoritative structured fixture identity/i);
    expect(safe).not.toMatch(/50%|2-1/);
  });

  it("holds all candidate and non-priced fixture SSE deltas until sanitization", () => {
    const fixture = recognizeEspnFixture({
      id: 900,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      utcDate: "2026-08-18T19:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    fixture.competition.category = "club-friendly";
    expect(shouldHoldCoverageDeltas({
      kind: "fixture",
      fixture,
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    }, false)).toBe(true);
    expect(shouldHoldCoverageDeltas(null, true)).toBe(true);
    expect(shouldHoldCoverageDeltas(null, false)).toBe(false);
  });

  it("renders exact server evidence and removes invented or unsupported claims", () => {
    const bundle = {
      queries: ["arsenal injury"],
      results: [{
        id: "S1",
        title: "Club update",
        url: "https://example.com/team-news",
        date: "2026-08-12",
        snippet: "A player returned to training.",
      }],
    };
    const rendered = renderEvidenceCitations(
      "The player is available. [[S1]]\nAnother player is injured. [[S99]]",
      bundle,
      true
    );
    expect(rendered.answer).toContain("[Club update](https://example.com/team-news)");
    expect(rendered.answer).not.toContain("Another player");
    expect(rendered.citations).toEqual([expect.objectContaining({ id: "S1" })]);
  });

  it("abstains when a positive current claim has no provenance marker", () => {
    const rendered = renderEvidenceCitations(
      "The player is ruled out for Sunday.",
      { queries: ["query"], results: [] },
      true
    );
    expect(rendered.answer).toMatch(/could not establish a verified current update/i);
  });

  it("requires a dated marker in each sentence, not merely elsewhere on the line", () => {
    const bundle = {
      queries: ["query"],
      results: [{
        id: "S1",
        title: "Club update",
        url: "https://example.com/update",
        date: "2026-08-12",
        snippet: "One player is available.",
      }],
    };
    const rendered = renderEvidenceCitations(
      "One player is available [[S1]]. Another player is ruled out.",
      bundle,
      true
    );
    expect(rendered.answer).toContain("One player");
    expect(rendered.answer).not.toContain("Another player");
  });

  it("does not render undated evidence for positive current-news claims", () => {
    const rendered = renderEvidenceCitations(
      "The player is available [[S1]].",
      { queries: ["query"], results: [{
        id: "S1",
        title: "Undated result",
        url: "https://example.com/undated",
        date: "",
        snippet: "Available",
      }] },
      true
    );
    expect(rendered.answer).toMatch(/could not establish a verified current update/i);
    expect(rendered.citations).toEqual([]);
  });
});

describe("MATCH_ANSWER_GUARDS", () => {
  it("blocks unsupported aggregate, scoreline-tail, and causal claims", () => {
    expect(MATCH_ANSWER_GUARDS).toContain("aggregate advancement is outside this model payload");
    expect(MATCH_ANSWER_GUARDS).toContain("omitted from your prose");
    expect(MATCH_ANSWER_GUARDS).toContain("never say it entirely causes the edge");
  });
});

describe("MATCH_QUESTION_SCOPE", () => {
  it("tells the model to answer the question actually asked", () => {
    expect(MATCH_QUESTION_SCOPE).toContain("Answer the question the user actually\nasked.");
    expect(MATCH_QUESTION_SCOPE).toContain("leave the fixture data out instead of steering back to the matchup");
  });

  it("keeps oblique follow-ups answered from the grounding", () => {
    expect(MATCH_QUESTION_SCOPE).toContain("however short or indirect");
    expect(MATCH_QUESTION_SCOPE).toContain("answer them in full from the grounding");
    expect(MATCH_QUESTION_SCOPE)
      .toContain("never tell the user you have no model data for this matchup");
    expect(MATCH_QUESTION_SCOPE).toContain("treat\nit as a question about the fixture");
  });
});

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

  // Grounding models exactly one match, so several matchups cannot be answered
  // in one turn -- but the limit is only useful if the error says which match
  // to ask about. The code is what carries the message past the frontend's
  // generic 400 copy.
  it("names the real fixtures when the question holds more than one matchup", () => {
    const multiFixtures = [
      fixture("Arsenal", "Liverpool"),
      fixture("Coventry City", "Tottenham Hotspur", { fixtureId: 2 }),
    ];
    try {
      resolveTeams("Compare Arsenal vs Liverpool and Coventry City vs Tottenham", multiFixtures);
      throw new Error("expected resolveTeams to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appError = err as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.code).toBe("MULTIPLE_FIXTURES");
      expect(appError.message).toContain("Arsenal vs Liverpool");
      expect(appError.message).toContain("Coventry City vs Tottenham Hotspur");
    }
  });

  it("falls back to the generic message when the teams form no fixture", () => {
    try {
      resolveTeams("Arsenal, Liverpool and Brighton", fixtures);
      throw new Error("expected resolveTeams to throw");
    } catch (err) {
      const appError = err as AppError;
      expect(appError.code).toBe("MULTIPLE_TEAMS");
      expect(appError.message).toContain("exactly one matchup");
    }
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
  function recognizedFriendly(
    id: number,
    home: string,
    away: string
  ): RecognizedFixture {
    const recognized = recognizeEspnFixture({
      id,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: home,
      awayTeam: away,
      utcDate: "2026-08-18T19:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    return {
      ...recognized,
      competition: { ...recognized.competition, category: "club-friendly" },
      neutralVenue: true,
    };
  }

  it("recognizes an authoritative friendly as outside coverage and retains fixture identity", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    const explicit = resolveAskContext(
      "Arsenal vs Liverpool friendly",
      [],
      undefined,
      [],
      [],
      [],
      { recognizedFixtures: [friendly] }
    );
    expect(explicit).toMatchObject({
      tier: "fixture",
      fixture: { fixtureId: friendly.fixtureId },
      capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    });
    expect(resolveAskContext(
      "What will the 1X2 be?",
      [],
      ["Chelsea", "Manchester City"],
      [],
      [],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("lets a new recognized matchup replace retained fixture context", () => {
    const oldFixture = recognizedFriendly(800, "Arsenal", "Liverpool");
    const newFixture = recognizedFriendly(801, "Chelsea", "Manchester City");
    expect(resolveAskContext(
      "Chelsea vs Manchester City",
      [],
      undefined,
      [],
      [],
      [],
      {
        recognizedFixtures: [oldFixture, newFixture],
        fixtureContext: { fixtureId: oldFixture.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: newFixture.fixtureId } });
  });

  it("routes table questions temporarily without deleting retained fixture context", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "How does the Premier League table look?",
      [],
      undefined,
      [],
      [standing()],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
    expect(resolveAskContext(
      "What about that match?",
      [],
      undefined,
      [],
      [],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("does not let an EPL token override explicit 1X2 intent for the retained fixture", () => {
    const friendly = recognizedFriendly(800, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "What will the 1X2 be for that EPL match?",
      [],
      undefined,
      [],
      [standing()],
      [],
      {
        recognizedFixtures: [friendly],
        fixtureContext: { fixtureId: friendly.fixtureId },
      }
    )).toMatchObject({ tier: "fixture", fixture: { fixtureId: friendly.fixtureId } });
  });

  it("does not match the epl token inside replacing", () => {
    expect(isCompetitionQuestion("Who is replacing the injured manager?")).toBe(false);
  });

  it("does not route a stale priced row after authoritative cancellation", () => {
    const cancelled = recognizeEspnFixture({
      id: fixtures[0].fixtureId,
      competitionId: fixtures[0].competitionId,
      competition: fixtures[0].competition,
      homeTeam: fixtures[0].home,
      awayTeam: fixtures[0].away,
      utcDate: fixtures[0].utcDate,
      status: "CANCELLED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    expect(resolveAskContext(
      "Arsenal vs Coventry City",
      [],
      undefined,
      fixtures,
      [],
      [],
      { recognizedFixtures: [cancelled] }
    )).toMatchObject({
      tier: "fixture",
      capability: { status: "outside-coverage", reason: "model-policy-disabled" },
    });
  });

  it("fails closed on two current recognized fixtures for the same teams", () => {
    const first = recognizedFriendly(800, "Arsenal", "Liverpool");
    const second = recognizedFriendly(801, "Arsenal", "Liverpool");
    expect(resolveAskContext(
      "Arsenal vs Liverpool",
      [],
      undefined,
      [],
      [],
      [],
      { recognizedFixtures: [first, second] }
    )).toEqual({ tier: "candidate" });
  });
  it("keeps general chat available while the active model is empty or unready", () => {
    expect(resolveAskContext(
      "Explain how a high defensive line works.",
      [],
      undefined,
      [],
      []
    )).toEqual({ tier: "general" });
  });

  it("uses Premier League season outlook for title questions without active model fixtures", () => {
    expect(resolveAskContext(
      "Who wins the Premier League?",
      [],
      undefined,
      [],
      [standing()],
      [{ home: "Arsenal", away: "Coventry City" }]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
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

  it("routes a two-team title question to season grounding", () => {
    expect(resolveAskContext(
      "Will Arsenal or Coventry City win the Premier League?",
      [],
      undefined,
      fixtures,
      [standing()]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
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

  it("retains match grounding for conversational follow-ups without an explicit cue", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    for (const question of [
      "Why?",
      "Tell me more",
      "Is that a good bet?",
      "How confident are you?",
      "What's the value there?",
      "And the second half?",
    ]) {
      expect(resolveAskContext(question, [], teamContext, fixtures, []))
        .toMatchObject({ tier: "match", fixture: fixtures[0] });
    }
  });

  // Two phrasings of the relegation/title question used to split across tiers.
  it.each([
    "Who gets relegated?",
    "Which teams go down?",
    "Who is going to finish first?",
  ])("routes %s to the season outlook", (question) => {
    expect(resolveAskContext(question, [], undefined, fixtures, [standing()]))
      .toEqual({ tier: "season", competitionId: "eng.1" });
  });

  // Match grounding carries no standings, so a table question asked mid-match
  // could not be answered from the payload it was being held in.
  it.each([
    "How's the table looking?",
    "Who's top right now?",
    "Where do they sit in the standings?",
    "What does the Premier League table show?",
  ])("lets %s reach competition grounding while a match is in context", (question) => {
    expect(resolveAskContext(
      question,
      [],
      ["Arsenal", "Coventry City"],
      fixtures,
      [standing()]
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
  });

  // The guard on the above: retention exists because "Why?" and "Tell me more"
  // once fell through to the disclaiming general tier. Broadening the table
  // cues must not reopen that.
  it.each([
    "Why?",
    "Tell me more",
    "Is that a good bet?",
    "How confident are you?",
    "What about BTTS?",
    "What about goals?",
  ])("keeps %s on the followed match", (question) => {
    expect(resolveAskContext(
      question,
      [],
      ["Arsenal", "Coventry City"],
      fixtures,
      [standing()]
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
  });

  it("prefers the competition already in view over the league-table fallback", () => {
    const history = [
      { role: "user" as const, content: "How does UCL qualifying look?" },
      { role: "assistant" as const, content: "Here is the current picture." },
    ];

    expect(resolveAskContext(
      "How's the table looking?",
      history,
      undefined,
      fixtures,
      [standing("uefa.champions_qual", "Riga FC")]
    )).toEqual({ tier: "competition", competitionId: "uefa.champions_qual" });
  });

  // Routing keeps grounding on these rather than risking a cue list that drops a
  // genuine follow-up; MATCH_QUESTION_SCOPE is what stops the answer being bent
  // back to the fixture.
  it("still retains match grounding for questions with no match intent", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    for (const question of [
      "What's the weather like?",
      "Who won the 1966 World Cup?",
      "Tell me about VAR",
    ]) {
      expect(resolveAskContext(question, [], teamContext, fixtures, []))
        .toMatchObject({ tier: "match", fixture: fixtures[0] });
    }
  });

  it("releases match grounding once the question names another team", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    expect(resolveAskContext(
      "How is Tottenham Hotspur doing?",
      [],
      teamContext,
      fixtures,
      []
    )).toEqual({ tier: "general" });
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
