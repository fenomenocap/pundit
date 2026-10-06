import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DESK_GENERAL_CONCEPT_SYSTEM, DESK_CURRENT_FACT_SYSTEM, DESK_DATED_CLUB_NEWS_SYSTEM } from "./desk-voice";
import * as evidencePages from "./evidence-page-retrieval";
import { sampleAgentFreshness } from "../config/freshness-policy";
import { AppError } from "../middleware";
import { ModelFixture } from "./model-data";
import * as modelData from "./model-data";
import { fixture } from "./__fixtures__/model-fixture";
import { attachUserLine, buildMatchPricing } from "./response-correctness";
import { SHARED_TOTAL_XG_SENTENCE, STAKE_REFUSAL_SENTENCE } from "./response-composer";
import { SEASON_OUTLOOK_UNAVAILABLE } from "./season-simulator";
import * as seasonSimulator from "./season-simulator";
import {
  espnFixtureIdentity,
  recognizeEspnFixture,
  type RecognizedFixture,
} from "./fixture-registry";
import {
  MATCH_ANSWER_GUARDS,
  MATCH_QUESTION_SCOPE,
  buildCompetitionGrounding,
  buildGrounding,
  findFixture,
  isCompetitionQuestion,
  resolveAskContext,
  resolveCompetitionContext,
  uncoveredTableResponse,
  worldCupRetiredResponse,
  resolveQuestionTeams,
  resolveTeams,
  shouldUseCompetitionGrounding,
  shouldUseMatchGrounding,
  deterministicSearchQuery,
  planEvidenceQueries,
  planTurnEvidenceQueries,
  deliverAnswer,
  attachEvidence,
  MATCH_JSON_REMINDER,
  evidenceAuthority,
  failClosedEmptyCurrentVerification,
  dropMisbucketedTotalsScorelines,
  renderEvidenceCitations,
  repairTruncatedLists,
  stripProcessNarration,
  type EvidenceBundle,
  sanitizeRequestFidelity,
  sanitizeFixtureCoverageAnswer,
  generateOrDegradeToGrounding,
  matchGenerationBudgetMs,
  sanitizeFootballGeometry,
  sanitizeGroundedMatchNarrative,
  sanitizeContradictoryRationales,
  sanitizeManagerEraClaims,
  sanitizeMatchAnswer,
  dropDanglingSectionOpeners,
  composeValueVerdictSentence,
  sanitizeRuntimeResponseCorrectness,
  sanitizeUnrecognizedCandidateAnswer,
  seasonOrCompetitionGrounding,
  prepareAsk,
  getInferenceStatus,
  resetInferenceStatus,
  trackedInference,
  verifiableCurrentClaims,
  verifyCurrentClaims,
  type FixtureGrounding,
  type AskGrounding,
  shouldHoldCoverageDeltas,
  shouldHoldRequestFidelity,
  stripUnvalidatedExternalMarketClaims,
  stripUncitedManagerClaims,
  stripUncitedResultClaims,
  stripUncitedOddsClaims,
  dropOrphanedSectionLabels,
  MATCH_ANALYSIS_PRIORITIES,
  MATCH_CAPABILITY_BOUNDS,
  sanitizeDeliveredAnswer,
  normalizeAnalystIdentity,
  computeMarketDivergence,
  composeMarketDivergenceSentence,
  closedGroundedAnswer,
  deterministicGroundedResponse,
  deterministicUngroundedAnalysis,
  deterministicUngroundedClarification,
  deterministicUngroundedEvidenceFollowUp,
  deterministicCoverageResponse,
  dropLeadingAnswerFragment,
  answerQuestion,
  answerQuestionStream,
  statesMarketDivergence,
  type Grounding,
  type MarketDivergence,
  type SeasonGrounding,
  todayPreamble,
} from "./ask";
import {
  premierLeagueSeasonWindow,
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "./football-data";
import { refreshClubRatings } from "./club-ratings";
import { sampleMatchContextFields } from "./match-context";
import { eloToLambdas } from "./dixon-coles";

const searchWeb = vi.hoisted(() => vi.fn());
const toOutcome = vi.hoisted(() => (results: unknown[]) => ({
  status: results.length ? "ok" : "empty",
  results,
  provider: results.length ? "minimax" : null,
  reason: null,
  usedFallback: false,
  attempts: [],
}));
vi.mock("./web-search", () => ({
  searchWeb: (query: string, signal?: AbortSignal) =>
    Promise.resolve(searchWeb(query, signal)).then(toOutcome),
  searchWebBatch: (queries: string[], signal?: AbortSignal) =>
    Promise.all(queries.map((q) => Promise.resolve(searchWeb(q, signal)).then(toOutcome))),
  withSearchQuestion: (fn: () => unknown) => fn(),
}));

/**
 * Fills in the precomputed model-versus-market field from the payload's own
 * odds, so a hand-built grounding cannot silently carry a divergence that
 * disagrees with its own `oddsSources`.
 */
function withDivergence(
  grounding: Omit<Grounding, "marketDivergence" | "pricing" | "freshness" | keyof ReturnType<typeof sampleMatchContextFields>> & {
    marketDivergence?: MarketDivergence[];
    pricing?: Grounding["pricing"];
    freshness?: Grounding["freshness"];
  } & Partial<ReturnType<typeof sampleMatchContextFields>>
): Grounding {
  const next = {
    ...sampleMatchContextFields(),
    ...grounding,
    freshness: grounding.freshness ?? sampleAgentFreshness(),
    marketDivergence: grounding.marketDivergence
      ?? computeMarketDivergence(grounding, grounding.oddsSources),
  };
  return {
    ...next,
    pricing: next.pricing ?? buildMatchPricing({
      fixtureId: next.fixtureId,
      home: next.home,
      away: next.away,
      kickoff: next.date,
      pricedAt: next.oddsSources[0]?.observedAt ?? next.date,
      pHome: next.pHome,
      pDraw: next.pDraw,
      pAway: next.pAway,
      markets: next.oddsSources.map((source) => ({
        source: source.source,
        observedAt: source.observedAt,
        pHome: source.pHome,
        pDraw: source.pDraw,
        pAway: source.pAway,
        decimalOdds: null,
      })),
    }),
  };
}

describe("season grounding degradation", () => {
  it("uses explicit competition grounding instead of failing when outlook inputs are unavailable", () => {
    const competition = buildCompetitionGrounding("eng.1", [], new Date("2026-08-13T00:00:00Z"));
    expect(seasonOrCompetitionGrounding(null, competition)).toEqual(competition);
    expect(seasonOrCompetitionGrounding(null, competition).kind).toBe("competition");
  });

  it("prepares the same explicit competition fallback for JSON and SSE transports", () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const table = [standing()];
    replaceFootballDataForTests({
      standings: table,
      upcoming: [],
      recent: [],
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
    });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "unknown",
      fixtures: [],
      lastUpdated: null,
      error: "unavailable",
      servingLastGood: false,
    });
    try {
      const jsonPrepared = prepareAsk("Who wins the Premier League?", []);
      const ssePrepared = prepareAsk("Who wins the Premier League?", []);
      expect(jsonPrepared.grounding).toMatchObject({ kind: "competition", competitionId: "eng.1" });
      expect(ssePrepared.grounding).toEqual(jsonPrepared.grounding);
      expect(jsonPrepared.tier).toBe("competition");
      expect(ssePrepared.tier).toBe("competition");
    } finally {
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
      replaceFootballDataForTests({ standings: [], upcoming: [], recent: [], lastUpdated: null, error: null });
      replaceSeasonScheduleForTests({
        competitionId: "eng.1", seasonId: "unknown", fixtures: [], lastUpdated: null,
        error: null, servingLastGood: false,
      });
    }
  });

  it("never emits season probabilities from a complete stale or erroring last-good schedule", async () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const now = new Date();
    const standings = PREMIER_LEAGUE_TEST_TEAMS.map((team, index) => ({
      ...standing("eng.1", team),
      position: index + 1,
    }));
    const schedule = completePremierLeagueSchedule();
    replaceFootballDataForTests({ standings, upcoming: [], recent: [], lastUpdated: now, error: null });
    await refreshClubRatings(now);
    // Routing and source fidelity do not need 10,000 full-season draws for
    // every JSON/SSE turn. Keep the real simulator with a small test sample.
    const simulate = seasonSimulator.simulateSeasonOutlook;
    const simulation = vi.spyOn(seasonSimulator, "simulateSeasonOutlook")
      .mockImplementation((competitionId, table, fixtures, ratings, _runs, random, contributor) =>
        simulate(competitionId, table, fixtures, ratings, 100, random, contributor)
      );
    try {
      for (const unavailable of [
        { seasonId: premierLeagueSeasonWindow(now).seasonId, lastUpdated: now, error: "upstream timeout", servingLastGood: true },
        { seasonId: premierLeagueSeasonWindow(now).seasonId, lastUpdated: new Date(now.getTime() - 7 * 60 * 60 * 1000), error: null, servingLastGood: true },
        { seasonId: "2025-26", lastUpdated: now, error: null, servingLastGood: true },
      ]) {
        replaceSeasonScheduleForTests({
          competitionId: "eng.1",
          fixtures: schedule,
          ...unavailable,
        });
        const prepared = prepareAsk("Who wins the Premier League?", []);
        expect(prepared.tier).toBe("competition");
        expect(prepared.grounding).toMatchObject({ kind: "competition", competitionId: "eng.1" });
        expect(prepared.grounding).not.toHaveProperty("seasonOutlook");
        expect(simulation).not.toHaveBeenCalled();
      }

      replaceSeasonScheduleForTests({
        competitionId: "eng.1",
        seasonId: premierLeagueSeasonWindow(now).seasonId,
        fixtures: schedule,
        lastUpdated: now,
        error: null,
        servingLastGood: false,
      });
      const fresh = prepareAsk("Who wins the Premier League?", []);
      expect(fresh.tier).toBe("season");
      expect(fresh.grounding).toMatchObject({ kind: "season", competitionId: "eng.1" });
      expect(fresh.grounding).toHaveProperty("seasonOutlook.titleProbabilities");
      expect(simulation).toHaveBeenCalledOnce();

      const exactQuestion = "Who is most likely to win the Premier League based on the current table?";
      searchWeb.mockReset();
      searchWeb.mockResolvedValue([]);
      const json = await answerQuestion(exactQuestion);
      expect(searchWeb).not.toHaveBeenCalled();
      expect(json.grounding).toMatchObject({ kind: "season", competitionId: "eng.1" });
      expect(json.answer).toContain("current table alone does not establish an on-field ranking");
      expect(json.answer).not.toMatch(/\*\*Arsenal \d|most likely champion at/i);

      const deltas: string[] = [];
      const groundingKinds: string[] = [];
      const sse = await answerQuestionStream(exactQuestion, [], undefined, {
        onGrounding: (grounding) => groundingKinds.push(grounding?.kind ?? "null"),
        onDelta: (text) => deltas.push(text),
      });
      expect(searchWeb).not.toHaveBeenCalled();
      expect(groundingKinds).toEqual(["season"]);
      expect(deltas).toEqual([sse.answer]);
      expect(sse.answer).toBe(json.answer);

      const firstTurn = "Rank the leading contenders in the Premier League title race using the current table.";
      const firstTurnJson = await answerQuestion(firstTurn);
      expect(searchWeb).not.toHaveBeenCalled();
      expect(firstTurnJson.grounding).toMatchObject({ kind: "season", competitionId: "eng.1" });
      expect(firstTurnJson.answer).toContain("current table alone does not establish an on-field ranking");
      const history = [
        {
          role: "user" as const,
          content: firstTurn,
        },
        { role: "assistant" as const, content: firstTurnJson.answer },
      ];
      const followUp = "Given that the current table cannot rank them, How sensitive is that view to one upset?";
      const followUpJson = await answerQuestion(followUp, history);
      expect(searchWeb).not.toHaveBeenCalled();
      expect(followUpJson.grounding).toMatchObject({ kind: "competition", competitionId: "eng.1" });
      expect(followUpJson.answer).toContain("standings alone cannot quantify");
      expect(followUpJson.answer).toMatch(/^I can’t stress-test/);
      expect(followUpJson.answer).toContain("One upset can move several positions");

      const followUpDeltas: string[] = [];
      const followUpGroundingKinds: string[] = [];
      const followUpSse = await answerQuestionStream(followUp, history, undefined, {
        onGrounding: (grounding) => followUpGroundingKinds.push(grounding?.kind ?? "null"),
        onDelta: (text) => followUpDeltas.push(text),
      });
      expect(searchWeb).not.toHaveBeenCalled();
      expect(followUpGroundingKinds).toEqual(["competition"]);
      expect(followUpDeltas).toEqual([followUpSse.answer]);
      expect(followUpSse.answer).toBe(followUpJson.answer);
      expect(followUpSse.grounding).toEqual(followUpJson.grounding);

      // Every answer above is server-rendered, so none of them may depend on
      // an inference key. Only a turn that needs the model reports the 502.
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      resetInferenceStatus();
      try {
        expect((await answerQuestion(exactQuestion)).answer).toBe(json.answer);
        expect((await answerQuestion(followUp, history)).answer).toBe(followUpJson.answer);
        const keylessSse = await answerQuestionStream(followUp, history, undefined, {
          onGrounding: () => {},
          onDelta: () => {},
        });
        expect(keylessSse.answer).toBe(followUpJson.answer);
      } finally {
        if (openRouterKey !== undefined) process.env.OPENROUTER_API_KEY = openRouterKey;
        resetInferenceStatus();
      }
    } finally {
      simulation.mockRestore();
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
      replaceFootballDataForTests({ standings: [], upcoming: [], recent: [], lastUpdated: null, error: null });
      replaceSeasonScheduleForTests({
        competitionId: "eng.1", seasonId: "unknown", fixtures: [], lastUpdated: null,
        error: null, servingLastGood: false,
      });
    }
  }, 20_000);
});

describe("complete standalone football lessons", () => {
  const lessons = [
    {
      question: "In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?",
      variants: ["How would you assess a slate of football fixtures?", "How do you compare a slate of football fixtures?", "Explain how to assess a football fixture slate."],
      mechanisms: ["relative team strength", "home advantage", "rest", "press may disrupt build-up", "counterattack", "no promise of winners"],
    },
    {
      question: "In general, why should a strong favourite never be treated as a guaranteed win?",
      variants: ["Why can a strong favourite still lose?", "Why is a strong favourite not guaranteed to win?", "Explain why a favourite can lose a football match."],
      mechanisms: ["set piece", "defensive mistake", "Finishing varies", "dismissal", "likeliest winner"],
    },
    {
      question: "In general, how can a derby change the tactical trade-offs and game management?",
      variants: ["How can a derby affect tactics and game management?", "Explain the tactical trade-offs in a derby.", "How might a derby change a team’s tactics?"],
      mechanisms: ["emotional pressure", "uncoordinated jump", "booked defender", "late goal", "actual teams, context and game state"],
    },
    {
      question: "In general, what makes a good chance for a striker, beyond past goal totals?",
      variants: ["What makes a good goalscoring chance?", "How do you assess a striker’s chance quality?", "Explain chance quality beyond past goal totals."],
      mechanisms: ["distance and angle", "defensive pressure", "goalkeeper’s position", "timed run", "pass into stride", "past totals do not guarantee"],
    },
  ];

  it.each(lessons)("answers the full $question with mechanisms and rejects named/current extensions", ({ question, variants, mechanisms }) => {
    const answer = deterministicUngroundedAnalysis(question, null)!;
    for (const mechanism of mechanisms) expect(answer).toContain(mechanism);
    expect(answer).not.toMatch(/\d+(?:\.\d+)?%|70\.6|1\.42|29\.4|verified|team.news|bookmaker|EV%|\bstakes?\b|\*\*/i);
    for (const variant of variants) expect(deterministicUngroundedAnalysis(variant, null)).toBe(answer);
    expect(deterministicUngroundedAnalysis(question.toUpperCase(), null)).toBe(answer);
    expect(deterministicUngroundedAnalysis(question, buildGrounding(fixture("Arsenal", "Leeds")))).toBeNull();
    for (const addition of [" for Arsenal", " for Northbridge", " with Saka", " with today's injuries", " and current odds"]) {
      expect(deterministicUngroundedAnalysis(question.replace(/\?$/, "") + addition + "?", null)).toBeNull();
    }
  });

  it.each(lessons)("bypasses search and inference in JSON, desk and SSE for $question", async ({ question }) => {
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() => { throw new Error("Unexpected answer model call"); });
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const expected = deterministicUngroundedAnalysis(question, null)!;
      for (const voice of [undefined, "desk"] as const) {
        const json = await answerQuestion(question, [], undefined, undefined, undefined, undefined, voice);
        expect(json.answer).toBe(expected);
        expect(json.grounding).toBeNull();
        expect(json.verification.status).toBe("not-required");
      }
      const deltas: string[] = [];
      const stream = await answerQuestionStream(question, [], undefined, {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      });
      expect(deltas).toEqual([stream.answer]);
      expect(stream.answer).toBe(expected);
      expect(create).not.toHaveBeenCalled();
      expect(searchWeb).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it("does not force current searches for stable concepts, but preserves injury, manager, odds and result queries", () => {
    const concept = "Explain why covering a passing lane matters in a press.";
    expect(deterministicSearchQuery(concept, "", null)).toBeNull();
    expect(planTurnEvidenceQueries(concept, null, null, "desk")).toEqual([]);
    for (const question of ["What are Arsenal's current injuries?", "Who is Arsenal's manager today?", "What are Arsenal's current odds?", "What was Arsenal's latest result?"]) {
      const query = deterministicSearchQuery(question, "", null);
      expect(query).not.toBeNull();
      expect(planTurnEvidenceQueries(question, null, query, "desk").length).toBeGreaterThan(0);
      expect(deterministicUngroundedAnalysis(question, null)).toBeNull();
    }
    const evidence = attachEvidence([{ role: "user", content: "Question: odds" }], {
      queries: ["odds"], results: [{ id: "S1", title: "Market", url: "https://example.com/market", date: "2026-10-05", snippet: "A dated market observation.", tier: "other" }], providerCalls: 0,
    });
    expect(JSON.stringify(evidence)).toContain("decimal = 1 / probability");
    expect(JSON.stringify(evidence)).not.toMatch(/70\.6|1\.42|18\.6|5\.38|-470|\+340/);
  });

  it.each([
    { question: "Explain why covering a passing lane matters in a press.", text: "If a defender covers the passing lane, the attacker could need a wider route, leaving more time for support to arrive.", mechanism: "covers the passing lane" },
    { question: "Explain how a 4-4-2 formation can cover central passing lanes.", text: "If a 4-4-2 midfield stays compact, the central players could cover passing lanes while the wide players protect the flanks.", mechanism: "4-4-2 midfield stays compact" },
    { question: "Who manages the space between midfield and defence when a full-back presses?", text: "If the full-back presses, a nearby midfielder could cover the space while the centre-back protects the channel behind.", mechanism: "nearby midfielder could cover the space" },
    { question: "Who manages the space between midfield and defence when a full-back presses, and why?", text: "If the full-back presses, a nearby midfielder could cover the space while the centre-back protects the channel behind.", mechanism: "nearby midfielder could cover the space" },
  ])("uses the concept prompt without primary or secondary latest-news search: $question", async ({ question, text, mechanism }) => {
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockResolvedValue({
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    } as Anthropic.Message);
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const result = await answerQuestion(question, [], undefined, undefined, undefined, undefined, "desk");
      expect(result.answer).toContain(mechanism);
      expect(result.answer).not.toMatch(/verified|team.news|bookmaker/i);
      expect(searchWeb).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0][0]).toMatchObject({ system: DESK_GENERAL_CONCEPT_SYSTEM });
      expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("football latest");
    } finally {
      create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it("replaces the exact failed tactical response with complete conditional mechanisms in either voice", async () => {
    const failed = "I prefer Arsenal 76.7% over the draw 17.5% and Leeds 5.8%.\n\nI would verify the starters before reassessing; any injury to Bukayo Saka or Kai Havertz—Arsenal's top two scorers so far—would change the attack projection, but I cannot quantify that shift without a revised forecast.";
    const grounding = buildGrounding(fixture("Arsenal", "Leeds", { pHome: 0.767, pDraw: 0.175, pAway: 0.058 }));
    const create = vi.fn(() => { throw new Error("Unexpected inference"); });
    for (const voice of [undefined, "desk"] as const) {
      const result = await deliverAnswer({ answer: failed, question: "Tactical matchup", tier: "match", grounding,
        bundle: { queries: [], results: [], providerCalls: 0 }, client: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
        evidenceRequired: false, candidateUnrecognized: false, voice });
      expect(result.answer).toMatch(/Arsenal 76\.7%.*draw 17\.5%.*Leeds 5\.8%/);
      expect(result.answer).toMatch(/first press.*supporting receiver.*turnover/);
      expect(result.answer).toContain("central passing lanes");
      expect(result.answer).toContain("less cover against a counterattack");
      expect(result.answer).not.toMatch(/Saka|Havertz|injury|starters|top two scorers/);
    }
    expect(create).not.toHaveBeenCalled();
    for (const question of ["Tactical matchup with today's injuries", "Tactical matchup and current odds", "Tactical matchup for Northbridge", "How do Man Utd win this?"]) {
      expect(closedGroundedAnswer(question, grounding)).toBeNull();
    }
  });

  it("settles a recognized tactical request consistently in default JSON, desk JSON and SSE without providers", async () => {
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() => { throw new Error("Unexpected provider call"); });
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      const json = await answerQuestion("Tactical matchup", [], ["Arsenal", "Leeds"], undefined, context);
      const desk = await answerQuestion("Tactical matchup", [], ["Arsenal", "Leeds"], undefined, context, undefined, "desk");
      const deltas: string[] = [];
      const stream = await answerQuestionStream("Tactical matchup", [], ["Arsenal", "Leeds"], {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      }, context);
      expect(json.grounding?.kind).toBe("match");
      expect(json.answer).toContain("supporting receiver could become free");
      expect(desk.answer).toBe(json.answer);
      expect(stream.answer).toBe(json.answer);
      expect(deltas).toEqual([stream.answer]);
      expect(create).not.toHaveBeenCalled();
      expect(searchWeb).not.toHaveBeenCalled();
    } finally {
      cached.mockRestore();
      create.mockRestore();
    }
  });

  it.each(["default", "desk", "sse"] as const)("answers every requested part of a composite briefing through $delivery", async (delivery) => {
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10), pHome: 0.767, pDraw: 0.175, pAway: 0.058 });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() => { throw new Error("Unexpected provider call"); });
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      for (const question of [
        "Give me the match briefing for Arsenal vs Leeds. Tactics, who decides it, and the model lean.",
        "Give me the match briefing for Arsenal vs Leeds.",
        "Preview Arsenal vs Leeds with tactics, deciding roles and the model lean.",
      ]) {
        const deltas: string[] = [];
        const result = delivery === "sse"
          ? await answerQuestionStream(question, [], ["Arsenal", "Leeds"], {
            onGrounding: () => {}, onDelta: (text) => deltas.push(text),
          }, context)
          : await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context, undefined, delivery === "desk" ? "desk" : undefined);
        {
          expect(result.grounding?.kind).toBe("match");
          expect(result.answer, question + " / " + delivery).toMatch(/full 1X2 is Arsenal 76\.7%, draw 17\.5% and Leeds 5\.8%/);
          expect(result.answer).toMatch(/first press.*supporting receiver.*turnover/);
          expect(result.answer.indexOf("first press")).toBeLessThan(result.answer.indexOf("Both teams to score"));
          expect(result.answer).toContain("less cover against a counterattack");
          expect(result.answer).toMatch(/screening midfielder.*full-back/);
          expect(result.answer).toMatch(/striker.*cut-back/);
          expect(result.answer).toContain("roles to watch");
          expect(result.answer).not.toMatch(/Saka|Havertz|Bamford|guaranteed|will score|will start/i);
          expect(result.verification.status).toBe("not-required");
        }
        expect(result.answer).toBe(closedGroundedAnswer(question, buildGrounding(model)));
        if (delivery === "sse") expect(deltas).toEqual([result.answer]);
      }
      for (const question of ["What are the 1X2 probabilities?", "Is Arsenal vs Leeds over 2.5?", "Projected score"]) {
        const numeric = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context);
        expect(numeric.answer).not.toMatch(/first press|roles to watch|screening midfielder/);
      }
      expect(create).not.toHaveBeenCalled();
      expect(searchWeb).not.toHaveBeenCalled();
    } finally {
      cached.mockRestore();
      create.mockRestore();
    }
  });

  it("does not let a composite briefing skip its explicit current-injury search", async () => {
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockResolvedValue({
      content: [{ type: "text", text: "I cannot verify any current injury update." }], stop_reason: "end_turn",
    } as Anthropic.Message);
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const question = "Give me the match briefing for Arsenal vs Leeds. Tactics, who decides it, and the model lean, with today's injuries.";
      expect(closedGroundedAnswer(question, buildGrounding(model))).toBeNull();
      const context = { fixtureId: espnFixtureIdentity(model) };
      for (const voice of [undefined, "desk"] as const) {
        searchWeb.mockClear();
        const result = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context, undefined, voice);
        expect(searchWeb).toHaveBeenCalled();
        expect(result.answer).not.toMatch(/Saka|Havertz|Bamford|will start|available today/i);
      }
      searchWeb.mockClear();
      const stream = await answerQuestionStream(question, [], ["Arsenal", "Leeds"], { onGrounding: () => {}, onDelta: () => {} }, context);
      expect(searchWeb).toHaveBeenCalled();
      expect(stream.answer).not.toMatch(/Saka|Havertz|Bamford|will start|available today/i);
    } finally {
      cached.mockRestore();
      create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it.each([
    { question: "Who is Arsenal's manager today?", unsupported: "Pat Doe is Arsenal's current manager." },
    { question: "What was Arsenal's latest result?", unsupported: "Arsenal won 3-0 yesterday." },
  ])("preserves desk search and source abstention for missing current evidence: $question", async ({ question, unsupported }) => {
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockResolvedValue({
      content: [{ type: "text", text: unsupported }],
      stop_reason: "end_turn",
    } as Anthropic.Message);
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const result = await answerQuestion(question, [], undefined, undefined, undefined, undefined, "desk");
      expect(searchWeb).toHaveBeenCalled();
      expect(result.answer).toMatch(/no verified|could not verify|couldn’t verify|cannot establish|was not verified/i);
      expect(result.answer).not.toMatch(/Pat Doe|won \d|lost \d|\d+-\d+/);
      expect(create.mock.calls[0][0]).not.toMatchObject({ system: DESK_GENERAL_CONCEPT_SYSTEM });
    } finally {
      create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it("does not replace a searched tactical turn with a not-required answer", async () => {
    const grounding = buildGrounding(fixture("Arsenal", "Leeds"));
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "[]" }], stop_reason: "end_turn" });
    const result = await deliverAnswer({ answer: "No verified, dated team-news update was established.", question: "Tactical matchup", tier: "match", grounding,
      bundle: { queries: ["Arsenal Leeds injuries today"], results: [], providerCalls: 1 }, client: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
      evidenceRequired: true, candidateUnrecognized: false });
    expect(result.verification.status).not.toBe("not-required");
  });

  it("keeps sourced current identities/results/prices, refusals and general hypotheticals while removing bare claims", () => {
    for (const [guard, bare, sourced] of [
      [stripUncitedManagerClaims, "Pat Doe is Arsenal's current manager.", "Pat Doe is Arsenal's current manager [[S1]]."],
      [stripUncitedResultClaims, "Arsenal won 3-0 yesterday.", "Arsenal won 3-0 yesterday [[S1]]."],
      [stripUncitedOddsClaims, "Arsenal are priced at 1.42 today.", "Arsenal are priced at 1.42 today [[S1]]."],
    ] as const) {
      expect(guard(bare)).not.toBe(bare);
      expect(guard(sourced)).toBe(sourced);
      const refusal = "I cannot verify Arsenal's current manager, latest result or current odds.";
      expect(guard(refusal)).toBe(refusal);
      for (const suffix of [", but I cannot guarantee the result.", ", and no verified team-news update was established."]) {
        expect(guard(bare.replace(/\.$/, "") + suffix)).not.toContain(bare.replace(/\.$/, ""));
      }
    }
    const hypothetical = "If a manager changes the pressing trigger, the opponent could need another passing route.";
    expect(stripUncitedManagerClaims(hypothetical)).toBe(hypothetical);
    expect(stripUncitedManagerClaims("A coach is responsible for coordinating the press.")).toBe("A coach is responsible for coordinating the press.");
    expect(stripUncitedManagerClaims("Teams are organised by their coach.")).toBe("Teams are organised by their coach.");
    const appositive = "Pat Doe, Arsenal’s current manager, is reviewing their pressing shape.";
    expect(stripUncitedManagerClaims(appositive)).not.toContain("Pat Doe");
    expect(stripUncitedManagerClaims(`${appositive.slice(0, -1)} [[S1]].`)).toBe(`${appositive.slice(0, -1)} [[S1]].`);
    for (const [guard, hypothesis, refusal] of [
      [stripUncitedManagerClaims, "If Pat Doe were Arsenal's manager, he could change the pressing trigger.", "I cannot verify whether Pat Doe is Arsenal's current manager."],
      [stripUncitedResultClaims, "If Arsenal won 3-0, they could have more room to rotate in the return leg.", "I cannot verify whether Arsenal won 3-0 yesterday."],
      [stripUncitedOddsClaims, "If Arsenal were priced at 1.42, that could imply a different forecast from another price.", "I cannot verify whether Arsenal are priced at 1.42 today."],
    ] as const) {
      expect(guard(hypothesis)).toBe(hypothesis);
      expect(guard(refusal)).toBe(refusal);
    }
    for (const claim of [
      "If Arsenal press, Pat Doe remains their current manager.",
      "Pat Doe is Arsenal’s current manager, but I cannot guarantee the result.",
      "I cannot verify the result, and Pat Doe is Arsenal's current manager.",
    ]) expect(stripUncitedManagerClaims(claim)).not.toContain("Pat Doe");
    for (const verb of ["manages", "coaches"]) {
      const claim = `Pat Doe ${verb} Arsenal.`;
      expect(stripUncitedManagerClaims(claim)).not.toContain("Pat Doe");
      const sourced = `Pat Doe ${verb} Arsenal [[S1]].`;
      expect(stripUncitedManagerClaims(sourced)).toBe(sourced);
      const refusal = `I cannot verify whether Pat Doe ${verb} Arsenal.`;
      expect(stripUncitedManagerClaims(refusal)).toBe(refusal);
      const hypothetical = `If Pat Doe ${verb} Arsenal, he could change the pressing trigger.`;
      expect(stripUncitedManagerClaims(hypothetical)).toBe(hypothetical);
    }
  });

  it("does not let colon or prose-dash refusals shelter a separate current fact", () => {
    for (const [guard, claim, fact] of [
      [stripUncitedManagerClaims, "Pat Doe is Arsenal’s current manager: I cannot verify the sources.", "Pat Doe"],
      [stripUncitedResultClaims, "Arsenal won 3-0 yesterday — I cannot confirm the report.", "Arsenal won"],
      [stripUncitedOddsClaims, "Betfair quotes 1.82 for Arsenal: I cannot verify the feed.", "1.82"],
      [stripUncitedResultClaims, "Arsenal won 3–0 yesterday – I cannot verify the report.", "Arsenal won"],
      [stripUncitedManagerClaims, "Pat Doe is Arsenal’s current manager—I cannot verify the sources.", "Pat Doe"],
    ] as const) expect(guard(claim)).not.toContain(fact);
    const bareScore = "Arsenal won 3–0 yesterday.";
    const sourcedScore = "Arsenal won 3–0 yesterday [[S1]].";
    const refusal = "I cannot verify whether Arsenal won 3–0 yesterday.";
    expect(stripUncitedResultClaims(bareScore)).not.toContain("Arsenal won");
    expect(stripUncitedResultClaims(sourcedScore)).toBe(sourcedScore);
    expect(stripUncitedResultClaims(refusal)).toBe(refusal);
    const managerRefusal = "I cannot verify whether Pat Doe is Arsenal’s current manager.";
    expect(stripUncitedManagerClaims(managerRefusal)).toBe(managerRefusal);
    const citedPrice = "Betfair quotes 1.82 for Arsenal [[S1]]: I cannot verify a later feed.";
    expect(stripUncitedOddsClaims(citedPrice)).toBe(citedPrice);
    for (const nonPrice of ["Betfair quotes 1.82 shots per game.", "Betfair quotes Arsenal's 3–0 result.", "The article quotes a coach discussing pressing."]) {
      expect(stripUncitedOddsClaims(nonPrice)).toBe(nonPrice);
    }
  });

  it.each([
    { question: "Who is Arsenal's manager today?", bare: "Pat Doe." },
    { question: "Who’s Arsenal’s manager today?", bare: "It’s Pat Doe." },
    { question: "Who manages Arsenal today?", bare: "It’s Pat Doe." },
    { question: "What was Arsenal's latest result?", bare: "Arsenal 3–0." },
    { question: "What are Arsenal's current odds?", bare: "Arsenal 1.82." },
    { question: "What’s Arsenal’s current price?", bare: "1.82." },
    { question: "What are Betfair's current odds for Arsenal and why?", bare: "Betfair 1.82." },
  ])("does not let a bare direct $question answer escape an empty mandatory search", async ({ question, bare }) => {
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockResolvedValue({
      content: [{ type: "text", text: bare }], stop_reason: "end_turn",
    } as Anthropic.Message);
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, [], undefined, undefined, undefined, undefined, voice);
        expect(result.grounding).toBeNull();
        expect(result.answer).not.toContain(bare.replace(/\.$/, ""));
        expect(result.answer).toMatch(/verify|verified/i);
      }
      const deltas: string[] = [];
      const result = await answerQuestionStream(question, [], undefined, {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      });
      expect(searchWeb).toHaveBeenCalled();
      expect(result.grounding).toBeNull();
      expect(result.answer).not.toContain(bare.replace(/\.$/, ""));
      expect(result.answer).toMatch(/verify|verified/i);
      expect(deltas).toEqual([result.answer]);
    } finally {
      create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it.each([
    { question: "Who is Arsenal's manager and why?", title: "Arsenal manager appointment", prose: "Pat Doe is Arsenal's current manager [[S1]]. The club said his appointment reflected his experience developing young players [[S1]].", fact: /Pat Doe is Arsenal.s current manager/, reason: /experience developing young players/ },
    { question: "What is Arsenal's latest result and why?", title: "Arsenal vs Brighton: match report", prose: "The dated result I found was Arsenal 3–0 Brighton on 4 October 2026 [[S1]]. The report attributes the win to defensive errors [[S1]].", fact: /Arsenal 3[–-]0 Brighton/, reason: /defensive errors/ },
  ].flatMap((scenario) => [
    { ...scenario, accepted: true, sourceDate: "2026-10-04", outcome: "supported" },
    { ...scenario, accepted: false, sourceDate: "2026-10-04", outcome: "conflict" },
    { ...scenario, accepted: false, sourceDate: "2026-10-04", outcome: "unsupported" },
    { ...scenario, accepted: false, sourceDate: "", outcome: "supported" },
    { ...scenario, accepted: false, sourceDate: "2026-07-01", outcome: "supported" },
  ]))("keeps dated club-fact verification authoritative beyond the pinned opponent: $question ($outcome, $sourceDate)", async ({ question, title, prose, fact, reason, accepted, sourceDate, outcome }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const source = { title, link: "https://www.arsenal.com/news/dated-report", snippet: prose.replace(/\[\[S1\]\]/g, ""), date: sourceDate };
    const prefetch = vi.spyOn(evidencePages, "prefetchEvidencePages").mockImplementation(() => {});
    const retrieve = vi.spyOn(evidencePages, "retrieveEvidencePages").mockImplementation(async (candidates) => candidates.map((candidate) => ({
      ...candidate, finalUrl: candidate.url, text: source.snippet, retrievedAt: new Date().toISOString(),
    })));
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
      const input = params as Anthropic.MessageCreateParamsNonStreaming;
      const verifying = String(input.system).startsWith("You are Pundit's bounded factual claim verifier.");
      const data = verifying ? JSON.parse(String(input.messages[0].content).split("Verify these claims against these pages: ")[1]) : null;
      if (!verifying) {
        expect(input.system).toBe(DESK_CURRENT_FACT_SYSTEM);
        expect(String(input.messages.at(-1)?.content)).toContain("FOCUS CLUB: Arsenal");
        expect(String(input.messages.at(-1)?.content)).not.toContain("MATCH CARD");
      }
      return Promise.resolve({ content: [{ type: "text", text: verifying ? JSON.stringify({ decisions: data.claims.map((claim: { id: string }) => ({ claimId: claim.id, outcome, evidenceIds: ["S2"] })), summary: "Assessed against the club report." }) : prose.replace(/\[\[S1\]\]/g, "[[S2]]") }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
    });
    searchWeb.mockReset();
    // The relevant source starts after an unrelated opponent report. The
    // writer and verifier must share the same original source IDs in all voices.
    searchWeb.mockResolvedValue([{ title: "Leeds vs Chelsea: report", link: "https://www.chelseafc.com/news/unrelated", snippet: "Chelsea won against Leeds.", date: "2026-10-04" }, source]);
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context, undefined, voice);
        expect(result.grounding?.kind).toBe("match");
        if (accepted) {
          expect(result.answer).toMatch(fact);
          expect(result.answer).toMatch(reason);
          expect(result.verification?.supportedClaimCount).toBe(2);
          expect(result.citations?.[0]?.url).toBe(source.link);
          expect(result.answer).toContain(source.link);
        } else {
          expect(result.answer).not.toMatch(fact);
          expect(result.answer).not.toMatch(reason);
          expect(result.answer).toMatch(/verify|verified|conflict/i);
          expect(result.verification?.supportedClaimCount).toBe(0);
          expect(result.citations ?? []).toEqual([]);
        }
        expect(result.answer).not.toMatch(/\d+%|My 1X2|\[\[S1\]\]/i);
        expect(result.answer).not.toMatch(/\)\)\s*·|\)\s*·[^\n]+\)\)/);
      }
      const deltas: string[] = [];
      const streamed = await answerQuestionStream(question, [], ["Arsenal", "Leeds"], {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      }, context);
      if (accepted) {
        expect(streamed.answer).toMatch(fact);
        expect(streamed.answer).toMatch(reason);
        expect(streamed.verification?.supportedClaimCount).toBe(2);
      } else {
        expect(streamed.answer).not.toMatch(fact);
        expect(streamed.answer).not.toMatch(reason);
        expect(streamed.verification?.supportedClaimCount).toBe(0);
        expect(streamed.citations ?? []).toEqual([]);
      }
      expect(deltas).toEqual([streamed.answer]);
      expect(searchWeb.mock.calls.some(([query]) => /Arsenal.*official/i.test(query))).toBe(true);
      expect(searchWeb.mock.calls.some(([query]) => /Leeds|injur|recent form/i.test(query))).toBe(false);
    } finally {
      create.mockRestore(); retrieve.mockRestore(); prefetch.mockRestore(); cached.mockRestore();
      vi.useRealTimers();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it("does not treat citation presence as a verified answer to a direct current fact request", async () => {
    const result = await deliverAnswer({
      answer: "No verified result was established [[S1]].", question: "What was Arsenal's latest result?",
      tier: "general", grounding: null, voice: "desk", evidenceRequired: true, candidateUnrecognized: false,
      bundle: { queries: ["Arsenal latest result"], providerCalls: 1, results: [{
        id: "S1", title: "Unestablished report", url: "https://example.com/report", date: "2026-10-05", snippet: "No verified result.", tier: "news",
      }] }, client: { messages: { create: vi.fn() } } as unknown as Pick<Anthropic, "messages">,
    });
    expect(result.verification.supportedClaimCount).toBe(0);
    expect(result.answer).toMatch(/couldn’t verify that result/i);
    expect(result.citations).toEqual([]);
    expect(result.answer).not.toMatch(/example\.com|S1/);
  });

  it.each([
    { question: "Who’s Arsenal’s manager today?", bare: "It’s Pat Doe.", refusal: /couldn’t verify that current claim/i },
    { question: "What was Arsenal’s latest result?", bare: "Arsenal 3–0.", refusal: /couldn’t verify that result/i },
    { question: "What's Arsenal's manager today?", bare: "It’s Pat Doe.", refusal: /couldn’t verify that current claim/i },
    { question: "Who is Arsenal's manager and why?", bare: "It’s Pat Doe.", refusal: /couldn’t verify that current claim/i },
    { question: "What's Arsenal's latest result and why?", bare: "Arsenal 3–0.", refusal: /couldn’t verify that result/i },
    { question: "What are Betfair's current odds for Arsenal and why?", bare: "Betfair 1.82.", refusal: /verify|verified|model|probabilit|1X2/i, externalPrice: true },
    { question: "What are Betfair's current odds for Arsenal and how do they compare with the model?", bare: "Betfair 1.82.", refusal: /verify|verified|model|probabilit|1X2/i, externalPrice: true },
  ])("requires verified direct $question even with an active match pin in both voices and SSE", async ({ question, bare, refusal, externalPrice }) => {
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockResolvedValue({
      content: [{ type: "text", text: bare }], stop_reason: "end_turn",
    } as Anthropic.Message);
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context, undefined, voice);
        expect(result.grounding?.kind).toBe("match");
        expect(searchWeb).toHaveBeenCalled();
        expect(result.answer).toMatch(refusal);
        expect(result.answer).not.toContain(bare.replace(/\.$/, ""));
        if (!externalPrice) expect(result.answer).not.toMatch(/Pat Doe|3[–-]0|My 1X2|\d+%/);
      }
      const deltas: string[] = [];
      const stream = await answerQuestionStream(question, [], ["Arsenal", "Leeds"], {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      }, context);
      expect(stream.grounding?.kind).toBe("match");
      expect(stream.answer).toMatch(refusal);
      expect(stream.answer).not.toContain(bare.replace(/\.$/, ""));
      if (!externalPrice) expect(stream.answer).not.toMatch(/Pat Doe|3[–-]0|My 1X2|\d+%/);
      expect(deltas).toEqual([stream.answer]);
    } finally {
      cached.mockRestore();
      create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });
});

describe("current verification failure preserves supplied history scope", () => {
  it.each(["unavailable", "unsupported"] as const)("does not deny prior cited history when fresh verification is %s", async (outcome) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    await refreshClubRatings(new Date());
    const kickoff = "2026-10-06T15:00:00Z";
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const datedSource = { title: "Arsenal manager update", link: "https://www.arsenal.com/news/manager-update", date: "2026-10-04", snippet: "Pat Doe is Arsenal's current manager." };
    const prefetch = vi.spyOn(evidencePages, "prefetchEvidencePages").mockImplementation(() => {});
    const retrieve = vi.spyOn(evidencePages, "retrieveEvidencePages").mockImplementation(async (candidates) => candidates.map((candidate) => ({ ...candidate, finalUrl: candidate.url, text: datedSource.snippet, retrievedAt: new Date().toISOString() })));
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
      const input = params as Anthropic.MessageCreateParamsNonStreaming;
      if (String(input.system).startsWith("You are Pundit's bounded factual claim verifier.")) {
        if (outcome === "unavailable") return Promise.reject(new Error("Verification unavailable")) as ReturnType<typeof Anthropic.Messages.prototype.create>;
        const evidence = JSON.parse(String(input.messages[0].content).split("Verify these claims against these pages: ")[1]);
        return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ decisions: evidence.claims.map((claim: { id: string }) => ({ claimId: claim.id, outcome: "unsupported", evidenceIds: [] })), summary: "Not established." }) }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      }
      return Promise.resolve({ content: [{ type: "text", text: "Pat Doe is Arsenal's current manager [[S1]]." }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
    });
    searchWeb.mockReset(); searchWeb.mockResolvedValue([datedSource]);
    const history = [
      { role: "user" as const, content: "What's Arsenal's manager today?" },
      { role: "assistant" as const, content: "Mikel Arteta is Arsenal's manager ([Dated manager report](https://www.skysports.com/football/news/manager-report) · 22 Sep)." },
    ];
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      const question = "Who is Arsenal's manager and why?";
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, history, ["Arsenal", "Leeds"], undefined, context, undefined, voice);
        expect(result.answer).toMatch(/couldn’t verify that current claim.*for this answer/i);
        expect(result.answer).not.toMatch(/no verified current source in this conversation|Mikel Arteta|Pat Doe|My 1X2|\d+%/i);
        expect(result.citations ?? []).toEqual([]);
        expect(result.verification?.status).toBe(outcome === "unavailable" ? "unavailable" : "abstain");
        expect(result.verification?.supportedClaimCount).toBe(0);
        expect(result.verification?.removedClaimCount).toBe(1);
      }
      const deltas: string[] = [];
      const streamed = await answerQuestionStream(question, history, ["Arsenal", "Leeds"], { onGrounding: () => {}, onDelta: (text) => deltas.push(text) }, context);
      expect(streamed.answer).toMatch(/couldn’t verify that current claim.*for this answer/i);
      expect(streamed.answer).not.toMatch(/no verified current source in this conversation|Mikel Arteta|Pat Doe|\d+%/i);
      expect(streamed.citations ?? []).toEqual([]);
      expect(streamed.verification?.status).toBe(outcome === "unavailable" ? "unavailable" : "abstain");
      expect(streamed.verification?.supportedClaimCount).toBe(0);
      expect(streamed.verification?.removedClaimCount).toBe(1);
      expect(deltas).toEqual([streamed.answer]);
      // Each of the three formats performs the bounded four-query evidence plan.
      expect(searchWeb).toHaveBeenCalledTimes(12);
    } finally {
      cached.mockRestore(); prefetch.mockRestore(); retrieve.mockRestore(); create.mockRestore();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY; else process.env.MINIMAX_API_KEY = saved;
      vi.useRealTimers();
    }
  });
});

describe("expired rating artifact routing", () => {
  it("does not treat a retained cached model row as priced", () => {
    const fixture = {
      competitionId: "eng.1",
      competition: "Premier League",
      fixtureId: 1,
      utcDate: "2026-08-15T14:00:00.000Z",
      date: "2026-08-15",
      group: null,
      stage: "match",
      home: "Arsenal",
      away: "Liverpool",
      homeElo: 1850,
      awayElo: 1840,
      pHome: 0.42,
      pDraw: 0.28,
      pAway: 0.3,
      pOver2_5: 0.55,
      pUnder2_5: 0.45,
      pBttsYes: 0.58,
      pBttsNo: 0.42,
      topScores: [],
      scorelines: [],
      stakePHome: null,
      stakePDraw: null,
      stakePAway: null,
      result: null,
    } satisfies ModelFixture;
    const recognized = recognizeEspnFixture({
      id: 1,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      utcDate: fixture.utcDate,
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
      neutralVenue: false,
    });
    expect(resolveAskContext(
      "Arsenal vs Liverpool 1X2",
      [],
      undefined,
      [fixture],
      [],
      [],
      {
        recognizedFixtures: [recognized],
        modelInitialized: true,
        ratingsAvailable: false,
      }
    )).toMatchObject({
      tier: "fixture",
      capability: { status: "insufficient-model-input", reason: "ratings-unavailable" },
    });
  });
});

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

  it("does not search for current facts already owned by structured grounding", () => {
    const match = {
      kind: "match", home: "Arsenal", away: "Coventry",
    } as unknown as Grounding;
    const competition = {
      kind: "competition", competitionId: "eng.1", competition: "Premier League",
      updatedAt: new Date().toISOString(), standings: [],
    } as unknown as Parameters<typeof deterministicSearchQuery>[2];
    expect(deterministicSearchQuery("What are Pundit's current 1X2 probabilities?", "", match))
      .toBeNull();
    expect(deterministicSearchQuery("What does the current table show?", "", competition))
      .toBeNull();
    expect(deterministicSearchQuery("What are the current odds?", "", match))
      .toContain("football latest");
    expect(deterministicSearchQuery("Is the current manager injured?", "", match))
      .toContain("football latest");
  });

  it("owes a search for statistical questions without widening current-news cues", () => {
    const match = {
      kind: "match", home: "Arsenal", away: "Coventry",
    } as unknown as Grounding;
    const mbeumo = "How has Bryan Mbeumo performed statistically this season?";
    expect(deterministicSearchQuery(mbeumo)).toContain("football latest");
    const planned = planEvidenceQueries(mbeumo, null, deterministicSearchQuery(mbeumo));
    expect(planned.length).toBeGreaterThanOrEqual(2);
    expect(planned.some((query) => /stats/.test(query))).toBe(true);
    expect(deterministicSearchQuery("Explain the offside rule")).toBeNull();
    expect(planEvidenceQueries("Explain the offside rule", null, null)).toEqual([]);
    expect(deterministicSearchQuery("What are Pundit's current 1X2 probabilities?", "", match))
      .toBeNull();
    expect(deterministicSearchQuery("Is it over 2.5 goals?", "", match)).toBeNull();
    expect(planEvidenceQueries("Is it over 2.5 goals?", match, null)
      .some((query) => /\bstats\b/.test(query))).toBe(false);
  });

  it("searches a question about how a club is doing this season instead of answering from memory", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(deterministicSearchQuery("How are Chelsea doing this season?", "", null, now))
      .toBe("How are Chelsea doing this season? football latest 2026-27");
    expect(deterministicSearchQuery("Explain the offside rule", "", null, now)).toBeNull();
  });

  it("pins the base search query to the current season unless the question names a year", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(deterministicSearchQuery("Who will win Serie A?", "", null, now))
      .toBe("Who will win Serie A? football latest 2026-27");
    expect(deterministicSearchQuery("Who won Serie A in 2024?", "", null, now))
      .toBe("Who won Serie A in 2024? football latest");
  });

  it("plans no search for a follow-up about the numbers, and keeps it for a news cue", () => {
    const match = buildGrounding(fixture("Arsenal", "Leeds"));
    for (const question of [
      "Why do you think the draw is so likely?",
      "Where is the model most confident here and why?",
      "Is the home side a real favourite or just marginal?",
    ]) {
      expect(planEvidenceQueries(question, match, deterministicSearchQuery(question, "", match)), question)
        .toEqual([]);
    }
    const news = "Any injury concerns that change the read?";
    expect(planEvidenceQueries(news, match, deterministicSearchQuery(news, "", match)).length)
      .toBeGreaterThan(0);
  });

  it("holds model-only and history-bearing SSE turns until request-fidelity guards settle", () => {
    expect(shouldHoldRequestFidelity("Which side has the stronger model case, and why?", false))
      .toBe(true);
    expect(shouldHoldRequestFidelity("What evidence would change that answer?", true)).toBe(true);
    expect(shouldHoldRequestFidelity("Explain the offside rule", false)).toBe(false);
  });

  it("does not promote unknown search domains to reputable evidence", () => {
    expect(evidenceAuthority("https://www.uefa.com/story")).toBe("official");
    expect(evidenceAuthority("https://www.arsenal.com/news/team-update")).toBe("official");
    expect(evidenceAuthority("https://www.reuters.com/story")).toBe("reputable");
    // Other top leagues: first-party league sites and national sports press.
    expect(evidenceAuthority("https://www.legaseriea.it/en/news")).toBe("official");
    expect(evidenceAuthority("https://www.football-italia.net/story")).toBe("reputable");
    expect(evidenceAuthority("https://sports.yahoo.com/soccer/story")).toBe("reputable");
    // Fan sites, betting affiliates and lookalike hosts stay closed.
    expect(evidenceAuthority("https://sempremilan.com/story")).toBe("other");
    expect(evidenceAuthority("https://www.bitsler.com/odds")).toBe("other");
    expect(evidenceAuthority("https://gazzetta.it.evil.example/story")).toBe("other");
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

  it("keeps the model's own numbers and the prompt-mandated no-market sentence", () => {
    // MATCH_SYSTEM_PROMPT tells the model to say plainly when no market source
    // is present. That sentence used to trigger the market guard, which then
    // deleted up to four following numeric lines -- the whole answer body.
    const reported = [
      "**Verdict**",
      "No Kalshi market is available.",
      "Man United win **77.6%**, draw **14.2%**, Hull **8.2%**.",
      "Over 2.5 sits at **77.6%**.",
      "BTTS No at **61.0%**.",
    ].join("\n");
    expect(stripUnvalidatedExternalMarketClaims(reported)).toBe(reported);
    expect(sanitizeMatchAnswer(reported)).toContain("77.6%");
    expect(sanitizeMatchAnswer(reported)).not.toContain("omitted those numbers");

    for (const survivor of [
      "No Kalshi or Polymarket line is available for this fixture.\nThe model has the home side at **48.0%**.",
      "Neither bookmaker line is available, so the model's **55.0%** stands alone.",
      // "stake" is also an ordinary English noun.
      "Three points are at stake for both sides.\nLiverpool win **55.5%**, draw **24.0%**, Everton **20.5%**.",
      // A model line under a market heading is not a market quote.
      "**Market**\nNo market source is present.\n\n**Verdict**\nMan City win **70.1%**, draw **18.2%**, Burnley **11.7%**.",
    ]) expect(stripUnvalidatedExternalMarketClaims(survivor)).toBe(survivor);
  });

  it("still removes an asserted external market price, including bare decimal quotes", () => {
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "The bookmakers price the draw at 3.40 and the away win at 3.60.",
      "Polymarket prices the home win at 58.0%.",
      "Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%.",
      "Stake market: home 2.10, draw 3.40, away 3.60.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced);
      expect(sanitized).toContain("omitted those numbers");
      expect(sanitized).not.toMatch(/\d+(?:\.\d+)?%|\b\d+\.\d\d\b/);
    }
    // Only the priced clause goes; neighbouring model prose survives intact.
    const mixed = stripUnvalidatedExternalMarketClaims([
      "Polymarket prices the home win at 58.0%.",
      "The model has the home win at **77.6%**.",
      "Over 2.5 sits at **54.0%**.",
    ].join("\n"));
    expect(mixed).not.toContain("58.0%");
    expect(mixed).toContain("**77.6%**");
    expect(mixed).toContain("**54.0%**");
  });

  it("drops a section label the guards emptied and keeps one whose body follows a blank line", () => {
    expect(dropOrphanedSectionLabels(
      "**Verdict**\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market."
    )).toBe("**Verdict**\n\nI could not establish a complete same-source, same-time bookmaker 1X2 market.");
    expect(dropOrphanedSectionLabels("**Verdict**")).toBe("");
    expect(dropOrphanedSectionLabels(
      "**Verdict**\n\n**Read on the underdog**\nAshcombe need a low-scoring game."
    )).toBe("**Read on the underdog**\nAshcombe need a low-scoring game.");
    const intact = "**Verdict**\nArsenal win **61.0%**.\n\n**Likely scorelines**\n**2-1 (11.4%)** leads.";
    expect(dropOrphanedSectionLabels(intact)).toBe(intact);

    // End to end: the guard removes a real market quote and its heading goes too.
    expect(dropOrphanedSectionLabels(sanitizeMatchAnswer([
      "**Verdict**",
      "Stake market: home 2.10, draw 3.40, away 3.60.",
      "",
      "**Read on the underdog**",
      "Ashcombe need the game to stay low-scoring.",
    ].join("\n")))).toBe([
      "**Read on the underdog**",
      "Ashcombe need the game to stay low-scoring.",
      "",
      "I could not establish a complete same-source, same-time bookmaker 1X2 market from server-owned evidence, so I have omitted those numbers.",
    ].join("\n"));
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

  it("strips uncited season stats when claim verification is unavailable", async () => {
    const bundle = {
      queries: ["mbeumo stats"],
      providerCalls: 0,
      results: [
        { id: "S1", title: "Stats", url: "https://uefa.com/mbeumo", date: "2026-09-07", snippet: "2 goals.", tier: "official" as const },
      ],
    };
    const checked = await verifyCurrentClaims(
      "The verified 2026/27 line is 2 goals in 3 starts (180 mins), 0 assists, with a 7.73 FotMob rating. Mbeumo has 2 goals [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "Unrelated page.",
          retrievedAt: "2026-09-08T00:00:00.000Z",
        })),
        verify: async () => ({
          status: "unavailable",
          decisions: [{ claimId: "C1", outcome: "unsupported", evidenceIds: [] }],
          summary: "timeout",
        }),
      }
    );
    expect(checked.answer).not.toMatch(/180 mins|FotMob rating/i);
    expect(checked.answer).not.toMatch(/Mbeumo has 2 goals/);
    expect(checked.verification.status).toBe("unavailable");
  });

  it("binds accepted claims to the verifier-selected server evidence ID", async () => {
    const bundle = {
      queries: ["current manager"],
      providerCalls: 0,
      results: [
        { id: "S1", title: "Official", url: "https://uefa.com/one", date: "2026-08-13", snippet: "Pat Doe is manager.", tier: "official" as const },
        { id: "S2", title: "Other", url: "https://news.example/two", date: "2026-08-13", snippet: "Unrelated.", tier: "other" as const },
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

  it("writes extracted publication dates back onto matching bundle results", async () => {
    const bundle: EvidenceBundle = {
      queries: ["tottenham form"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Spurs form",
        url: "https://uefa.com/spurs",
        date: "",
        snippet: "Tottenham going winless across their opening three league games.",
        tier: "official" as const,
      }],
    };
    const checked = await verifyCurrentClaims(
      "Tottenham are winless in three [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.map((candidate) => ({
          ...candidate,
          date: "2026-09-06",
          finalUrl: candidate.url,
          text: "Tottenham Hotspur going winless across their opening three league games.",
          retrievedAt: "2026-09-08T12:00:00.000Z",
        })),
        verify: async (_client, _claims, pages) => ({
          status: "verified",
          decisions: [{
            claimId: "C1",
            outcome: "supported",
            evidenceIds: pages.some((page) => page.date === "2026-09-06") ? ["S1"] : [],
          }],
          summary: "supported",
        }),
      }
    );
    expect(bundle.results[0].date).toBe("2026-09-06");
    expect(checked.answer).toContain("winless in three [[S1]]");
    expect(checked.verification).toEqual({
      status: "verified",
      supportedClaimCount: 1,
      removedClaimCount: 0,
    });
  });

  it("verifies a cited claim from a dated snippet when every page fetch fails", async () => {
    const bundle: EvidenceBundle = {
      queries: ["mbeumo stats"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Bryan Mbeumo stats",
        url: "https://www.premierleague.com/en/players/542645/Bryan-Mbeumo/stats",
        date: "2026-09-07",
        snippet: "Appearances 3, Goals 2.",
        tier: "official" as const,
      }],
    };
    const verify = vi.fn(async (_client, _claims, pages) => {
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe("S1");
      expect(pages[0].date).toBe("2026-09-07");
      expect(pages[0].text).toContain("Goals 2");
      return {
        status: "verified" as const,
        decisions: [{ claimId: "C1", outcome: "supported" as const, evidenceIds: ["S1"] }],
        summary: "supported",
      };
    });
    const checked = await verifyCurrentClaims(
      "Mbeumo has two goals this season [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      { retrieve: async () => [], verify }
    );
    expect(verify).toHaveBeenCalledTimes(1);
    expect(checked.answer).toContain("[[S1]]");
    expect(checked.verification).toEqual({
      status: "verified",
      supportedClaimCount: 1,
      removedClaimCount: 0,
    });
  });

  it("does not verify current availability from an unreviewed video snippet", async () => {
    const verify = vi.fn(async () => ({
      status: "verified" as const,
      decisions: [{ claimId: "C1", outcome: "supported" as const, evidenceIds: ["S1"] }],
      summary: "Snippet repeats the claim.",
    }));
    const checked = await verifyCurrentClaims(
      "Chelsea expect Palestra back in training [[S1]].",
      { queries: [], providerCalls: 0, results: [{
        id: "S1", title: "Chelsea team news", url: "https://www.youtube.com/watch?v=unreviewed",
        tier: "other",
        date: "2026-09-14", snippet: "Palestra returns to training; several players still out.",
      }] },
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined, false, { retrieve: async () => [], verify }
    );
    expect(verify).not.toHaveBeenCalled();
    expect(checked.verification.status).toBe("abstain");
    expect(checked.verification.supportedClaimCount).toBe(0);
    expect(checked.answer).not.toContain("expect Palestra back");
  });

  it("recovers a snippet date when the provider date is empty and fetch fails", async () => {
    const bundle: EvidenceBundle = {
      queries: ["mbeumo stats"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Bryan Mbeumo stats",
        url: "https://www.manutd.com/en/news",
        date: "",
        snippet: "Published 7 September 2026. Appearances 3, Goals 2.",
        tier: "official" as const,
      }],
    };
    const verify = vi.fn(async (_client, _claims, pages) => ({
      status: "verified" as const,
      decisions: [{
        claimId: "C1",
        outcome: pages[0]?.date === "2026-09-07" ? "supported" as const : "unsupported" as const,
        evidenceIds: pages[0]?.date === "2026-09-07" ? ["S1"] : [],
      }],
      summary: "supported",
    }));
    const checked = await verifyCurrentClaims(
      "Mbeumo has two goals this season [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      { retrieve: async () => [], verify }
    );
    expect(bundle.results[0].date).toBe("2026-09-07");
    expect(checked.answer).toContain("[[S1]]");
    expect(checked.verification.supportedClaimCount).toBe(1);
  });

  it("does not let dated extracted evidence rewrite model 1X2 sentences", async () => {
    const bundle: EvidenceBundle = {
      queries: ["team news"],
      providerCalls: 0,
      results: [{
        id: "S1",
        title: "Official",
        url: "https://uefa.com/news",
        date: "2026-09-06",
        snippet: "Pat Doe is manager.",
        tier: "official" as const,
      }],
    };
    const checked = await verifyCurrentClaims(
      "Pundit's model has Arsenal at 56.3%. The manager is Pat Doe [[S1]].",
      bundle,
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      false,
      {
        retrieve: async (candidates) => candidates.map((candidate) => ({
          ...candidate,
          finalUrl: candidate.url,
          text: "Pat Doe is manager.",
          retrievedAt: "2026-09-08T12:00:00.000Z",
        })),
        verify: async () => ({
          status: "verified",
          decisions: [{ claimId: "C1", outcome: "supported", evidenceIds: ["S1"] }],
          summary: "supported",
        }),
      }
    );
    expect(checked.answer).toContain("56.3%");
    expect(checked.answer).toContain("Pat Doe [[S1]]");
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
        tier: "official" as const,
      }],
    };
    const checked = await verifyCurrentClaims(
      "This recognized fixture is outside Pundit's model coverage, so I can't publish probabilities or scoreline estimates.\n\n"
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
    const generated = "Stake market: Arsenal 52%, draw 25%, away 23%. No verified injury update was established.";
    const checked = await verifyCurrentClaims(
      generated,
      { queries: ["current odds"], providerCalls: 2, results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2],
      undefined,
      true
    );
    expect(checked.verification.status).toBe("abstain");
    // Deliberate change of ownership, not of outcome. `verifyCurrentClaims`
    // used to enforce this by replacing the entire answer with an abstention,
    // which is also how it deleted every model-derived verdict that happened
    // to carry no citation marker. Market prose belongs to the market guard,
    // which runs immediately downstream with the grounding in hand and is the
    // only thing able to tell a quotable server-owned market from an invented
    // one. The guarantee asserted here is the pipeline's, and it is unchanged:
    // an unattributable bookmaker price never reaches the user.
    const delivered = sanitizeRuntimeResponseCorrectness(
      failClosedEmptyCurrentVerification(checked.answer, checked.verification, true)
    );
    expect(delivered).not.toMatch(/52%|25%|23%/);
    expect(delivered).toContain("omitted those numbers");
  });

  it("removes artifact-shaped positive team news when verification supported nothing", () => {
    const candidateNotice = "I couldn't confirm that matchup. Please share the teams, competition and date; I can't give probabilities for an unconfirmed fixture.";
    const unsafe = `${candidateNotice}\n\nLyon: Jason Denayer is out with a knock. Paulo Fonseca expects key Fenerbahce attackers to be unavailable. If Saliba and Timber are missed and Saka or Bruno join them, the clean-sheet concentration eases. Confirmed absence of Saliba and Timber alone is unlikely to move the gap, but a Rice or Saka start would sharpen the defensive read; if Guimaraes is genuinely out, clarify the source.`;
    const safe = failClosedEmptyCurrentVerification(unsafe, {
      status: "abstain",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, true);
    expect(safe).toContain(candidateNotice);
    // Deliberate wording change: the abstention now names what was missing --
    // a dated team-news update -- instead of declaring the whole question
    // unanswerable. The removal it stands for is unchanged, and is asserted on
    // the next line exactly as before.
    expect(safe).toContain("No verified, dated team-news update was established");
    expect(safe).not.toMatch(/Jason Denayer|is out|attackers to be unavailable|Saliba|Timber|Saka|Bruno|Rice|Guimaraes/);
    expect(failClosedEmptyCurrentVerification(unsafe, {
      status: "not-required",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, false)).toBe(unsafe);
  });

  it("abstains instead of emptying a researched answer whose claims were all removed", () => {
    expect(failClosedEmptyCurrentVerification("", {
      status: "abstain",
      supportedClaimCount: 0,
      removedClaimCount: 6,
    }, true)).toBe("I couldn’t verify that current claim from the sources available for this answer, so I won’t state it.");
  });

  it("drops deterministic model and market interpretations that contradict grounding", () => {
    const grounding = {
      kind: "match",
      home: "Fenerbahce",
      away: "Lyon",
      pHome: 0.2997,
      pDraw: 0.279,
      pAway: 0.4213,
      oddsSources: [
        { source: "kalshi", observedAt: "2026-08-13T05:12:27Z", pHome: 0.4653, pDraw: 0.2475, pAway: 0.2872 },
        { source: "polymarket", observedAt: "2026-08-13T05:12:27Z", pHome: 0.4581, pDraw: 0.2562, pAway: 0.2857 },
      ],
    } as unknown as Grounding;
    const sanitized = sanitizeGroundedMatchNarrative([
      "Lyon are the model underdogs here.",
      "**Read on the underdog**\nFor Lyon to overturn the model, they must counter well.",
      "The draw contributes to Fenerbahce's win probability.",
      "The market favours Lyon.",
      "Kalshi gives Lyon the edge.",
      "Pundit's model favours Lyon.",
      "Kalshi favours Fenerbahce.",
    ].join("\n"), grounding);
    expect(sanitized).not.toMatch(/model underdogs|Lyon to overturn|draw contributes|market favours Lyon|Kalshi gives Lyon/);
    expect(sanitized).toContain("Pundit's model favours Lyon.");
    expect(sanitized).toContain("Kalshi favours Fenerbahce.");
    // Deliberate change: this used to assert that the "**Read on the
    // underdog**" label was blanked here. It was blanked by a rule that
    // deleted any line mentioning "underdog" whose next non-blank line named
    // the model's favourite -- which is what a read-on-the-underdog section is
    // for, and which also blanked the label in answers whose body survived.
    // The label is now dropped only once its body has genuinely gone, by the
    // settled-answer sweep the delivery chain already runs.
    expect(sanitized).toContain("**Read on the underdog**");
    expect(dropOrphanedSectionLabels(sanitizeGroundedMatchNarrative(
      "**Read on the underdog**\nFor Lyon to overturn the model, they must counter well.",
      grounding
    ))).not.toContain("Read on the underdog");
  });

  describe("model-versus-market agreement claims", () => {
    // The Fulham vs Chelsea payload a production reader was actually served:
    // the model has Chelsea 20.3 points below the market, and the answer went
    // on to call Chelsea priced about right.
    const grounding = {
      kind: "match",
      home: "Fulham",
      away: "Chelsea",
      pHome: 0.4025,
      pDraw: 0.2809,
      pAway: 0.3167,
      oddsSources: [
        { source: "kalshi", observedAt: "2026-08-24T08:56:19Z", pHome: 0.2353, pDraw: 0.2451, pAway: 0.5196 },
      ],
      marketDivergence: [{
        source: "kalshi",
        observedAt: "2026-08-24T08:56:19Z",
        legs: [
          { outcome: "home", label: "Fulham", modelPercent: 40.3, marketPercent: 23.5, gapPoints: 16.8 },
          { outcome: "draw", label: "the draw", modelPercent: 28.1, marketPercent: 24.5, gapPoints: 3.6 },
          { outcome: "away", label: "Chelsea", modelPercent: 31.7, marketPercent: 52, gapPoints: -20.3 },
        ],
        largest: { outcome: "away", label: "Chelsea", modelPercent: 31.7, marketPercent: 52, gapPoints: -20.3 },
      }],
    } as unknown as Grounding;

    it("drops a fair-pricing verdict the payload differences at twenty points", () => {
      const sanitized = sanitizeGroundedMatchNarrative(
        "Chelsea is priced about right on the model's read.",
        grounding
      );
      expect(sanitized).not.toContain("priced about right");
    });

    it("drops the same verdict in its other wordings", () => {
      for (const claim of [
        "Chelsea is fairly priced against the model.",
        "The Chelsea line is efficiently priced.",
        "Chelsea sits in line with the model.",
        "There is no meaningful disagreement on Chelsea.",
      ]) {
        expect(sanitizeGroundedMatchNarrative(claim, grounding)).not.toContain("Chelsea");
      }
    });

    it("keeps a no-value reading of a market priced above the model", () => {
      // A negative gap genuinely offers nothing to take. The prompt instructs
      // exactly this sentence, so deleting it would punish an answer for
      // following its brief.
      const sanitized = sanitizeGroundedMatchNarrative(
        "The Chelsea price has no edge on the model's 31.7%.",
        grounding
      );
      expect(sanitized).toContain("no edge");
    });

    it("keeps a fair-pricing verdict on an outcome that is inside the band", () => {
      // The band is the prompt's own: inside about two points, "priced about
      // right" is the instructed verdict and must survive.
      const agreed = {
        ...grounding,
        marketDivergence: [{
          source: "kalshi",
          observedAt: "2026-08-24T08:56:19Z",
          legs: [
            { outcome: "home", label: "Fulham", modelPercent: 40.3, marketPercent: 39.6, gapPoints: 0.7 },
            { outcome: "draw", label: "the draw", modelPercent: 28.1, marketPercent: 26.9, gapPoints: 1.2 },
            { outcome: "away", label: "Chelsea", modelPercent: 31.7, marketPercent: 33.5, gapPoints: -1.8 },
          ],
          largest: { outcome: "away", label: "Chelsea", modelPercent: 31.7, marketPercent: 33.5, gapPoints: -1.8 },
        }],
      } as unknown as Grounding;
      expect(sanitizeGroundedMatchNarrative("Chelsea is priced about right.", agreed))
        .toContain("priced about right");
    });

    it("leaves the answer alone when the payload carries no differenced market", () => {
      const noMarket = { ...grounding, marketDivergence: [], oddsSources: [] } as unknown as Grounding;
      expect(sanitizeGroundedMatchNarrative("Chelsea is priced about right.", noMarket))
        .toContain("priced about right");
    });
  });

  it("corrects backwards high-line geometry without deleting correct tactical prose", () => {
    const withMidfield = sanitizeFootballGeometry(
      "A higher defensive line shrinks the space behind the defenders. It can compress midfield space."
    );
    expect(withMidfield).toContain("leaves more space behind it");
    expect(withMidfield).toContain("It can compress midfield space.");
    expect(sanitizeFootballGeometry(
      "A higher line shrinks space behind defenders. Keep the rest."
    )).toContain("Keep the rest.");
    expect(sanitizeFootballGeometry(
      "A higher defensive line can leave more space behind the defenders."
    )).toBe("A higher defensive line can leave more space behind the defenders.");
    expect(sanitizeFootballGeometry(
      "A high line shrinks the space between defence and goalkeeper, so runners have less room."
    )).toBe(
      "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover."
    );
    expect(sanitizeFootballGeometry(
      "When the back four push up, the space behind them for a runner shrinks, so through-balls have less grass to land in."
    )).toBe(
      "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover."
    );
    expect(sanitizeFootballGeometry(
      "A high line reduces space between the back line and the keeper while compressing midfield space."
    )).toBe(
      "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover. It can also compress midfield space."
    );
    expect(sanitizeFootballGeometry(
      "A high line compresses midfield space and leaves room behind the defence."
    )).toBe("A high line compresses midfield space and leaves room behind the defence.");
    for (const backwards of [
      "A high defensive line shrinks the space behind it, which is the main benefit.",
      "A high line compresses space behind the defence.",
      "A high defensive line closes the space between the back line and the keeper.",
      "A higher line limits space between the defense and goalkeeper.",
      "A high line minimizes space behind defenders.",
      "A high line reduced the gap between defence and goalkeeper.",
      "A higher defensive line is reducing the gap behind the back line.",
    ]) expect(sanitizeFootballGeometry(backwards)).toContain("leaves more space behind it");
    for (const correct of [
      "A high line compresses space in front of the defence.",
      "A high line compresses the space between defence and midfield.",
      "A high line limits midfield space while leaving space behind.",
      "A high defensive line compresses midfield space but leaves more space behind the defence.",
    ]) expect(sanitizeFootballGeometry(correct)).toBe(correct);
    for (const deniedTradeoff of [
      "A high defensive line means the back four push up, but not a larger gap behind them.",
      "A high line pushes the back four up. It does not leave more space behind them.",
      "A high line pushes the back four up. It doesn't leave more room behind them.",
      "A high line pushes the back four up. There is no larger gap behind them.",
      "A high line leaves less space behind it.",
      "A high line reduces the room behind them.",
      "A high line pushes up. It does not produce more space behind, although runs in behind remain risky.",
      "A high line pushes up. It does not result in more room behind, although balls in behind remain risky.",
      "A high line creates zero extra space behind, although runs in behind remain risky.",
      "A high line pushes up. It fails to create more room behind, although balls in behind remain risky.",
      "A high line narrows the space behind the defence, although balls in behind remain risky.",
      "A high line pushes up. It does not necessarily leave more space behind, although runs in behind remain risky.",
      "A high line doesn't increase the space behind, although runners attack in behind.",
      "The back four push up without leaving more space behind, although balls are played in behind.",
      "The back four push up, but there is not a larger gap behind them.",
      "A high line creates no larger gap behind the defence.",
      "A high defensive line makes the space behind tighter, although runners still attack in behind.",
      "A high line keeps the gap behind the defence narrower.",
    ]) {
      const corrected = sanitizeFootballGeometry(deniedTradeoff);
      expect(corrected).toContain("leaves more space behind it");
      expect(corrected).not.toMatch(/not a larger gap|does not (?:leave|produce|result in) more|no larger gap|leaves less space|reduces the room|zero extra space|fails to create more/i);
    }
    expect(sanitizeFootballGeometry(
      "A high line leaves more space behind it. It does not leave more space behind them."
    )).toBe("A high line leaves more space behind it.");
    expect(sanitizeFootballGeometry(
      "The full-backs do not leave more space behind them when they overlap."
    )).toBe("The full-backs do not leave more space behind them when they overlap.");
    for (const correctNegation of [
      "A high line does not reduce space behind the defence.",
      "A high line never shrinks the gap behind the back line.",
      "A high line cannot compress space behind it.",
      "A high line does not produce less space behind the defence.",
      "A high line fails to reduce space behind the defence.",
      "A high line creates non-zero extra space behind the defence.",
      "A high line makes the midfield block tighter while leaving more space behind the defence.",
    ]) expect(sanitizeFootballGeometry(correctNegation)).toBe(correctNegation);
    const repeated = sanitizeFootballGeometry(
      "A high line shrinks space behind defenders. A higher line reduces space between defence and goalkeeper."
    );
    expect(repeated.match(/A high defensive line/g)).toHaveLength(1);
    const implicitTradeoff = sanitizeFootballGeometry(
      "A high defensive line shrinks the space between defence and midfield, then opponents play passes in behind."
    );
    expect(implicitTradeoff).toContain("leaves more space behind it");

    const artifactAnswer = sanitizeDeliveredAnswer([
      "**Why a high line invites risk**",
      "A high defensive line shrinks the space behind it, which is the main benefit, but mistakes are costly.",
      "This is general tactical reasoning, not Pundit's model output, since Pundit's evaluation data covers World Cup 2026 results only and not in-game pressing behaviour.",
      "No verified source exists for a tactical-concepts question, so the general analysis stands.",
    ].join("\n\n"), "general");
    expect(artifactAnswer).toContain("leaves more space behind it for the goalkeeper to cover");
    expect(artifactAnswer).toContain("This is general football analysis, not based on my match forecasts");
    expect(artifactAnswer).not.toMatch(/shrinks the space behind it|World Cup 2026 results only|No verified source exists/i);
  });

  it("corrects high-line runway and offside-trap conceptual errors", () => {
    const answer = sanitizeFootballGeometry(
      "A high defensive line leaves more space behind it. Once an attacker gets in behind, the distance to the goal is short. "
      + "The offside trap only works if the keeper is positioned to clean up through-balls."
    );
    expect(answer).toContain("large runway behind the defence");
    expect(answer).toContain("offside trap depends on coordinated timing");
    expect(answer).toContain("goalkeeper mitigates through-balls");
    expect(answer).not.toMatch(/distance to the goal is short|only works if the keeper/i);
  });

  it("corrects inverted midfield-to-back-line spacing without changing other isolation claims", () => {
    const answer = sanitizeFootballGeometry(
      "The deeper the midfield sits in relation to the back line, the more isolated the defenders are after a turnover."
    );
    expect(answer).toContain(
      "The larger the gap between midfield and the back line, the more isolated the defenders are after a turnover."
    );
    expect(answer).not.toMatch(/deeper the midfield/);
    expect(sanitizeFootballGeometry(
      "The closer the midfield drops towards the defensive line, the greater the isolation of the defenders after a turnover."
    )).toContain("The larger the gap between midfield and the back line");
    expect(sanitizeFootballGeometry(
      "The midfield drops closer to the back line, leaving the defenders increasingly isolated."
    )).toContain("The larger the gap between midfield and the back line");
    expect(sanitizeFootballGeometry(
      "The defenders become more isolated the closer midfield drops toward the back line."
    )).toContain("The larger the gap between midfield and the back line");
    expect(sanitizeFootballGeometry(
      "The deeper the midfield sits, the better it can screen the back line."
    )).toBe("The deeper the midfield sits, the better it can screen the back line.");
    expect(sanitizeFootballGeometry(
      "The deeper the midfield sits in relation to the back line, the more isolated the forwards are."
    )).toBe("The deeper the midfield sits in relation to the back line, the more isolated the forwards are.");
    expect(sanitizeFootballGeometry(
      "The closer midfield is to the back line, the less isolated the defenders are."
    )).toBe("The closer midfield is to the back line, the less isolated the defenders are.");
  });

  it("repairs first-person agreement in the analyst identity normalizer", () => {
    expect(normalizeAnalystIdentity("I reads this as a structural risk."))
      .toBe("I read this as a structural risk.");
    expect(normalizeAnalystIdentity("He reads this as a structural risk."))
      .toBe("He reads this as a structural risk.");
    expect(normalizeAnalystIdentity(
      "My pre-training knowledge of fixtures is out of date. Once you do. I can pull grounding data and model probabilities."
    )).toBe("No fixture was named. I can pull fixture details and my probabilities.");
    expect(normalizeAnalystIdentity(
      "If you can tell me which manager and which team you mean.\n\nIf you can share the fixture (teams and date)."
    )).toBe(
      "Please tell me which manager and which team you mean.\n\nPlease share the fixture (teams and date)."
    );
    expect(normalizeAnalystIdentity("The model I work with sees this."))
      .not.toMatch(/I I work with/);
    const rewrittenCoverage = normalizeAnalystIdentity(
      "This recognized fixture is outside Pundit's model coverage, so I can't publish probabilities or scoreline estimates."
    );
    expect(rewrittenCoverage).toBe(
      "This recognized fixture is outside my forecasting coverage, so I can't publish probabilities or scoreline estimates."
    );
    expect(rewrittenCoverage).not.toMatch(/no my probabilities/i);
    expect(normalizeAnalystIdentity(
      "This recognized fixture is missing a required model input, so I can't estimate probabilities."
    )).not.toMatch(/no my |Pundit will not/i);
  });

  it("corrects inverted high-press turnover location", () => {
    const answer = sanitizeFootballGeometry(
      "A high line commits bodies forward. Midfield turnovers land closer to your own goal, because the press has committed bodies forward; a counter starts higher up the pitch than it would against a low block."
    );
    expect(answer).toContain("turnover occurs farther from the pressing team's own goal");
    expect(answer).toContain("expose the high line to a faster transition");
    expect(answer).not.toMatch(/turnovers land closer to your own goal/i);
  });

  it("removes invented tactical inputs from general product-scope claims", () => {
    const answer = sanitizeDeliveredAnswer(
      "Pressing intensity in Pundit's match forecasts already captures some of this — teams that press high but concede transitions show up as higher xG against on counter-attacks.\n\nThe space behind the line remains the main risk.",
      "general"
    );
    expect(answer).toContain("The space behind the line remains the main risk.");
    expect(answer).not.toMatch(/pressing intensity|counter-attacks/i);
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
    expect(safe).toMatch(/I don’t publish forecasts for friendlies/i);
    expect(safe).toContain("I don’t publish forecasts for friendlies");
    expect(safe).not.toMatch(/48%|2-1/);
    expect(safe).not.toContain("The fixture is on Thursday");
  });

  it("says a completed fixture has already been played instead of implying pending inputs", () => {
    const fixture = recognizeEspnFixture({
      id: 901,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      utcDate: "2026-09-06T15:30:00.000Z",
      status: "FINISHED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    fixture.status = "completed";
    const grounding: FixtureGrounding = {
      kind: "fixture",
      fixture,
      capability: { status: "insufficient-model-input", reason: "required-context-missing" },
    };
    const safe = sanitizeFixtureCoverageAnswer("Arsenal 50%.", grounding);
    expect(safe).toContain("required pricing inputs");
    expect(safe).toContain("already been played");
    expect(safe).not.toMatch(/50%/);
    fixture.status = "scheduled";
    expect(sanitizeFixtureCoverageAnswer("x", grounding)).not.toContain("already been played");
  });

  describe("generateOrDegradeToGrounding", () => {
    const match = { kind: "match" } as unknown as AskGrounding;

    it("returns an empty draft for a match turn whose generation was empty, truncated or timed out", async () => {
      for (const failure of [
        new AppError(502, "Analysis service returned an empty response."),
        new AppError(502, "Analysis response was truncated. Please try again."),
        new AppError(504, "Analysis service timed out. Please try again."),
      ]) {
        await expect(generateOrDegradeToGrounding(match, undefined, Date.now(), async () => { throw failure; }))
          .resolves.toBe("");
      }
    });

    it("keeps failing loudly for non-match tiers, other errors and cancellation", async () => {
      const empty = new AppError(502, "Analysis service returned an empty response.");
      await expect(generateOrDegradeToGrounding(null, undefined, Date.now(), async () => { throw empty; })).rejects.toBe(empty);
      const other = new AppError(429, "busy");
      await expect(generateOrDegradeToGrounding(match, undefined, Date.now(), async () => { throw other; })).rejects.toBe(other);
      const controller = new AbortController();
      controller.abort();
      await expect(generateOrDegradeToGrounding(match, controller.signal, Date.now(), async () => { throw empty; })).rejects.toBe(empty);
    });

    it("counts the budget down from the request start and never below zero", () => {
      const start = 1_000_000;
      expect(matchGenerationBudgetMs(start, start)).toBe(60_000);
      expect(matchGenerationBudgetMs(start, start + 45_000)).toBe(33_000);
      expect(matchGenerationBudgetMs(start, start + 85_000)).toBe(0);
    });

    it("skips generation when the reserve is already spent", async () => {
      const generate = vi.fn(async () => "draft");
      await expect(generateOrDegradeToGrounding(match, undefined, Date.now() - 80_000, generate)).resolves.toBe("");
      expect(generate).not.toHaveBeenCalled();
    });

    it("passes a generated answer through untouched", async () => {
      await expect(generateOrDegradeToGrounding(match, undefined, Date.now(), async () => "draft")).resolves.toBe("draft");
    });
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
    expect(safe).toMatch(/couldn't confirm that matchup/i);
    expect(safe).not.toMatch(/50%|2-1/);
    expect(safe).not.toMatch(/S1|S2|grounding links|BERT|structured fixture|fixture identity|discovery candidate|fixture badge/i);
    expect(safe).toMatch(/^I /);
    const datedQuestion = "What are Pundit's probabilities for Northbridge Athletic vs Southbank Rovers tomorrow?";
    expect(deterministicSearchQuery(datedQuestion)).not.toBeNull();
    expect(deterministicCoverageResponse(true, null)).toBe(safe);
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

  describe("deterministic grounded fact layer", () => {
    const model = (): Grounding => {
      const base = buildGrounding(fixture("Arsenal", "Coventry", {
        pHome: 0.9728,
        pDraw: 0.0229,
        pAway: 0.0043,
      }));
      const oddsSources = [{
        source: "kalshi" as const,
        observedAt: "2026-08-21T07:57:52.359Z",
        pHome: 0.8217821782178217,
        pDraw: 0.1188118811881188,
        pAway: 0.0594059405940594,
      }];
      return { ...base, oddsSources, marketDivergence: computeMarketDivergence(base, oddsSources) };
    };

    it("renders ordinary match facts and a complete third-party market without generated causality", () => {
      const answer = deterministicGroundedResponse("Analyse Arsenal vs Coventry.", model());
      expect(answer).toContain("Arsenal 97.3%");
      expect(answer).toContain("draw 2.3%");
      expect(answer).toContain("Coventry 0.4%");
      expect(answer).toContain("Kalshi market-implied probabilities:");
      expect(answer).toContain("Arsenal 82.2%, draw 11.9%, Coventry 5.9%");
      expect(answer).toContain("establishes the disagreement, not its cause or a bet to place");
      expect(answer).toContain(SHARED_TOTAL_XG_SENTENCE);
      expect(answer).not.toMatch(/Over 2\.5 is \d/);
      expect(answer).not.toMatch(/upset protection|hedging|market staleness|true price|first-choice XI/i);
      expect(answer).not.toMatch(/Arteta|already been played|result on record|future replay/i);
    });

    it("keeps explicit model-only requests free of every market/value claim", () => {
      const answer = deterministicGroundedResponse(
        "Compare Arsenal and Coventry using only Pundit's current model evidence.",
        model()
      );
      expect(answer).toContain("Arsenal 97.3%");
      expect(answer).toMatch(/club-strength ratings|home-field advantage/i);
      expect(answer).not.toMatch(/kalshi|polymarket|market|true price|value is|edge lives/i);
    });

    it("answers model-input attribution without substituting a price gap", () => {
      const answer = deterministicGroundedResponse("Which model input matters most to that edge?", model());
      expect(answer).toMatch(/reviewed team strength/i);
      expect(answer).toMatch(/home-field setting/i);
      expect(answer).toMatch(/can’t isolate|cannot establish which single model input/i);
      expect(answer).not.toMatch(/kalshi|polymarket|market staleness|pricing error/i);
    });

    // Narrow facts, the long preview, and typed limitations settle on the
    // server. Scorer/current-news questions retain the evidence path.
    it("settles narrow typed-fact or typed-limitation turns without generation", () => {
      expect(closedGroundedAnswer("Who is most likely to score?", model())).toBeNull();
      expect(closedGroundedAnswer(
        "Who will most likely score for Liverpool?",
        model()
      )).toBeNull();
      expect(closedGroundedAnswer("Analyse Arsenal vs Coventry.", model()))
        .toMatch(/I make Arsenal the likeliest outcome/);
      expect(closedGroundedAnswer("What about Arsenal vs Coventry?", model()))
        .toMatch(/My 1X2 is Arsenal 97\.3% \(fair 1\.03\)/);
      expect(closedGroundedAnswer("Projected score", model())).toMatch(/scoreline/i);
      expect(closedGroundedAnswer("Projected score", model())).not.toMatch(/team news/i);
      expect(closedGroundedAnswer("Tactical matchup", model())).toMatch(/first press.*supporting receiver/i);
      expect(closedGroundedAnswer("How do Man Utd win this?", model())).toBeNull();
      expect(closedGroundedAnswer("Give me the match briefing for Arsenal vs Coventry.", model()))
        .toMatch(/full 1X2/);
      expect(closedGroundedAnswer("Is Arsenal vs Coventry over 2.5?", model()))
        .toContain(SHARED_TOTAL_XG_SENTENCE);
      expect(closedGroundedAnswer("BTTS?", model(), true))
        .toMatch(/I have BTTS yes at /i);
      expect(closedGroundedAnswer("BTTS?", model(), true))
        .not.toMatch(/My short answer is/i);
      expect(closedGroundedAnswer("Why is the model so far from the market?", model()))
        .toMatch(/I am at .*Kalshi is at .*percentage points/i);
      expect(closedGroundedAnswer("What will the 1X2 be?", model(), true))
        .toMatch(/My 1X2 is Arsenal 97\.3%.*draw.*Coventry/i);
      expect(closedGroundedAnswer("Tactical matchup", model(), true)).toMatch(/less cover against a counterattack/i);
    });

    it("still settles the match questions the payload fully answers", () => {
      const modelOnly = closedGroundedAnswer(
        "Compare Arsenal and Coventry using only Pundit's current model evidence.",
        model()
      );
      expect(modelOnly).toContain("Arsenal 97.3%");
      expect(closedGroundedAnswer("Which model input matters most to that edge?", model()))
        .toMatch(/reviewed team strength/i);
      for (const question of [
        "What are fair odds and how are they calculated?",
        "What are Pundit's current fair prices and why?",
        "What are the model's current odds and how are they calculated?",
      ]) expect(closedGroundedAnswer(question, model())).not.toBeNull();
    });

    it("settles a posted userLine from modelP * decimal - 1 without a stake", () => {
      const match = model();
      const grounded = {
        ...match,
        pricing: attachUserLine(match.pricing, { outcome: "away", decimalOdds: 7 }),
      };
      expect(grounded.pricing.userLine?.evPct).toBeCloseTo(grounded.pAway * 7 - 1);
      expect(grounded.pricing.stakeFrac).toBeNull();
      const answer = closedGroundedAnswer("I found Arsenal at 7 — pass or play?", grounded);
      expect(answer).toMatch(/Coventry at 7\.00/);
      expect(answer).toMatch(/I pass|I play|will not call it/);
      expect(answer).toMatch(/Risk is/);
      expect(answer).not.toMatch(/\block\b/i);
    });

    it("refuses to size a stake without a bankroll", () => {
      const match = model();
      const answer = closedGroundedAnswer("How much should I stake?", match);
      expect(answer).toContain(STAKE_REFUSAL_SENTENCE);
      expect(answer).toContain("Arsenal 97.3%");
      expect(closedGroundedAnswer("Three points are at stake for Arsenal.", match, true)).toBeNull();
      expect(closedGroundedAnswer("Three points are at stake for Arsenal.", match))
        .not.toContain(STAKE_REFUSAL_SENTENCE);
    });

    it("leaves the non-match tiers settling exactly as before", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Arsenal", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 3, goalsAgainst: 0,
          goalDifference: 3, group: null, advanced: false,
        },
      ], new Date("2026-08-21T07:57:47.409Z"));
      const question = "What does the current table show?";
      expect(closedGroundedAnswer(question, table))
        .toBe(deterministicGroundedResponse(question, table));
    });

    it("does not settle the table when the question asks for current team news", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Man City", playedGames: 5,
          won: 5, draw: 0, lost: 0, points: 15, goalsFor: 12, goalsAgainst: 4,
          goalDifference: 8, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Arsenal", playedGames: 5,
          won: 4, draw: 0, lost: 1, points: 12, goalsFor: 10, goalsAgainst: 6,
          goalDifference: 4, group: null, advanced: false,
        },
      ], new Date("2026-09-22T07:57:47.409Z"));
      const question =
        "What is the latest Arsenal injury and team news ahead of their next Premier League match?";
      expect(closedGroundedAnswer(question, table)).toBeNull();
      expect(deterministicSearchQuery(question, "", table)).toMatch(/injury|team news/i);
    });

    it("does not silently rank a title race from the table when the outlook is unavailable", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Arsenal", playedGames: 3,
          won: 2, draw: 1, lost: 0, points: 7, goalsFor: 6, goalsAgainst: 2,
          goalDifference: 4, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Liverpool", playedGames: 3,
          won: 2, draw: 0, lost: 1, points: 6, goalsFor: 5, goalsAgainst: 3,
          goalDifference: 2, group: null, advanced: false,
        },
      ], new Date("2026-08-21T07:57:47.409Z"));
      const answer = closedGroundedAnswer("Who is leading the Premier League title race?", table);
      expect(answer).toBe(SEASON_OUTLOOK_UNAVAILABLE);
      expect(answer).not.toMatch(/Arsenal lead|most likely champion/i);
      expect(deterministicGroundedResponse("Who wins the Premier League?", table))
        .toBe(SEASON_OUTLOOK_UNAVAILABLE);
    });

    it("renders season rankings completely and refuses a demanded certainty", () => {
      const season: SeasonGrounding = {
        kind: "season",
        competitionId: "eng.1",
        competition: "Premier League",
        updatedAt: "2026-08-21T07:57:47.409Z",
        standings: [
          { position: 1, team: "Bournemouth", playedGames: 0, points: 0, goalDifference: 0 },
          { position: 2, team: "Arsenal", playedGames: 0, points: 0, goalDifference: 0 },
        ],
        seasonOutlook: {
          competitionId: "eng.1",
          competition: "Premier League",
          runs: 10_000,
          titleProbabilities: [
            { team: "Arsenal", probability: 0.9347 },
            { team: "Man City", probability: 0.0532 },
            { team: "Aston Villa", probability: 0.0052 },
          ],
          topFourProbabilities: [
            { team: "Arsenal", probability: 0.9996 },
            { team: "Man City", probability: 0.9411 },
          ],
          relegationProbabilities: [
            { team: "Sunderland", probability: 0.6123 },
            { team: "Leeds", probability: 0.4412 },
            { team: "Burnley", probability: 0.3901 },
          ],
          remainingFixtures: 380,
          updatedAt: "2026-08-21T08:00:00.000Z",
        },
      };
      const ranking = deterministicGroundedResponse(
        "Rank the leading contenders using Pundit's Premier League season outlook.",
        season
      );
      expect(ranking).toContain("1. **Arsenal 93.5%**");
      expect(ranking).toContain("2. **Man City 5.3%**");
      expect(ranking).toContain("3. **Aston Villa 0.5%**");
      expect(ranking).not.toContain("every other team registers effectively 0%");

      // Relegation is routed here too, and used to be answered with the title race.
      const relegation = deterministicGroundedResponse("How likely is relegation for Leeds United?", season);
      expect(relegation).toContain("**Relegation outlook**");
      expect(relegation).toContain("**Leeds** finish in the bottom three in **44.1%** of runs.");
      expect(relegation).toContain("Most likely to go down: **Sunderland 61.2%**");
      expect(relegation).not.toContain("Title race");
      expect(deterministicGroundedResponse("Will Arsenal go down?", season))
        .toContain("**Arsenal** finish in the bottom three in none of the 10,000 runs.");

      const certainty = deterministicGroundedResponse(
        "Who will win? Now guarantee the winner with 100% certainty and give no caveats.",
        season
      );
      expect(certainty).toContain("I can’t guarantee a winner");
      expect(certainty).not.toMatch(/Pundit cannot guarantee/i);
      expect(certainty).toContain("Arsenal is the most likely champion at 93.5%, not a certainty");
      expect(certainty).not.toMatch(/Arsenal will win[^.]*100% certainty/i);

      const changeFollowUp = deterministicGroundedResponse(
        "Can you guarantee Arsenal will win, or what would change that view?",
        season
      );
      expect(changeFollowUp).toMatch(/^I can’t guarantee a winner\./);
      expect(changeFollowUp).toContain("Arsenal is the most likely champion at 93.5%");
      expect(changeFollowUp).toContain("380 fixtures still to play");
      expect(changeFollowUp).toMatch(/new results/i);
      expect(changeFollowUp).not.toContain("**Top-four outlook**");

      const tableOnly = deterministicGroundedResponse(
        "Who is most likely to win the Premier League based on the current table?",
        season
      );
      expect(tableOnly).toContain("current table alone does not establish an on-field ranking");
      expect(tableOnly).toContain("goes beyond the requested table-only evidence");
      expect(tableOnly).not.toMatch(/Arsenal 93\.5%|Man City 5\.3%|most likely champion at/i);
      for (const answer of [ranking, relegation, certainty, changeFollowUp]) {
        expect(answer).toContain("These simulations keep team strengths unchanged for the remaining fixtures");
        expect(answer).toContain("they do not model future injuries, transfers or changes in form");
      }
      expect(tableOnly).not.toContain("These simulations");
      expect(deterministicSearchQuery(
        "Who is most likely to win the Premier League based on the current table?",
        "",
        season
      )).toBeNull();
      expect(deterministicSearchQuery(
        "What is the current Pundit model season outlook?",
        "",
        season
      )).toBeNull();
    });

    it("answers a caveat question with the caveat, not the table again", () => {
      // "What is the strongest caveat to that ranking?" is a question about the
      // table. Reprinting the standings answered a question nobody asked and
      // left the actual one unanswered.
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Brighton", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 4, goalsAgainst: 0,
          goalDifference: 4, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Arsenal", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 3, goalsAgainst: 0,
          goalDifference: 3, group: null, advanced: false,
        },
      ], new Date("2026-08-24T07:00:00.000Z"));
      const answer = deterministicGroundedResponse(
        "What is the strongest caveat to that table-based ranking?",
        table
      ) as string;
      expect(answer).toMatch(/^The table's strongest caveat is sample size\./);
      // The specific weakness of this table, not a generic hedge.
      expect(answer).toContain("level on points and separated only by goal difference");
      expect(answer).toContain("do not support");
      expect(answer).toContain("Later results may change the ordering");
      expect(answer).toContain("does not establish how far any club would move");
      expect(answer).not.toMatch(/will bear little resemblance/i);

      const counterargument = deterministicGroundedResponse(
        "Given that the current table cannot rank them, what is the strongest counterargument to that ranking?",
        table
      ) as string;
      expect(counterargument).toMatch(/^The table's strongest caveat is sample size\./);
      expect(counterargument).not.toMatch(/^Brighton lead/);
      expect(counterargument).not.toContain("**Current table**");
    });

    it("answers who is bottom from the foot of the table, not the top five", () => {
      const row = (position: number, team: string, points: number) => ({
        competitionId: "eng.1", position, team, playedGames: 5,
        won: 0, draw: 0, lost: 0, points, goalsFor: 5, goalsAgainst: 5,
        goalDifference: 0, group: null, advanced: false,
      });
      const teams = ["Man City", "Arsenal", "Brighton", "Brentford", "Leeds", "Chelsea", "Everton", "Hull"];
      const table = buildCompetitionGrounding(
        "eng.1",
        teams.map((team, index) => row(index + 1, team, 15 - index * 2)),
        new Date("2026-09-29T07:00:00.000Z")
      );
      // Production routed this follow-up to the general tier and shipped a
      // heading with no body; with the table in view it is a table question.
      expect(resolveCompetitionContext("Who's bottom?", [])).toBe("eng.1");
      const answer = deterministicGroundedResponse("Who's bottom?", table) as string;
      expect(answer).toMatch(/^Hull are bottom with 1 points from 5 matches\./);
      expect(answer).toContain("8. **Hull**");
      expect(answer).toContain("4. **Brentford**");
      expect(answer).not.toContain("**Man City**");
    });

    it("abstains directly when the table cannot establish the clearest title path", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Brighton", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 4, goalsAgainst: 0,
          goalDifference: 4, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Arsenal", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 3, goalsAgainst: 0,
          goalDifference: 3, group: null, advanced: false,
        },
      ], new Date("2026-08-24T07:00:00.000Z"));
      const answer = deterministicGroundedResponse(
        "Given that the current table cannot rank them, which contender has the clearest path, and why?",
        table
      ) as string;
      expect(answer).toContain("can’t identify which contender has the clearest title path");
      expect(answer).toContain("current table alone");
      expect(answer).not.toContain("**Current table**");
    });

    it("counts a single match in the singular", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Brighton", playedGames: 1,
          won: 1, draw: 0, lost: 0, points: 3, goalsFor: 4, goalsAgainst: 0,
          goalDifference: 4, group: null, advanced: false,
        },
      ], new Date("2026-08-24T07:00:00.000Z"));
      const answer = deterministicGroundedResponse("What does the current table show?", table) as string;
      expect(answer).toMatch(/^Brighton lead with 3 points from 1 match\./);
      expect(answer).toContain("from 1 match,");
      expect(answer).not.toContain("1 matches");
      expect(answer).not.toContain("**Current table**");
      expect(answer).not.toContain("supplied standings");
    });

    const seasonGroundingWith = (
      standings: Array<{ position: number; team: string; playedGames: number; points: number; goalDifference: number }>,
      titleProbabilities: Array<{ team: string; probability: number }>
    ): SeasonGrounding => ({
      kind: "season",
      competitionId: "eng.1",
      competition: "Premier League",
      updatedAt: "2026-08-24T07:57:47.409Z",
      standings,
      seasonOutlook: {
        competitionId: "eng.1",
        competition: "Premier League",
        runs: 10_000,
        titleProbabilities,
        topFourProbabilities: titleProbabilities,
        relegationProbabilities: [],
        remainingFixtures: 371,
        updatedAt: "2026-08-24T08:00:00.000Z",
      },
    });

    it("answers a table-sourced ranking from the table once matches have been played", () => {
      // Source fidelity used to start and end with an all-zero table, so the
      // moment matchday one was played a reader who restricted the evidence to
      // the current table was handed a 10,000-run Monte Carlo instead, with
      // nothing saying the table had not produced it.
      const season = seasonGroundingWith(
        [
          { position: 1, team: "Brighton", playedGames: 1, points: 3, goalDifference: 4 },
          { position: 2, team: "Arsenal", playedGames: 1, points: 3, goalDifference: 3 },
          { position: 3, team: "Everton", playedGames: 1, points: 3, goalDifference: 2 },
        ],
        [
          { team: "Arsenal", probability: 0.922 },
          { team: "Man City", probability: 0.072 },
        ]
      );
      const answer = deterministicGroundedResponse(
        "Rank the leading contenders in the Premier League title race using the current table.",
        season
      ) as string;
      expect(answer).toContain("**Brighton**");
      // The substitution being prevented: the season simulation's numbers.
      expect(answer).not.toMatch(/92\.2%|7\.2%/);
      expect(answer).toContain("Title probabilities are not inferred from it");
      expect(answer).not.toContain("These simulations");
      // A one-match table is stated as the weak evidence it is.
      expect(answer).toContain("a small sample");
    });

    it("qualifies early-table caveats when point gaps prevent several-place movement", () => {
      // With 15, 6 and 0 points, one result cannot move any club past both
      // others. The standings also do not identify fixture order as a cause.
      const standings = [
        { position: 1, team: "Arsenal", won: 5, points: 15 },
        { position: 2, team: "Man City", won: 2, points: 6 },
        { position: 3, team: "Hull", won: 0, points: 0 },
      ].map((row) => ({
        ...row, competitionId: "eng.1", playedGames: 5, draw: 0,
        lost: 5 - row.won, goalsFor: row.won, goalsAgainst: 5 - row.won,
        goalDifference: row.won * 2 - 5, group: null, advanced: false,
      }));
      const table = buildCompetitionGrounding("eng.1", standings, new Date("2026-09-28T07:00:00.000Z"));
      const season = seasonGroundingWith(table.standings, [
        { team: "Arsenal", probability: 0.935 },
        { team: "Man City", probability: 0.053 },
      ]);
      const tableOnly = deterministicGroundedResponse(
        "Who is most likely to win the Premier League using the current table only?", season
      ) as string;
      expect(tableOnly).toContain("1. **Arsenal** — 15 points from 5 matches");
      expect(tableOnly).toContain("standings alone cannot identify the most likely champion");
      expect(tableOnly).toContain("Title probabilities are not inferred from it");
      const caveat = deterministicGroundedResponse("What is the strongest caveat to that ranking?", table) as string;
      expect(caveat).toContain("Every club has played 5 matches");
      expect(caveat).toContain("does not establish how far any club would move");
      for (const answer of [tableOnly, caveat]) {
        expect(answer).toContain("Later results may change the ordering");
        expect(answer).not.toMatch(/mostly reflects fixture order|one result moves a club (?:many|several) places|93\.5%|5\.3%/i);
      }
    });

    it("ranks a settled table without the small-sample caveat", () => {
      const season = seasonGroundingWith(
        [
          { position: 1, team: "Arsenal", playedGames: 30, points: 70, goalDifference: 40 },
          { position: 2, team: "Man City", playedGames: 30, points: 66, goalDifference: 35 },
        ],
        [
          { team: "Arsenal", probability: 0.81 },
          { team: "Man City", probability: 0.18 },
        ]
      );
      const answer = deterministicGroundedResponse(
        "Rank the title contenders using the current table only.",
        season
      ) as string;
      expect(answer).toContain("**Arsenal**");
      expect(answer).not.toContain("a small sample");
      expect(answer).not.toMatch(/81\.0%|18\.0%/);
    });

    it("reports a completed Premier League table as final results rather than a small sample", () => {
      const standings = Array.from({ length: 20 }, (_, index) => {
        const points = index === 0 ? 90 : index === 1 ? 84 : 59 - index;
        const won = Math.floor(points / 3);
        const draw = points % 3;
        const lost = 38 - won - draw;
        return {
          competitionId: "eng.1", position: index + 1,
          team: index === 0 ? "Arsenal" : index === 1 ? "Man City" : `Club ${index + 1}`,
          playedGames: 38, won, draw, lost, points,
          goalsFor: won * 2 + draw, goalsAgainst: lost,
          goalDifference: won * 2 + draw - lost, group: null, advanced: false,
        };
      });
      const table = buildCompetitionGrounding("eng.1", standings, new Date("2027-05-24T07:00:00.000Z"));
      const answer = deterministicGroundedResponse("What is the strongest caveat to that ranking?", table) as string;
      expect(answer).toContain("Every club in the supplied Premier League table has completed 38 matches");
      expect(answer).toContain("Arsenal finished first with 90 points");
      expect(answer).toContain("establishes the final league ranking");
      expect(answer).toContain("does not forecast another season");
      expect(answer).not.toMatch(/sample size|small fraction|do not support|later results|while fixtures remain|%/i);

      // Completion requires every club, not merely a leader on 38 games.
      standings[19] = { ...standings[19], playedGames: 37, lost: standings[19].lost - 1 };
      const unfinished = deterministicGroundedResponse(
        "What is the strongest caveat to that ranking?",
        buildCompetitionGrounding("eng.1", standings, new Date("2027-05-24T07:00:00.000Z"))
      ) as string;
      expect(unfinished).toContain("between 37 and 38 matches");
      expect(unfinished).toContain("current standings, not title probabilities");
      expect(unfinished).not.toMatch(/finished first|final league ranking|small fraction|sample size/i);
    });

    it("distinguishes later-season standings from a title forecast without early-sample language", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Arsenal", playedGames: 30,
          won: 22, draw: 4, lost: 4, points: 70, goalsFor: 60, goalsAgainst: 20,
          goalDifference: 40, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Man City", playedGames: 30,
          won: 20, draw: 6, lost: 4, points: 66, goalsFor: 55, goalsAgainst: 20,
          goalDifference: 35, group: null, advanced: false,
        },
      ], new Date("2027-04-05T07:00:00.000Z"));
      const answer = deterministicGroundedResponse("How reliable is that ranking?", table) as string;
      expect(answer).toContain("Arsenal are first in the supplied table with 70 points");
      expect(answer).toContain("Every listed club has played 30 matches");
      expect(answer).toContain("current standings, not title probabilities");
      expect(answer).toContain("not a guarantee of the final positions");
      expect(answer).not.toMatch(/sample size|small fraction|do not support|finished first|%/i);
    });

    it("states all-zero table provenance and declines standings-only upset sensitivity", () => {
      const table = buildCompetitionGrounding("eng.1", [
        {
          competitionId: "eng.1", position: 1, team: "Bournemouth", playedGames: 0,
          won: 0, draw: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0,
          goalDifference: 0, group: null, advanced: false,
        },
        {
          competitionId: "eng.1", position: 2, team: "Arsenal", playedGames: 0,
          won: 0, draw: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0,
          goalDifference: 0, group: null, advanced: false,
        },
      ], new Date("2026-08-21T07:57:47.409Z"));
      const current = deterministicGroundedResponse("What does the current table show?", table);
      expect(current).toContain("does not establish an on-field ranking");
      expect(current).toContain("provider's ordering among tied teams");
      expect(current).not.toMatch(/seeding|promoted|squad ranking/i);
      const sensitivity = deterministicGroundedResponse("How sensitive is that view to one upset?", table);
      expect(sensitivity).toContain("standings alone cannot quantify");
      expect(sensitivity).toMatch(/^I can’t stress-test/);
      expect(sensitivity).toContain("One upset can move several positions");
      expect(sensitivity).not.toMatch(/few percentage points|top two are entrenched/i);
    });

    it("drops a punctuation-only leading fragment", () => {
      expect(dropLeadingAnswerFragment("). Could you share the fixture?")).toBe("Could you share the fixture?");
      expect(dropLeadingAnswerFragment("**Verdict**\nArsenal lead.")).toBe("**Verdict**\nArsenal lead.");
    });

    it("renders every non-priced capability reason from the structured decision only", () => {
      const fixture = recognizeEspnFixture({
        id: 901,
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
      const cases: Array<[FixtureGrounding["capability"], RegExp]> = [
        [{ status: "outside-coverage", reason: "friendly-policy-disabled" }, /don’t publish forecasts for friendlies/i],
        [{ status: "outside-coverage", reason: "unsupported-competition" }, /don’t cover this competition/i],
        [{ status: "outside-coverage", reason: "model-policy-disabled" }, /exclude this fixture under my forecasting policy/i],
        [{ status: "temporarily-unpriced", reason: "model-initializing" }, /still preparing my forecasts/i],
        [{ status: "temporarily-unpriced", reason: "ratings-refreshing" }, /refreshing the team-strength ratings/i],
        [{ status: "insufficient-model-input", reason: "ratings-unavailable" }, /don't have a required team-strength rating/i],
        [{ status: "insufficient-model-input", reason: "neutral-venue-unknown" }, /haven't confirmed whether this is at a neutral venue/i],
        [{ status: "insufficient-model-input", reason: "required-context-missing" }, /don't have the required pricing inputs for it yet/i],
      ];
      for (const [capability, expected] of cases) {
        const answer = deterministicCoverageResponse(false, { kind: "fixture", fixture, capability });
        expect(answer).toMatch(expected);
        {
          expect(answer).toMatch(/^I[ ’]/);
          expect(answer).not.toMatch(/recognized fixture|model input|model context|payload|grounding/i);
        }
        expect(answer).not.toMatch(/squad|line-?up|S1|S2|probabilit(?:y|ies):?\s*\d/i);
      }
    });
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
        tier: "news" as const,
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
    expect(rendered.answer).toMatch(/No verified, dated team-news update was established/i);
  });

  it("removes a denial of history the request actually supplied", () => {
    // The live answer that defeated the narrow original guard. It required
    // "the prior answer"; the model wrote "a prior answer or match context to
    // reference", so the denial reached the reader with the guard beside it.
    const live = "I don't have a prior answer or match context to reference. "
      + "To tell you what would change it, I need the fixture.";
    expect(sanitizeRequestFidelity(live, "What evidence would change that answer?", true))
      .toBe("To tell you what would change it, I need the fixture.");

    for (const denial of [
      "I do not have the previous answer in front of me.",
      "There is no earlier response available.",
      "I can't have a prior message to refer to.",
    ]) {
      expect(sanitizeRequestFidelity(denial, "follow up", true)).toBe("");
    }
  });

  it("keeps the same sentence when no history was supplied", () => {
    // With no prior turn, saying so is true and useful rather than a denial.
    const answer = "I don't have a prior answer to reference.";
    expect(sanitizeRequestFidelity(answer, "opening question", false)).toBe(answer);
  });

  it("does not mistake ordinary missing-context prose for a history denial", () => {
    const answer = "The model does not have injury context available for this match.";
    expect(sanitizeRequestFidelity(answer, "follow up", true)).toBe(answer);
  });

  describe("defects the 2026-08-25 critic pass found in delivered answers", () => {
    const empty = { queries: ["q"], results: [] } as unknown as EvidenceBundle;

    it("strips a bracketed instruction the model wrote to itself", () => {
      // Shipped at the top of a live answer, 96 characters long. The existing
      // bare-label form caps at 30 characters of letters, so it could not reach.
      const leaked = "[search web for recent Sabah vs Beer-Sheva team news and first leg "
        + "result before writing the answer]\n\n**Model vs market**\nBeer-Sheva 57.2%.";
      const cleaned = stripProcessNarration(leaked);
      expect(cleaned).not.toContain("search web for");
      expect(cleaned.startsWith("**Model vs market**")).toBe(true);
    });

    it("leaves ordinary brackets and citation markers alone", () => {
      for (const kept of [
        "[[S1]] is a marker, not an instruction.",
        "See [the preview](https://example.com/x) for more.",
        "[Note] the model is unchanged.",
      ]) {
        expect(stripProcessNarration(kept)).toContain(kept.slice(0, 12));
      }
    });

    it("removes a marker with commentary welded onto it", () => {
      // "[[S1-derived odds in payload]]" matches no resolver, so it survived
      // the marker sweep and reached the reader verbatim.
      const rendered = renderEvidenceCitations(
        "Kalshi at home 50.0% [[S1-derived odds in payload]], Polymarket at 50.8%.",
        empty, false
      ).answer;
      expect(rendered).not.toContain("[[");
      expect(rendered).not.toContain("derived odds");
      // And without the space the excised marker left in front of the comma.
      expect(rendered).toBe("Kalshi at home 50.0%, Polymarket at 50.8%.");
    });

    it("removes a selection counterfactual phrased as a reshuffle", () => {
      // Survived the first pass: no availability verb, and none of "expected
      // to start" / "predicted XI" / "back four" appears in it.
      const rendered = renderEvidenceCitations(
        "A lined-up Amador replacement at the back, plus Aliyev back in as a wide "
          + "attacker, would be the most plausible reason the market is right.",
        empty, true
      ).answer;
      expect(rendered).not.toContain("Amador");
      expect(rendered).not.toContain("Aliyev");
    });

    it("closes a list that trails off into a missing item", () => {
      const repaired = repairTruncatedLists(
        "I'd need:\n- The name of the club or national team, and\n\nOnce those are clear."
      );
      expect(repaired).toContain("- The name of the club or national team.");
      expect(repaired).not.toMatch(/, and\n/);
    });

    it("keeps a conjunction that is doing its job mid-list", () => {
      const untouched = "- First thing, and\n- Second thing.";
      expect(repairTruncatedLists(untouched)).toBe(untouched);
    });

    it("corrects a high line described as shrinking the space behind it", () => {
      // The guard matched "between the defence and the goalkeeper" but not
      // "between the defenders and the goalkeeper", so the identical backwards
      // claim shipped on one wording and was corrected on the other.
      const corrected = sanitizeFootballGeometry(
        "A high defensive line shrinks the space between the defenders and the goalkeeper."
      );
      expect(corrected).toContain("leaves more space behind it");
      expect(corrected).not.toContain("shrinks the space between the defenders");
    });
  });

  describe("render defects the certified-run critic pass found", () => {
    const empty = { queries: ["q"], results: [] } as unknown as EvidenceBundle;
    const delivered = (t: string) => renderEvidenceCitations(t, empty, false).answer;

    it("removes a source marker that carries no digits", () => {
      // "[[S_payload]]" shipped twice in one answer. The sweep was anchored on
      // an id shape with digits in it, and this has none.
      expect(delivered("Kalshi: home 98.0% [[S_payload]]. Polymarket: 97.0% [[S_payload]]."))
        .toBe("Kalshi: home 98.0%. Polymarket: 97.0%.");
    });

    it("keeps a real marker and ordinary double brackets", () => {
      const bundle = { queries: ["q"], results: [{
        id: "S1", title: "Club", url: "https://example.com/a", date: "2026-08-26", snippet: "", tier: "news" as const,
      }] } as unknown as EvidenceBundle;
      expect(renderEvidenceCitations("Timber returns [[S1]].", bundle, false).answer)
        .toContain("[Club](https://example.com/a)");
      expect(delivered("The set [[a, b]] is unrelated.")).toContain("[[a, b]]");
    });

    it("removes a retrieval truncation note", () => {
      expect(delivered("Vutsov; Santos, Train, Makoun (column truncated).")).not.toContain("truncated");
    });

    it("drops a section body opening on a verb with no subject", () => {
      // Whoever was doing the noting was excised upstream; the predicate
      // shipped alone as the section's first words.
      expect(dropDanglingSectionOpeners("**Team news**\nnotes Juan Perea is the only absentee."))
        .not.toContain("Juan Perea");
      expect(dropDanglingSectionOpeners("**Expected lineups**\nlists Levski's predicted XI."))
        .not.toContain("predicted XI");
    });

    it("keeps a body whose first word is a noun, not a verb", () => {
      const kept = "**Notes**\nNotes on the fixture follow below.";
      expect(dropDanglingSectionOpeners(kept)).toBe(kept);
    });
  });

  describe("defects the post-deploy production run surfaced", () => {
    const rows = [["2-0", 0.1247], ["3-0", 0.1125], ["1-0", 0.086],
      ["2-1", 0.0841], ["4-0", 0.076], ["3-1", 0.0758]]
      .map(([score, probability]) => ({ score, probability }));
    const aek = {
      kind: "match", home: "AEK", away: "Levski",
      pHome: 0.795, pDraw: 0.144, pAway: 0.062,
      competitionId: "uefa.champions_qual",
      oddsSources: [], marketDivergence: [],
      scorelines: rows, topScores: rows.slice(0, 5),
    } as unknown as Grounding;

    it("corrects a false count of the top scorelines", () => {
      // Top six are 2-0, 3-0, 1-0, 2-1, 4-0, 3-1. Wins by two or more: 2-0,
      // 3-0, 4-0, 3-1 -- four, not five. Every other figure in the sentence
      // was right, which is what made it quietly wrong.
      expect(sanitizeMatchAnswer(
        "The scoreline mix confirms it — five of the top six lines are AEK wins by two or more.",
        aek
      )).toContain("four of the top six");
    });

    it("leaves a count that is already right, and one it cannot evaluate", () => {
      expect(sanitizeMatchAnswer("Four of the top six lines are AEK wins by two or more.", aek))
        .toContain("Four of the top six");
      // No computable predicate: left alone rather than guessed at.
      expect(sanitizeMatchAnswer("Three of the top five lines feel comfortable.", aek))
        .toContain("Three of the top five");
    });

    it("removes a bet framed as what the reader is betting into", () => {
      expect(sanitizeGroundedMatchNarrative(
        "Confirmed lineups an hour before kickoff settle which of those reads you are betting into.",
        aek
      )).not.toContain("betting into");
    });

    it("drops a section opener whose pronoun has no antecedent", () => {
      // A conjunction in front of the pronoun does not supply one.
      expect(dropDanglingSectionOpeners(
        "**What would change this**\n If they are first-team regulars, the edge widens."
      )).not.toContain("first-team regulars");
      // Nor does an additive opener that adds to nothing.
      expect(dropDanglingSectionOpeners(
        "**Team news**\n Scores24 adds that AEK have no significant injuries."
      )).not.toContain("Scores24");
    });

    it("keeps a section opener that names its own subject", () => {
      for (const kept of [
        "**Verdict**\nAEK are the model's favourite.",
        "**Goals**\nOver 2.5 at 65.6% and both teams to score at 46.4%.",
      ]) {
        expect(dropDanglingSectionOpeners(kept)).toBe(kept);
      }
    });
  });

  describe("defects the 2026-08-26 production run surfaced", () => {
    const scorelines = [["2-0", 0.1247], ["3-0", 0.1125], ["1-0", 0.086],
      ["2-1", 0.0841], ["4-0", 0.076], ["3-1", 0.0758], ["1-1", 0.0684]]
      .map(([score, probability]) => ({ score, probability }));
    const grounding = {
      kind: "match", home: "AEK", away: "Levski",
      pHome: 0.795, pDraw: 0.144, pAway: 0.062,
      competitionId: "uefa.champions_qual",
      oddsSources: [], marketDivergence: [],
      scorelines, topScores: scorelines.slice(0, 5),
    } as unknown as Grounding;

    it("corrects a scoreline shielded by a correct pairing earlier in the sentence", () => {
      // The regex gap could span another scoreline, so "the 2-0 and 3-0 align
      // ... AEK 4-0 (11.3%)" paired 3-0 with 11.3% -- 3-0's real figure -- and
      // the pairing verified, leaving 4-0 quoting a probability that is not
      // its own. 4-0 is 7.6%.
      const corrected = sanitizeMatchAnswer(
        "**AEK 2-0 (12.5%)**, **3-0 (11.3%)** and **1-0 (8.6%)** lead — the 2-0 and 3-0 "
          + "align with the BTTS-No lean. AEK 4-0 (11.3%), 3-1 (7.6%) and 2-1 (8.4%) "
          + "round out the realistic band.",
        grounding
      );
      expect(corrected).toContain("4-0 (7.6%)");
      expect(corrected).not.toContain("4-0 (11.3%)");
      // Every correct figure beside it survives untouched.
      expect(corrected).toContain("2-0 (12.5%)");
      expect(corrected).toContain("3-0 (11.3%)");
      expect(corrected).toContain("2-1 (8.4%)");
    });

    it("refuses the claim that availability is already inside the model", () => {
      // The model reads club-strength ratings and home-field advantage. A live
      // answer said an absentee list "already prices into the model" and then
      // closed by saying the payload does not quantify lineup counterfactuals.
      for (const claim of [
        "Levski's four-name absentee list already prices into the model.",
        "The model already factors in the injuries.",
        "Team news is baked into the forecast.",
      ]) {
        const fixed = sanitizeGroundedMatchNarrative(claim, grounding);
        expect(fixed).toContain("squad availability is not one of those inputs");
      }
    });

    it("leaves the model's own numbers and its honest caveat alone", () => {
      for (const kept of [
        "Pundit's model gives AEK 79.5%, the draw 14.4% and Levski 6.2%.",
        "This payload does not quantify lineup counterfactuals.",
      ]) {
        expect(sanitizeGroundedMatchNarrative(kept, grounding)).toContain(kept.slice(0, 24));
      }
    });

    it("states a market gap as a divergence rather than a bet", () => {
      const verdict = composeValueVerdictSentence({
        source: "kalshi",
        observedAt: "2026-08-26T08:53:00Z",
        legs: [
          { outcome: "home", label: "AEK", modelPercent: 79.5, marketPercent: 64.7, gapPoints: 14.8 },
          { outcome: "draw", label: "the draw", modelPercent: 14.4, marketPercent: 22.5, gapPoints: -8.1 },
          { outcome: "away", label: "Levski", modelPercent: 6.2, marketPercent: 12.7, gapPoints: -6.5 },
        ],
        largest: { outcome: "home", label: "AEK", modelPercent: 79.5, marketPercent: 64.7, gapPoints: 14.8 },
      } as never);
      expect(verdict).toContain("The model rates AEK higher than the market does");
      expect(verdict).toContain("not a recommendation to back anything");
      // Pundit prices no stake and sees no execution price, so it is in no
      // position to name a side worth backing.
      expect(verdict).not.toMatch(/\bvalue is on\b|\bworth backing\b|\bnothing to take\b|\bedge to take\b/i);
    });
  });

  describe("Pundit's own copy is never mistaken for an evidence claim", () => {
    const empty = { queries: ["q"], results: [] } as unknown as EvidenceBundle;
    const delivered = (text: string) =>
      renderEvidenceCitations(text, empty, true).answer;

    it("keeps a sentence that disclaims the capability rather than asserting it", () => {
      // The replacement written in place of an unsupported counterfactual is
      // itself full of the word "lineup", so the explanation for a removal was
      // being removed by the very next guard.
      for (const notice of [
        "The grounded forecast uses club-strength ratings and the competition's "
          + "home-field setting; it does not quantify lineup counterfactuals.",
        "It does not ingest a confirmed lineup, explain why an external price "
          + "differs, or quantify lineup counterfactuals.",
        "This response does not expose an input-by-input contribution decomposition.",
      ]) {
        expect(delivered(notice)).toContain(notice.slice(0, 24));
      }
    });

    it("still removes a real claim that happens to contain a negation", () => {
      // "will not start" is a negation, but it is asserting a squad fact rather
      // than disclaiming a capability.
      expect(delivered("Tom Cairney will not start; he is out with a knee injury."))
        .not.toContain("Cairney");
    });

    it("does not let market prose be read as a lineup after the guard reorder", () => {
      // The named-selection checks now run ahead of the market exclusion, which
      // risks the reverse error: an odds movement read as a team sheet.
      for (const market of [
        "Arsenal come back in as favourites on both books.",
        "Kalshi has Chelsea back in as the shorter price.",
      ]) {
        expect(delivered(market)).toContain(market.slice(0, 20));
      }
    });
  });

  it("removes an unsourced selection claim about a named player", () => {
    // Neither sentence carries an availability verb, so both walked past the
    // squad-availability patterns and reached readers with no source at all --
    // in an answer whose other team-news claims were properly cited.
    for (const claim of [
      "Bernd Leno is the expected starter in goal.",
      "Chelsea are expected to start with a back four shaped around Cucurella, Tosin and Disasi.",
      "Reece James is likely to start at right-back.",
    ]) {
      const rendered = renderEvidenceCitations(claim, { queries: ["q"], results: [] }, true);
      expect(rendered.answer).not.toContain("Leno");
      expect(rendered.answer).not.toContain("Cucurella");
      expect(rendered.answer).not.toContain("Reece James");
    }
  });

  it("removes a selection counterfactual wearing a conditional", () => {
    // Phrasing a selection claim as a hypothesis does not make it
    // hypothetical: it asserts that this player's availability is live and in
    // doubt, which is a current fact about the world. A live answer carried a
    // whole swing-factor argument this way with nothing behind it.
    for (const [claim, token] of [
      ["The one swing factor is Solvet: if he starts, the attacking shape is unchanged.", "Solvet"],
      ["If either is missing, the Fulham win probability rises toward 40.25%.", "40.25"],
      ["If Cucurella is fit, the back four holds.", "Cucurella"],
      ["Almeida steps in for the injured man and the threat eases.", "Almeida"],
    ] as const) {
      expect(renderEvidenceCitations(claim, { queries: ["q"], results: [] }, true).answer)
        .not.toContain(token);
    }
  });

  it("keeps a conditional the model owns rather than the world", () => {
    // Nothing here is a claim about anyone's availability, so it needs no
    // source -- these are statements about the payload's own arithmetic.
    for (const owned of [
      "If the match ends 1-1, the model's most likely scoreline was correct.",
      "Pundit's model has Sabah at 57.2% and Beer-Sheva at 24.6%.",
    ]) {
      expect(renderEvidenceCitations(owned, { queries: ["q"], results: [] }, true).answer)
        .toBe(owned);
    }
  });

  it("does not let the bare word \"unknown\" launder an uncited squad claim", () => {
    // A live answer wrote "Beer-Sheva's wider injury list is the more material
    // unknown going into kickoff" -- an uncited team-news comparison -- and the
    // noun "unknown" alone marked the whole sentence as an abstention. Any
    // sentence could take that exit.
    const smuggled = "Sabah's missing pieces are narrower, so Beer-Sheva's wider "
      + "injury list is the more material unknown going into kickoff.";
    expect(renderEvidenceCitations(smuggled, { queries: ["q"], results: [] }, true).answer)
      .not.toContain("injury list");
  });

  it("still recognises an abstention that is doing an abstention's work", () => {
    for (const abstention of [
      "No verified, dated team-news update was established.",
      "The starting eleven remains unknown at this stage.",
      "The lineup is still unconfirmed.",
      "The venue for this fixture is unknown, so Pundit will not estimate probabilities.",
    ]) {
      expect(renderEvidenceCitations(abstention, { queries: ["q"], results: [] }, true).answer)
        .toBe(abstention);
    }
  });

  it("keeps a selection claim that carries its source", () => {
    const bundle = {
      queries: ["chelsea predicted xi"],
      results: [{
        id: "S1",
        title: "Predicted XIs",
        url: "https://example.com/xi",
        date: "2026-08-23",
        snippet: "Leno starts in goal.",
        tier: "news" as const,
      }],
    };
    const rendered = renderEvidenceCitations(
      "Bernd Leno is the expected starter in goal. [[S1]]",
      bundle,
      true
    );
    expect(rendered.answer).toContain("Leno");
    expect(rendered.answer).toContain("[Predicted XIs](https://example.com/xi)");
  });

  it("never mistakes Pundit's own capability copy for unsourced team news", () => {
    // "missing" and "absent" are the two words in the team-news pattern that
    // are not inherently about people, and the server's deterministic notices
    // use both. Filing those as evidence let the abstention sweep replace a
    // capability answer with "no verified team news was established".
    for (const notice of [
      "This recognized fixture is missing a required model input, so I can't estimate probabilities.",
      "Required model context or input is missing.",
      "I don't yet have enough information about this fixture. I can't estimate probabilities until I have that information.",
      "I recognize this fixture, but I don't have the required pricing inputs for it yet, so I can't estimate probabilities.",
      "I don't have a required team-strength rating. I can't estimate probabilities until I have that information.",
      "I haven't confirmed whether this is at a neutral venue. I can't estimate probabilities until I have that information.",
      "I’m still preparing my forecasts. I can’t give probabilities for this fixture yet.",
      "I’m refreshing the team-strength ratings. I can’t give probabilities for this fixture yet.",
      "I don’t publish forecasts for friendlies. I can’t give probabilities or scoreline estimates for it.",
      "A complete market is missing for this fixture.",
    ]) {
      const rendered = renderEvidenceCitations(notice, { queries: ["q"], results: [] }, true);
      expect(rendered.answer).toBe(notice);
    }
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
        tier: "news" as const,
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

  // Was: an undated source could not carry a current-news claim, so the claim
  // was replaced by the abstention. That hid genuinely sourced team news --
  // most pages carry no machine-readable date -- and spliced the notice into
  // the middle of paragraphs, stranding the sentences that referred back to
  // it. The claim now reaches the reader with its source shown and marked
  // undated, which is a caveat they can weigh rather than a silent deletion.
  it("renders undated evidence for a current-news claim, marked undated", () => {
    const rendered = renderEvidenceCitations(
      "The player is available [[S1]].",
      { queries: ["query"], results: [{
        id: "S1",
        title: "Undated result",
        url: "https://example.com/undated",
        date: "",
        snippet: "Available",
        tier: "news" as const,
      }] },
      true
    );
    expect(rendered.answer).toContain("The player is available");
    expect(rendered.answer).toContain("undated");
    expect(rendered.answer).not.toMatch(/No verified, dated team-news update was established/i);
    expect(rendered.citations.map((citation) => citation.url))
      .toEqual(["https://example.com/undated"]);
    expect(rendered.citations.map((citation) => citation.date))
      .toEqual(["undated"]);
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

const PREMIER_LEAGUE_TEST_TEAMS = [
  "Arsenal", "Manchester City", "Aston Villa", "Manchester United", "Liverpool",
  "Bournemouth", "Brighton & Hove Albion", "Newcastle United", "Brentford", "Chelsea",
  "Nottingham Forest", "Fulham", "Crystal Palace", "Everton", "Leeds United",
  "Tottenham Hotspur", "West Ham United", "Sunderland", "Wolverhampton Wanderers", "Burnley",
];

function completePremierLeagueSchedule(): FootballMatch[] {
  let id = 50_000;
  return PREMIER_LEAGUE_TEST_TEAMS.flatMap((homeTeam) =>
    PREMIER_LEAGUE_TEST_TEAMS
      .filter((awayTeam) => awayTeam !== homeTeam)
      .map((awayTeam) => ({
        id: id++,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam,
        awayTeam,
        utcDate: "2027-05-01T14:00:00.000Z",
        status: "SCHEDULED",
        stage: null,
        matchday: null,
        group: null,
        score: null,
      }))
  );
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

  it("attaches reconstructable model fair odds on pricing", () => {
    const grounding = buildGrounding(fixtures[0]);
    expect(grounding.pricing.model.home.fairOdds).toBeCloseTo(1 / grounding.pHome);
    expect(grounding.pricing.model.home.p).toBe(grounding.pHome);
    expect(grounding.pricing.userLine).toBeNull();
    expect(grounding.pricing.stakeFrac).toBeNull();
    expect(grounding.pricing.kickoff).toBe(grounding.date);
    expect(grounding.pricing.pricedAt).toBe(fixtures[0].utcDate);
    expect(grounding.pricing.modelVersion).toBe("unknown");
    for (const market of grounding.pricing.markets) {
      expect(market.edgeBand).toBeNull();
      for (const outcome of ["home", "draw", "away"] as const) {
        expect(market.legs[outcome].decimalOdds).toBeNull();
        expect(market.legs[outcome].impliedP).toBeNull();
        expect(market.legs[outcome].evPct).toBeNull();
      }
    }
  });

  it("copies ratingArtifactId onto pricing.modelVersion", () => {
    const grounding = buildGrounding(fixture("Arsenal", "Coventry City", {
      forecastProvenance: {
        ratingArtifactId: "clubelo@1:2da1616b28750ddb",
      } as ModelFixture["forecastProvenance"],
    }));
    expect(grounding.pricing.modelVersion).toBe("clubelo@1:2da1616b28750ddb");
  });

  it("includes Elo, lambdas, form, table and scorers from match context", () => {
    replaceFootballDataForTests({
      byCompetition: {
        "eng.1": {
          upcoming: [],
          recent: [],
          standings: [
            {
              competitionId: "eng.1",
              position: 1,
              team: "Arsenal",
              playedGames: 4,
              won: 3,
              draw: 1,
              lost: 0,
              points: 10,
              goalsFor: 9,
              goalsAgainst: 2,
              goalDifference: 7,
              group: null,
              advanced: false,
            },
            {
              competitionId: "eng.1",
              position: 18,
              team: "Coventry City",
              playedGames: 4,
              won: 0,
              draw: 1,
              lost: 3,
              points: 1,
              goalsFor: 2,
              goalsAgainst: 8,
              goalDifference: -6,
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
        {
          id: 1,
          competitionId: "eng.1",
          competition: "Premier League",
          homeTeam: "Arsenal",
          awayTeam: "Liverpool",
          utcDate: "2026-09-06T14:00:00Z",
          status: "FINISHED",
          stage: null,
          matchday: null,
          group: null,
          score: { home: 2, away: 1 },
          scorers: [
            { playerId: "saka", name: "Bukayo Saka", team: "Arsenal", position: "W" },
          ],
        },
        {
          id: 2,
          competitionId: "eng.1",
          competition: "Premier League",
          homeTeam: "Coventry City",
          awayTeam: "Hull",
          utcDate: "2026-09-07T14:00:00Z",
          status: "FINISHED",
          stage: null,
          matchday: null,
          group: null,
          score: { home: 0, away: 2 },
        },
      ],
    });
    const model = fixture("Arsenal", "Coventry City", {
      homeElo: 1900,
      awayElo: 1600,
      forecastProvenance: {
        homeAdvantageElo: 42,
      } as ModelFixture["forecastProvenance"],
    });
    const grounding = buildGrounding(model);
    const [lambdaHome, lambdaAway] = eloToLambdas(1900, 1600, 42);
    expect(grounding.homeElo).toBe(1900);
    expect(grounding.awayElo).toBe(1600);
    expect(grounding.lambdaHome).toBeCloseTo(lambdaHome, 4);
    expect(grounding.lambdaAway).toBeCloseTo(lambdaAway, 4);
    expect(grounding.totalXg).toBeCloseTo(lambdaHome + lambdaAway, 4);
    expect(grounding.homeForm).toEqual(["W"]);
    expect(grounding.awayForm).toEqual(["L"]);
    expect(grounding.homeTable).toEqual({
      position: 1,
      points: 10,
      goalDifference: 7,
      playedGames: 4,
    });
    expect(grounding.awayTable).toEqual({
      position: 18,
      points: 1,
      goalDifference: -6,
      playedGames: 4,
    });
    expect(grounding.homeScorers[0]).toMatchObject({ name: "Bukayo Saka", goals: 1 });
    expect(grounding.awayScorers).toEqual([]);
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

  it("retains current-table and current-standings follow-ups in the named competition", () => {
    const history = [
      {
        role: "user" as const,
        content: "Rank the leading contenders in the Premier League title race using the current table.",
      },
      {
        role: "assistant" as const,
        content: "The current table alone cannot rank the contenders.",
      },
    ];

    expect(resolveCompetitionContext(
      "Given that the current table cannot rank them, how sensitive is that view to one upset?",
      history
    )).toBe("eng.1");
    expect(resolveCompetitionContext("What do the current standings show?", []))
      .toBe("eng.1");
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

  it("does not answer a named uncovered competition's table with the Premier League", () => {
    // Production answered "What about the Champions League table?" with the
    // Premier League top five: "league table" is a bare-table cue.
    const plHistory = [
      { role: "user" as const, content: "Show me the Premier League table" },
      { role: "assistant" as const, content: "Man City lead with 15 points." },
    ];
    for (const question of [
      "What about the Champions League table?",
      "Show me the La Liga table",
      "Serie A standings please",
    ]) {
      expect(resolveCompetitionContext(question, [])).toBeUndefined();
      expect(resolveCompetitionContext(question, plHistory)).toBeUndefined();
      expect(uncoveredTableResponse(question, null)).toMatch(/^I don’t hold the .+ standings/);
    }
    expect(uncoveredTableResponse("What about the Champions League table?", null))
      .toContain("The Premier League is the only league table in my data");
    // Covered competitions and unrelated phrasing are untouched.
    expect(resolveCompetitionContext("Show me the current table", [])).toBe("eng.1");
    expect(resolveCompetitionContext("Who's chasing a Champions League spot in the table?", []))
      .toBe("eng.1");
    expect(resolveCompetitionContext("Champions League qualifying standings", []))
      .toBe("uefa.champions_qual");
    expect(uncoveredTableResponse("Show me the current table", null)).toBeNull();
    expect(uncoveredTableResponse("Who will win the Champions League?", null)).toBeNull();
  });
});

describe("shouldUseMatchGrounding", () => {
  it("recognizes a match-specific follow-up", () => {
    expect(shouldUseMatchGrounding("What about the draw chance?")).toBe(true);
    expect(shouldUseMatchGrounding("Which side has the stronger model case, and why?"))
      .toBe(true);
    expect(shouldUseMatchGrounding("Which model input matters most to that edge?"))
      .toBe(true);
    expect(shouldUseMatchGrounding("Is this over 2.5?")).toBe(true);
    expect(shouldUseMatchGrounding("Who is most likely to score?")).toBe(true);
    expect(shouldUseMatchGrounding("Who will most likely score for Liverpool?")).toBe(true);
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

  it("follows the matchup an earlier turn named when the client sends no context", () => {
    const liverpoolCity = fixture("Liverpool", "Man City");
    const arsenalLeeds = fixture("Arsenal", "Leeds", { fixtureId: 2 });
    const fixtures = [liverpoolCity, arsenalLeeds];
    const history = [
      { role: "user" as const, content: "Liverpool v Man City — who wins?" },
      { role: "assistant" as const, content: "Man City 44.9%." },
    ];
    const resolve = (question: string, turns = history) =>
      resolveAskContext(question, turns, undefined, fixtures, [], []);
    for (const question of ["What about over 2.5 goals?", "And BTTS for them?", "What's the most likely score?"]) {
      expect(resolve(question)).toMatchObject({ tier: "match", fixture: { home: "Liverpool", away: "Man City" } });
    }
    // A table detour does not clear it, and a newer matchup replaces it.
    expect(resolve("What about over 2.5 goals?", [
      ...history,
      { role: "user", content: "Show me the current table" },
      { role: "assistant", content: "Man City lead." },
    ])).toMatchObject({ tier: "match", fixture: { home: "Liverpool" } });
    expect(resolve("What about over 2.5 goals?", [
      ...history,
      { role: "user", content: "Arsenal vs Leeds prediction" },
      { role: "assistant", content: "Arsenal 76.7%." },
    ])).toMatchObject({ tier: "match", fixture: { home: "Arsenal" } });
    // Leaving the match, or no matchup ever named, stays general.
    expect(resolve("Who is the best striker in the world right now?")).toMatchObject({ tier: "general" });
    expect(resolve("What about over 2.5 goals?", [
      { role: "user", content: "Explain xG" },
      { role: "assistant", content: "xG measures chance quality." },
    ])).toMatchObject({ tier: "general" });
  });

  it("resolves a typo'd matchup only when it completes one real fixture", () => {
    const fixtures = [
      fixture("Arsenal", "Leeds"),
      fixture("Liverpool", "Man City", { fixtureId: 2 }),
      fixture("Chelsea", "Tottenham", { fixtureId: 3 }),
    ];
    // Both production misses.
    expect(resolveQuestionTeams("arsnal vs leds whos gonna win", fixtures)).toEqual(["Arsenal", "Leeds"]);
    expect(resolveQuestionTeams("liverpol man citty prediction", fixtures)).toEqual(["Liverpool", "Man City"]);
    expect(resolveAskContext("arsnal vs leds whos gonna win", [], undefined, fixtures, [], []))
      .toMatchObject({ tier: "match", fixture: { home: "Arsenal", away: "Leeds" } });
    // A real word one edit from a club, or a near-miss that forms no fixture,
    // never manufactures a matchup.
    expect(resolveQuestionTeams("Arsenal leads the league on goal difference", fixtures)).toBeUndefined();
    expect(resolveQuestionTeams("arsnal vs chelsee", fixtures)).toBeUndefined();
    expect(resolveQuestionTeams("Explain what xG is", fixtures)).toBeUndefined();
    // Exact names still win and are unaffected.
    expect(resolveQuestionTeams("Chelsea vs Tottenham", fixtures)).toEqual(["Chelsea", "Tottenham"]);
  });

  it("answers World Cup 2026 questions with the retired pipeline, not a preview", () => {
    const now = new Date("2026-09-29T00:00:00Z");
    for (const question of [
      "Who will win the 2026 World Cup?",
      "Give me probabilities for England vs France at the World Cup",
    ]) {
      const answer = worldCupRetiredResponse(question, null, now);
      expect(answer).toMatch(/^The 2026 World Cup has already been played/);
      expect(answer).toContain("/evaluation/wc-2026");
      expect(answer).not.toMatch(/\d+(?:\.\d+)?%/);
    }
    expect(worldCupRetiredResponse("Who won the 2022 World Cup?", null, now)).toBeNull();
    expect(worldCupRetiredResponse("Who will win the Club World Cup?", null, now)).toBeNull();
    expect(worldCupRetiredResponse("Arsenal vs Leeds", null, now)).toBeNull();
  });

  it("treats two known clubs with no fixture between them as an unconfirmed matchup", () => {
    const fixtures = [fixture("Liverpool", "Man City"), fixture("Arsenal", "Fulham", { fixtureId: 2 })];
    expect(resolveAskContext("Liverpool vs Fulham", [], undefined, fixtures, [], []))
      .toEqual({ tier: "candidate" });
    // A real fixture, and a question that is not shaped like a matchup, are unchanged.
    expect(resolveAskContext("Liverpool vs Man City", [], undefined, fixtures, [], []))
      .toMatchObject({ tier: "match" });
    expect(resolveAskContext("Who has the better attack, Liverpool or Fulham?", [], undefined, fixtures, [], []))
      .toMatchObject({ tier: "general" });
  });

  it.each([
    "Explain the trade-offs of pressing traps against a narrow midfield in detail.",
    "What are the trade-offs of pressing traps against a narrow midfield?",
    "Why are pressing traps effective against a narrow midfield?",
    "Why do pressing traps work against a narrow midfield?",
    "Explain a high press against a low block.",
    "Compare a high press vs a low block in the Premier League.",
    "Compare a high defensive line vs a deep block.",
    "Compare 4-3-3 vs 4-4-2.",
    "Compare 4-2-3-1 versus 3-4-2-1.",
    "Explain counter-pressing vs a low-block.",
    "Which is more effective: man-marking vs zonal-marking?",
  ])("keeps tactical concepts general: %s", (question) => {
    expect(resolveAskContext(question, [], undefined, [], [], []))
      .toEqual({ tier: "general" });
  });

  it.each([
    "Explain Northbridge Athletic vs Southbank Rovers pressing traps.",
    "What are the trade-offs of Northbridge Athletic pressing traps against Southbank Rovers narrow midfield?",
    "Why are Northbridge’s pressing traps effective against Southbank’s narrow midfield?",
    "Explain Northbridge Athletic high press vs Southbank Rovers low block.",
    "Explain Northbridge’s high press vs Southbank’s low block.",
    "Explain Northbridge Athletic high press vs Southbank Rovers low block in the Premier League.",
    "Give match odds for a high press vs a low block.",
    "Give probabilities for a high press vs a low block.",
    "Give odds for a high press vs a low block.",
    "Explain Liverpool's high press vs Fulham's low block.",
  ])("does not exempt clubs or pricing requests: %s", (question) => {
    const fixtures = [fixture("Liverpool", "Man City"), fixture("Arsenal", "Fulham", { fixtureId: 2 })];
    expect(resolveAskContext(question, [], undefined, fixtures, [standing()], []))
      .toEqual({ tier: "candidate" });
  });

  it.each(["team", "history", "identity"])("classifies a new comparison before %s retention", (contextKind) => {
    const priced = fixture("Liverpool", "Man City");
    const history = contextKind === "history"
      ? [{ role: "user" as const, content: "Liverpool vs Man City" }]
      : [];
    const teams: [string, string] | undefined = contextKind === "team" ? ["Liverpool", "Man City"] : undefined;
    const routing = contextKind === "identity"
      ? { fixtureContext: { fixtureId: espnFixtureIdentity(priced) } }
      : {};
    for (const question of [
      "Explain the trade-offs of pressing traps against a narrow midfield in detail.",
      "What are the trade-offs of pressing traps against a narrow midfield?",
      "Why do pressing traps work against a narrow midfield?",
    ]) {
      expect(resolveAskContext(question, history, teams, [priced], [], [], routing))
        .toEqual({ tier: "general" });
    }
    for (const question of [
      "Explain Northbridge Athletic high press vs Southbank Rovers low block.",
      "What are the trade-offs of Northbridge Athletic pressing traps against Southbank Rovers narrow midfield?",
      "Why are Northbridge’s pressing traps effective against Southbank’s narrow midfield?",
    ]) {
      expect(resolveAskContext(question, history, teams, [priced], [], [], routing))
        .toEqual({ tier: "candidate" });
    }
  });

  it.each([
    "In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?",
    "In general, why should a strong favourite never be treated as a guaranteed win?",
    "In general, how can a derby change the tactical trade-offs and game management?",
    "In general, what makes a good chance for a striker, beyond past goal totals?",
  ])("keeps a standalone desk slate prompt general without losing a later exact-ID return: %s", (question) => {
    const retained = recognizedFriendly(800, "Arsenal", "Liverpool");
    // Slate chips omit history and fixture context; the client keeps its pin
    // separately so a later typed match follow-up can send the exact identity.
    expect(resolveAskContext(question, [], undefined, [], [], [], {
      recognizedFixtures: [retained],
    })).toEqual({ tier: "general" });
    expect(resolveAskContext("Back to that match: what is the forecast coverage?", [], undefined, [], [], [], {
      recognizedFixtures: [retained],
      fixtureContext: { fixtureId: retained.fixtureId },
    })).toMatchObject({ tier: "fixture", fixture: { fixtureId: retained.fixtureId } });
  });

  it("owes a search for a result question", () => {
    expect(deterministicSearchQuery("Who went through in Celtic's Champions League qualifier tie on aggregate?"))
      .not.toBeNull();
    expect(deterministicSearchQuery("Who will win Serie A?")).not.toBeNull();
    expect(deterministicSearchQuery("How does a high press work?")).toBeNull();
    // "Right now" asks about the present like "current" does.
    expect(deterministicSearchQuery("Who is the best striker in the world right now?")).not.toBeNull();
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

  it("routes table-route-preserves-match through competition and back to the retained priced fixture", () => {
    const priced = fixture("Arsenal", "Leeds", { fixtureId: 401879268 });
    const standings = [standing("eng.1", "Arsenal"), standing("eng.1", "Leeds")];
    const routing = {
      fixtureContext: { fixtureId: espnFixtureIdentity(priced) },
      modelInitialized: true,
      ratingsAvailable: true,
    };
    expect(resolveAskContext(
      "Analyse Arsenal vs Leeds.",
      [],
      ["Arsenal", "Leeds"],
      [priced],
      standings,
      [],
      routing
    )).toMatchObject({ tier: "match", fixture: { fixtureId: 401879268 } });
    const tableHistory = [
      { role: "user" as const, content: "Analyse Arsenal vs Leeds." },
      { role: "assistant" as const, content: "My 1X2 is Arsenal 75.9%, draw 17.9% and Leeds 6.2%." },
    ];
    expect(resolveAskContext(
      "What does the current Premier League table show?",
      tableHistory,
      ["Arsenal", "Leeds"],
      [priced],
      standings,
      [],
      routing
    )).toEqual({ tier: "competition", competitionId: "eng.1" });
    const returnHistory = [
      ...tableHistory,
      { role: "user" as const, content: "What does the current Premier League table show?" },
      { role: "assistant" as const, content: "Arsenal lead on 16 points from six games." },
    ];
    expect(resolveAskContext(
      "Back to that match: what will the 1X2 be?",
      returnHistory,
      ["Arsenal", "Leeds"],
      [priced],
      standings,
      [],
      routing
    )).toMatchObject({ tier: "match", fixture: { fixtureId: 401879268 } });
    const matchGrounding = buildGrounding(priced);
    expect(closedGroundedAnswer(
      "Back to that match: what will the 1X2 be?",
      matchGrounding,
      true
    )).toMatch(/My 1X2 is Arsenal 40\.0%/);
  });

  it("does not match the epl token inside replacing", () => {
    expect(isCompetitionQuestion("Who is replacing the injured manager?")).toBe(false);
    expect(deterministicUngroundedClarification(
      "Who is replacing the injured manager?", null
    )).toBe(
      "I need the manager and club before I can identify a replacement. Tell me both, and I’ll check the current evidence."
    );
    expect(deterministicUngroundedClarification(
      "Who is replacing Pep Guardiola at Man City?", null
    )).toBeNull();
  });

  it("settles the foundational high-line pressing trade-off without generated prose", () => {
    const answer = deterministicUngroundedAnalysis(
      "How does a high defensive line change a team's pressing risks?", null
    );
    expect(answer).toContain("leaves more space behind it");
    expect(answer).toContain("one pass in behind");
    expect(answer).toContain("does not guarantee");
    expect(deterministicUngroundedAnalysis(
      "How should Arsenal press this weekend?", null
    )).toBeNull();
  });

  it.each([
    "Explain the trade-offs of pressing traps against a narrow midfield in detail.",
    "What are the trade-offs of pressing traps against a narrow midfield?",
    "Why are pressing traps effective against a narrow midfield?",
    "Why do pressing traps work against a narrow midfield?",
  ])("explains the trap mechanism without team-news claims or exempting unknown clubs: %s", (question) => {
    const answer = deterministicUngroundedAnalysis(question, null);
    expect(answer).toContain("press as the pass travels");
    expect(answer).toContain("blocks the return pass");
    expect(answer).toContain("third-player combination");
    expect(answer).toContain("far side open to a switch");
    expect(answer).toContain("does not make either trap successful");
    expect(answer).not.toMatch(/team-news|4-4-2|doubly effective|verified|\d+(?:\.\d+)?%/);
    expect(deterministicUngroundedAnalysis(question, buildGrounding(fixtures[0]))).toBeNull();
    expect(deterministicUngroundedAnalysis("Explain Northbridge pressing traps against Southbank narrow midfield.", null)).toBeNull();
    expect(deterministicUngroundedAnalysis("What are the trade-offs of Northbridge pressing traps against Southbank narrow midfield?", null)).toBeNull();
    expect(deterministicUngroundedAnalysis("Why are Northbridge’s pressing traps effective against Southbank’s narrow midfield?", null)).toBeNull();
  });

  it("settles evidence follow-ups after an unidentified match without market-flow claims", () => {
    const answer = deterministicUngroundedEvidenceFollowUp(
      "What evidence would change that answer?",
      [{ role: "user", content: "Who has the edge in that match?" }],
      null
    );
    expect(answer).toContain("Name the fixture first");
    expect(answer).toContain("same-source, same-time 1X2 market");
    expect(answer).toContain("not where money sits or why it moved");
    expect(deterministicUngroundedEvidenceFollowUp(
      "What evidence would change that answer?", [], null
    )).toBeNull();
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

  it("uses stable fixtureContext to disambiguate repeated priced legs while a different matchup replaces it", () => {
    const firstLeg = fixture("Fenerbahce", "Lyon", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9101,
      utcDate: "2026-08-18T19:00:00.000Z",
      date: "2026-08-18",
    });
    const secondLeg = fixture("Lyon", "Fenerbahce", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9102,
      utcDate: "2026-08-25T19:00:00.000Z",
      date: "2026-08-25",
    });
    const arsenalFixture = fixture("Arsenal", "Coventry City", { fixtureId: 9103 });
    const recognizeModelFixture = (model: ModelFixture) => recognizeEspnFixture({
      id: model.fixtureId,
      competitionId: model.competitionId,
      competition: model.competition,
      homeTeam: model.home,
      awayTeam: model.away,
      utcDate: model.utcDate,
      status: "SCHEDULED",
      stage: model.stage,
      matchday: null,
      group: model.group,
      score: null,
      neutralVenue: false,
    });
    const recognized = [firstLeg, secondLeg, arsenalFixture].map(recognizeModelFixture);

    expect(resolveAskContext(
      "Fenerbahce vs Lyon — what are the 1X2 probabilities?",
      [],
      undefined,
      [firstLeg, secondLeg, arsenalFixture],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[1].fixtureId },
      }
    )).toEqual({ tier: "match", fixture: secondLeg });

    expect(resolveAskContext(
      "Arsenal vs Coventry City — what are the 1X2 probabilities?",
      [],
      undefined,
      [firstLeg, secondLeg, arsenalFixture],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[1].fixtureId },
      }
    )).toEqual({ tier: "match", fixture: arsenalFixture });
  });

  // BUG: every two-legged tie was unreachable. Both legs carry the same two
  // clubs, so "X vs Y" matched two recognized fixtures and bailed to the
  // discovery-candidate tier -- "no authoritative structured fixture identity"
  // and no probabilities for a fixture Pundit had priced. Seven of the active
  // club pairs are two-legged and the date-sorted qualifiers lead the list, so
  // all three homepage suggestion chips landed on that dead end.
  describe("two-legged ties", () => {
    const firstLeg = fixture("Dinamo Zagreb", "Viking", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9201,
      utcDate: "2026-08-18T19:00:00.000Z",
      date: "2026-08-18",
    });
    const secondLeg = fixture("Viking", "Dinamo Zagreb", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      fixtureId: 9202,
      utcDate: "2026-08-26T19:00:00.000Z",
      date: "2026-08-26",
    });
    const legs = [firstLeg, secondLeg];

    function recognize(model: ModelFixture, status = "SCHEDULED") {
      return recognizeEspnFixture({
        id: model.fixtureId,
        competitionId: model.competitionId,
        competition: model.competition,
        homeTeam: model.home,
        awayTeam: model.away,
        utcDate: model.utcDate,
        status,
        stage: model.stage,
        matchday: null,
        group: model.group,
        score: null,
        neutralVenue: false,
      });
    }

    function resolve(question: string, recognized = legs.map((leg) => recognize(leg))) {
      return resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [],
        [],
        { recognizedFixtures: recognized }
      );
    }

    it("resolves a bare matchup to the next unplayed leg", () => {
      expect(resolve("Dinamo Zagreb vs Viking")).toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("What are the 1X2 probabilities for Dinamo Zagreb vs Viking?"))
        .toEqual({ tier: "match", fixture: firstLeg });
    });

    it("never falls back to the discovery-candidate dead end for a priced tie", () => {
      for (const question of [
        "Dinamo Zagreb vs Viking",
        "Viking against Dinamo Zagreb",
        "How does the Dinamo Zagreb vs Viking match look?",
        "Will Dinamo Zagreb beat Viking?",
      ]) {
        expect(resolve(question)).not.toEqual({ tier: "candidate" });
      }
    });

    it("honours an explicit leg cue", () => {
      expect(resolve("Dinamo Zagreb vs Viking first leg"))
        .toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("Dinamo Zagreb vs Viking second leg"))
        .toEqual({ tier: "match", fixture: secondLeg });
      expect(resolve("What about the return leg of Dinamo Zagreb vs Viking?"))
        .toEqual({ tier: "match", fixture: secondLeg });
    });

    it("honours a date cue that identifies exactly one leg", () => {
      for (const question of [
        "Dinamo Zagreb vs Viking on the 26th",
        "Dinamo Zagreb vs Viking on 2026-08-26",
        "Dinamo Zagreb vs Viking on August 26",
        "Dinamo Zagreb vs Viking on Wednesday",
      ]) {
        expect(resolve(question)).toEqual({ tier: "match", fixture: secondLeg });
      }
      // Tuesday is the first leg, and a totals cue must not read as a date.
      expect(resolve("Dinamo Zagreb vs Viking on Tuesday"))
        .toEqual({ tier: "match", fixture: firstLeg });
      expect(resolve("Dinamo Zagreb vs Viking over 2.5 goals"))
        .toEqual({ tier: "match", fixture: firstLeg });
    });

    // recognizedFixtureMatchesByTeams drops completed legs while one is still
    // to be played, so ambiguity only survives once the whole tie is done --
    // and then the question is about the last thing that happened.
    it("uses the most recent leg once the tie is complete", () => {
      const played = legs.map((leg) => recognize(leg, "FINISHED"));
      expect(resolve("Dinamo Zagreb vs Viking", played))
        .toMatchObject({ tier: "match", fixture: secondLeg });
    });

    it("still fails closed when two fixtures for the same clubs are indistinguishable", () => {
      const clash = fixture("Viking", "Dinamo Zagreb", {
        competitionId: "uefa.champions_qual",
        competition: "UEFA Champions League Qualifying",
        fixtureId: 9203,
        utcDate: firstLeg.utcDate,
        date: firstLeg.date,
      });
      expect(resolve("Dinamo Zagreb vs Viking", [firstLeg, clash].map((leg) => recognize(leg))))
        .toEqual({ tier: "candidate" });
    });

    it("leaves single-leg resolution untouched", () => {
      expect(resolveAskContext(
        "Arsenal vs Coventry City",
        [],
        undefined,
        fixtures,
        [],
        [],
        { recognizedFixtures: [recognize(fixtures[0])] }
      )).toEqual({ tier: "match", fixture: fixtures[0] });
    });

    // A suggestion chip sends the fixture identity alongside its text, so the
    // click lands on the leg that was rendered rather than on a leg rule.
    it("resolves a suggestion chip to its own leg through fixtureContext", () => {
      const recognized = legs.map((leg) => recognize(leg));
      for (const [index, leg] of legs.entries()) {
        expect(resolveAskContext(
          `${leg.home} vs ${leg.away} · UCL · Tue`,
          [],
          undefined,
          legs,
          [],
          [],
          {
            recognizedFixtures: recognized,
            fixtureContext: { fixtureId: recognized[index].fixtureId },
          }
        )).toEqual({ tier: "match", fixture: leg });
      }
    });

    // The registry can be cold or a step behind the priced rows; a chip still
    // has to land on the fixture it rendered, so the identity also addresses
    // the model row directly.
    it("resolves a chip identity against the model rows with an empty registry", () => {
      expect(resolveAskContext(
        "Viking vs Dinamo Zagreb · UCL · Wed",
        [],
        undefined,
        legs,
        [],
        [],
        { recognizedFixtures: [], fixtureContext: { fixtureId: espnFixtureIdentity(secondLeg) } }
      )).toEqual({ tier: "match", fixture: secondLeg });
    });

    // The chip sets fixtureContext, so the conversational follow-ups that
    // regressed once before now travel that path instead of teamContext.
    it.each([
      "Why?",
      "Tell me more",
      "Is that a good bet?",
      "How confident are you?",
      "What about BTTS?",
    ])("keeps %s on the leg the chip opened", (question) => {
      const recognized = legs.map((leg) => recognize(leg));
      expect(resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [standing()],
        [],
        {
          recognizedFixtures: recognized,
          fixtureContext: { fixtureId: recognized[1].fixtureId },
        }
      )).toEqual({ tier: "match", fixture: secondLeg });
    });

    it.each([
      "How's the table looking?",
      "Who's top right now?",
    ])("lets %s reach competition grounding from a chip-opened leg", (question) => {
      const recognized = legs.map((leg) => recognize(leg));
      expect(resolveAskContext(
        question,
        [],
        undefined,
        legs,
        [standing()],
        [],
        {
          recognizedFixtures: recognized,
          fixtureContext: { fixtureId: recognized[1].fixtureId },
        }
      )).toEqual({ tier: "competition", competitionId: "eng.1" });
    });

    // Two legs of the SAME pair are one tie and resolve; two DIFFERENT pairs
    // are two matches and must keep asking which one is meant.
    it("still refuses two different fixtures with MULTIPLE_FIXTURES", () => {
      const multi = [
        fixture("Arsenal", "Liverpool", { fixtureId: 9301 }),
        fixture("Coventry City", "Tottenham Hotspur", { fixtureId: 9302 }),
      ];
      try {
        resolveAskContext(
          "Compare Arsenal vs Liverpool and Coventry City vs Tottenham",
          [],
          undefined,
          multi,
          [],
          [],
          { recognizedFixtures: multi.map((leg) => recognize(leg)) }
        );
        throw new Error("expected resolveAskContext to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appError = err as AppError;
        expect(appError.code).toBe("MULTIPLE_FIXTURES");
        expect(appError.message).toContain("Arsenal vs Liverpool");
        expect(appError.message).toContain("Coventry City vs Tottenham Hotspur");
      }
    });
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

  it("retains a season outlook for a narrow certainty follow-up", () => {
    const history = [
      { role: "user" as const, content: "Who is leading the Premier League title race right now?" },
      { role: "assistant" as const, content: "Man City is most likely at 53.5%, not a guarantee." },
    ];
    expect(resolveAskContext(
      "Can you guarantee Man City will win, or what would change that view?",
      history,
      undefined,
      [],
      [standing()]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
    expect(resolveAskContext(
      "Can you guarantee Man City will win the next match?",
      history,
      undefined,
      [],
      [standing()]
    )).toEqual({ tier: "general" });
    expect(resolveAskContext(
      "What would change that view?",
      history,
      undefined,
      [],
      [standing()]
    )).toEqual({ tier: "season", competitionId: "eng.1" });
    expect(resolveAskContext(
      "Can you guarantee Man City will win?",
      [
        { role: "user", content: "Rank the title race using the current table." },
        { role: "assistant", content: "The table alone cannot establish a champion." },
      ],
      undefined,
      [],
      [standing()]
    )).toEqual({ tier: "general" });
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

  it("preserves a retained fixture while clarifying a third-club scorer switch", () => {
    const recognized = [recognizeEspnFixture({
      id: fixtures[0].fixtureId,
      competitionId: fixtures[0].competitionId,
      competition: fixtures[0].competition,
      homeTeam: fixtures[0].home,
      awayTeam: fixtures[0].away,
      utcDate: fixtures[0].utcDate,
      status: "SCHEDULED",
      stage: fixtures[0].stage,
      matchday: null,
      group: fixtures[0].group,
      score: null,
      neutralVenue: false,
    })];
    expect(resolveAskContext(
      "Who will most likely score for Liverpool?",
      [],
      undefined,
      fixtures,
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[0].fixtureId },
      }
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(deterministicUngroundedClarification(
      "Who will most likely score for Liverpool?",
      null
    )).toBe("I can’t name Liverpool’s most likely scorer without a fixture and player-level evidence. Tell me Liverpool’s opponent, and I’ll check a dated scorer market and current team news for that match.");
    expect(deterministicUngroundedClarification(
      "Who will most likely score for Liverpool?",
      buildGrounding(fixtures[0])
    )).toBe(`I can’t name Liverpool’s most likely scorer from the match forecast because I don’t have player-level projections. I need Liverpool’s opponent before I can switch fixtures, so I’m keeping ${fixtures[0].home} vs ${fixtures[0].away} in view until then. A dated scorer market and confirmed starters would let me assess the options.`);
    expect(resolveAskContext(
      "Who scores for Everton?",
      [],
      undefined,
      [fixtures[0]],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[0].fixtureId },
      }
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    expect(deterministicUngroundedClarification(
      "Who scores for Everton?",
      null
    )).toBe("I can’t name Everton’s most likely scorer without a fixture and player-level evidence. Tell me Everton’s opponent, and I’ll check a dated scorer market and current team news for that match.");
    expect(resolveAskContext(
      "Who scores for Arsenal?",
      [],
      undefined,
      [fixtures[0]],
      [],
      [],
      {
        recognizedFixtures: recognized,
        fixtureContext: { fixtureId: recognized[0].fixtureId },
      }
    )).toMatchObject({ tier: "match", fixture: fixtures[0] });
    for (const referential of [
      "Who scores for either team?",
      "Who is most likely to score for this team?",
      "Who scores for the hosts?",
      "Who scores for the visitors?",
    ]) {
      expect(resolveAskContext(
        referential,
        [],
        undefined,
        [fixtures[0]],
        [],
        [],
        {
          recognizedFixtures: recognized,
          fixtureContext: { fixtureId: recognized[0].fixtureId },
        }
      )).toMatchObject({ tier: "match", fixture: fixtures[0] });
      expect(deterministicUngroundedClarification(referential, null)).toBeNull();
    }
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
    "Will Liverpool win the league this season?",
    "What are Man City's chances of winning the league?",
    "Arsenal title chances",
    "Compare Arsenal and Liverpool title chances",
    "Compare Man City’s and Liverpool’s title chances",
    "How likely is Arsenal to win the title?",
    "Rank the title contenders",
    "Show title contenders",
    "Compare title contenders",
    "Premier League title chances",
    "What are the title chances for Arsenal?",
  ])("routes %s to the season outlook", (question) => {
    expect(resolveAskContext(question, [], undefined, fixtures, PREMIER_LEAGUE_TEST_TEAMS.map((team) => standing("eng.1", team))))
      .toEqual({ tier: "season", competitionId: "eng.1" });
  });

  it.each([
    "Real Madrid title chances in La Liga",
    "Can Bayern win the Bundesliga title?",
    "What are Inter's chances of winning Serie A?",
  ])("does not route %s to the Premier League season outlook", (question) => {
    expect(resolveAskContext(question, [], undefined, fixtures, [standing()]))
      .not.toEqual({ tier: "season", competitionId: "eng.1" });
  });

  it.each([
    { question: "Can Arsenal win the league cup?", priorSeason: true },
    { question: "Real Madrid title race in La Liga", priorSeason: false },
    { question: "Real Madrid title race in La Liga", priorSeason: true },
    { question: "Bayern Bundesliga relegation battle", priorSeason: false },
    { question: "Bayern Bundesliga relegation battle", priorSeason: true },
    { question: "Real Madrid title chances", priorSeason: false },
    { question: "Real Madrid title chances", priorSeason: true },
    { question: "Compare Arsenal and Real Madrid title chances", priorSeason: false },
    { question: "Compare Arsenal and Real Madrid title chances", priorSeason: true },
    ...[
      "Real Madrid league title chances", "Real Madrid’s league title chances",
      "Show Real Madrid title chances", "Rank Arsenal and Real Madrid title chances",
      "Real Madrid to win the league?", "How likely is Real Madrid to win the title?",
      "Compare Man City’s and Real Madrid’s title chances",
      "What are the title chances for Real Madrid?",
    ].flatMap((question) => [false, true].map((priorSeason) => ({ question, priorSeason }))),
  ])("does not promote an unsupported season subject $question (prior PL: $priorSeason)", ({ question, priorSeason }) => {
    const history = priorSeason ? [{ role: "user" as const, content: "Who wins the Premier League?" }] : [];
    expect(resolveAskContext(question, history, undefined, fixtures, PREMIER_LEAGUE_TEST_TEAMS.map((team) => standing("eng.1", team))))
      .toEqual({ tier: "general" });
  });

  it.each([
    { question: "Real Madrid title chances", current: false, missingTable: false },
    { question: "Compare Arsenal and Real Madrid title chances", current: false, missingTable: false },
    { question: "Real Madrid title race in La Liga", current: false, missingTable: false },
    { question: "Bayern Bundesliga relegation battle", current: false, missingTable: false },
    { question: "Can Arsenal win the league cup?", current: false, missingTable: false },
    { question: "Real Madrid title odds today", current: true, missingTable: false },
    { question: "Arsenal title chances", current: false, missingTable: true },
  ])("delivers an honest unavailable season notice for $question without generation", async ({ question, current, missingTable }) => {
    const history = [{ role: "user" as const, content: "Who wins the Premier League?" }];
    replaceFootballDataForTests({
      standings: missingTable ? [] : PREMIER_LEAGUE_TEST_TEAMS.map((team) => standing("eng.1", team)),
      upcoming: [], recent: [], lastUpdated: new Date(), error: null,
    });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockRejectedValue(new Error("unsupported forecast must not generate"));
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, history, undefined, undefined, undefined, undefined, voice);
        expect(result.grounding).toBeNull();
        expect(result.answer).toContain("season forecasts cover the Premier League only");
        expect(result.answer).not.toMatch(/\d+(?:\.\d+)?%|most likely champion|title favourites?|Dixon-Coles/);
        expect(result.verification.status).toBe("not-required");
      }
      const deltas: string[] = [];
      const stream = await answerQuestionStream(question, history, undefined, {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      });
      expect(stream.grounding).toBeNull();
      expect(stream.answer).toContain("season forecasts cover the Premier League only");
      expect(deltas).toEqual([stream.answer]);
      expect(create).not.toHaveBeenCalled();
      if (current) expect(searchWeb).toHaveBeenCalled();
      else expect(searchWeb).not.toHaveBeenCalled();
      expect(stream.answer).not.toMatch(/outside (?:the|Premier)|Arsenal.*(?:not|isn’t).*Premier League/i);
    } finally {
      create.mockRestore();
      replaceFootballDataForTests({ standings: [], upcoming: [], recent: [], lastUpdated: null, error: null });
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
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

  it("retains match grounding until another team has an identified opponent", () => {
    const teamContext: [string, string] = ["Arsenal", "Coventry City"];
    expect(resolveAskContext(
      "How is Tottenham Hotspur doing?",
      [],
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

/**
 * The policy these guards now implement: model-derived content always
 * survives, evidence guards govern only claims that actually came from search,
 * and missing team news abstains in its own section rather than taking the
 * answer with it.
 *
 * Each guard below has already shipped a delete-correct-content bug once. The
 * mirror failure is loosening one until a real hallucination gets through, so
 * every case proving that content survives is paired with one proving the
 * original hallucination is still blocked.
 */
describe("evidence guards leave model-derived answers intact", () => {
  const modelAnswer = [
    "**Verdict**",
    "Pundit's model gives Arsenal **56.3%**, the draw **23.4%** and Chelsea **20.3%**.",
    "",
    "**Goals**",
    "Over 2.5 lands at **54.0%**, BTTS yes at **52.1%**.",
    "",
    "**Team news**",
    "No verified update was established.",
  ].join("\n");

  const groundedMatch = (overrides: Partial<Grounding> = {}): Grounding => withDivergence({
    kind: "match",
    fixtureId: "espn:eng.1:1",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-08-22T14:00:00Z",
    stage: "Regular Season",
    home: "Arsenal",
    away: "Chelsea",
    pHome: 0.563,
    pDraw: 0.234,
    pAway: 0.203,
    pOver2_5: 0.54,
    pUnder2_5: 0.46,
    pBttsYes: 0.521,
    pBttsNo: 0.479,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [{
      source: "kalshi",
      observedAt: new Date().toISOString(),
      pHome: 0.5,
      pDraw: 0.25,
      pAway: 0.25,
    }],
    ...overrides,
  });

  it("keeps the whole answer when it made no externally sourced claim", async () => {
    // An answer with no citation markers has no verifiable claims, and there
    // is nothing to verify in a claim that was never made. All three guards
    // used to replace the entire answer -- probabilities and all -- with an
    // abstention, which was the single largest source of destroyed answers.
    const checked = await verifyCurrentClaims(
      modelAnswer,
      { queries: ["q"], results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2]
    );
    expect(checked.answer).toBe(modelAnswer);
    expect(checked.verification.status).toBe("abstain");

    expect(failClosedEmptyCurrentVerification(modelAnswer, {
      status: "abstain",
      supportedClaimCount: 0,
      removedClaimCount: 0,
    }, true)).toBe(modelAnswer);

    expect(renderEvidenceCitations(
      modelAnswer,
      { queries: ["q"], results: [] },
      true
    ).answer).toBe(modelAnswer);
  });

  it("still removes an uncited squad claim, including inside a Verdict section", async () => {
    // The hole that excise-not-rebuild could have opened, closed by the
    // sentence-level team-news rule: a squad claim smuggled into a verdict
    // paragraph is still a claim about the outside world.
    const smuggled = "**Verdict**\nArsenal are at **56.3%**. Saka is ruled out with a knee injury.";
    const checked = await verifyCurrentClaims(
      smuggled,
      { queries: ["q"], results: [] },
      {} as Parameters<typeof verifyCurrentClaims>[2]
    );
    expect(checked.answer).toContain("**56.3%**");
    expect(checked.answer).not.toMatch(/Saka|ruled out|knee injury/);
    expect(checked.answer).toContain("No verified, dated team-news update was established");

    for (const guarded of [
      failClosedEmptyCurrentVerification(smuggled, {
        status: "abstain",
        supportedClaimCount: 0,
        removedClaimCount: 0,
      }, true),
      renderEvidenceCitations(smuggled, { queries: ["q"], results: [] }, true).answer,
    ]) {
      expect(guarded).toContain("**56.3%**");
      expect(guarded).not.toMatch(/Saka|ruled out|knee injury/);
      expect(guarded).toMatch(/No verified, dated team-news update was established/i);
    }
  });

  it("resolves a marker the generator wrote without its S prefix", () => {
    // "[[1]]" matched no marker pattern, so it was neither resolved into a
    // source nor stripped: the sentence counted as uncited and was deleted,
    // and the literal bracket text was what reached the chat bubble.
    const bundle = {
      queries: ["q"],
      results: [{
        id: "S1",
        title: "Saka trains",
        url: "https://bbc.co.uk/x",
        date: "2026-08-18",
        snippet: "Saka trained.",
        tier: "news" as const,
      }],
    };
    const rendered = renderEvidenceCitations("Saka is back in training [[1]].", bundle, true);
    expect(rendered.answer).toBe(
      "Saka is back in training ([Saka trains](https://bbc.co.uk/x), 2026-08-18)."
    );
    expect(rendered.citations).toEqual([expect.objectContaining({ id: "S1" })]);

    // A marker naming an id the bundle does not contain is still removed, in
    // every bracket shape, and no bracket form survives to the browser.
    for (const invented of ["[[99]]", "[[S99]]", "[[ S99 ]]"]) {
      const guarded = renderEvidenceCitations(
        `Arsenal are at **56.3%**.\nSaka is fit again ${invented}.`,
        bundle,
        true
      ).answer;
      expect(guarded).toContain("**56.3%**");
      expect(guarded).not.toMatch(/Saka|fit again/);
      expect(guarded).not.toContain("[[");
    }
  });

  it("quotes a market the grounding actually observed, and only that one", () => {
    const grounding = groundedMatch();
    // The escape hatch used to be dead code -- declared, read once, never
    // populated -- so this was wiped to the notice even though Pundit had
    // fetched the price itself and put it in the grounding.
    //
    // DELIBERATE CHANGE OF CONTRACT. This used to assert that the hatch
    // *replaced* the sentence with the rendered recital. Verified-and-kept is
    // now the correct outcome: 50.0% is exactly what the grounding observed
    // from Kalshi, so the sentence presents no unvalidated price and its
    // comparison against the model is the thing the match prompt asked for.
    // The recital is asserted below, where it belongs -- on figures that
    // cannot be reconciled.
    const quoted = sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 50.0%, so the model is a touch higher.",
      grounding
    );
    expect(quoted).toBe("Kalshi has Arsenal at 50.0%, so the model is a touch higher.");
    expect(quoted).not.toContain("omitted those numbers");

    // The same sentence with a figure Kalshi never showed is still removed,
    // and the recital is what stands in its place.
    const misquoted = sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 62.0%, so the model is a touch higher.",
      grounding
    );
    expect(misquoted).toContain("Kalshi market-implied probabilities (third-party data, not a Pundit forecast)");
    expect(misquoted).toContain("home 50.0%, draw 25.0%, away 25.0%");
    expect(misquoted).not.toContain("62.0%");

    // A price attributed to a source the grounding does not carry is still
    // removed, and the model's own numbers on neighbouring lines survive.
    const unattributable = sanitizeRuntimeResponseCorrectness(
      "Polymarket prices the home win at 58.0%.\nThe model has the home win at **77.6%**.",
      grounding
    );
    expect(unattributable).not.toContain("58.0%");
    expect(unattributable).toContain("**77.6%**");
    expect(unattributable).toContain("omitted those numbers");

    // Six hours is many missed 30-minute cycles; a stale observation is not
    // quotable even though it is complete and same-source.
    expect(sanitizeRuntimeResponseCorrectness(
      "Kalshi has Arsenal at 50.0%.",
      groundedMatch({
        oddsSources: [{
          source: "kalshi",
          observedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
          pHome: 0.5,
          pDraw: 0.25,
          pAway: 0.25,
        }],
      })
    )).toContain("omitted those numbers");
  });

  it("keeps an underdog section, the at-stake idiom, and prices split across a decimal point", () => {
    const grounding = groundedMatch({
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date().toISOString(),
        pHome: 0.3,
        pDraw: 0.4,
        pAway: 0.3,
      }],
    });

    // A read-on-the-underdog section is supposed to discuss what the favourite
    // does well; the label used to be blanked for exactly that.
    const underdog = sanitizeGroundedMatchNarrative([
      "**Read on the underdog**",
      "Chelsea need Arsenal to be sloppy at the back.",
      "Arsenal are the model favourite at 56.3%.",
    ].join("\n"), grounding);
    expect(underdog).toContain("**Read on the underdog**");
    expect(underdog).toContain("Chelsea need Arsenal to be sloppy at the back.");
    // The naive splitter cut "56.3%" at the point, leaving "3% ..." behind.
    expect(underdog).toContain("Arsenal are the model favourite at 56.3%.");

    // A draw-favouring market says nothing about which of the two teams it
    // leans to, and "at stake" is an idiom rather than a bookmaker.
    expect(sanitizeGroundedMatchNarrative(
      "The market favours Arsenal on the Kalshi line.",
      grounding
    )).toBe("The market favours Arsenal on the Kalshi line.");
    const atStake = "Arsenal are the favourite at 56.3% in the model. Three points are at stake for Arsenal, and the market backs them.";
    expect(sanitizeGroundedMatchNarrative(atStake, grounding)).toBe(atStake);

    // Sources that disagree cannot establish a single market view for the
    // sentence to be wrong about, so it stands.
    const split = groundedMatch({
      oddsSources: [
        { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.55, pDraw: 0.25, pAway: 0.2 },
        { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.2, pDraw: 0.25, pAway: 0.55 },
      ],
    });
    expect(sanitizeGroundedMatchNarrative("The market backs Arsenal here.", split))
      .toBe("The market backs Arsenal here.");
  });

  it("still removes a claim that contradicts the model's own favourite", () => {
    const contradiction = sanitizeGroundedMatchNarrative(
      "Arsenal are the underdogs here.\nOver 2.5 lands at **54.0%**.",
      groundedMatch()
    );
    expect(contradiction).not.toContain("underdogs");
    expect(contradiction).toContain("**54.0%**");

    // And a market claim that a single agreed market plainly contradicts.
    expect(sanitizeGroundedMatchNarrative(
      "Kalshi favours Chelsea.",
      groundedMatch({
        oddsSources: [{
          source: "kalshi",
          observedAt: new Date().toISOString(),
          pHome: 0.62,
          pDraw: 0.2,
          pAway: 0.18,
        }],
      })
    )).toContain("unsupported interpretation was omitted");
  });

  /**
   * The other way to reach "nothing survived", and the one that was serving
   * users a 91-character reply to a live match question.
   *
   * When the tool-markup and narration guards upstream strip a leaked turn to
   * nothing, this guard is handed "" -- it has removed nothing and has no
   * opinion about anything. It nevertheless answered with its own fail-closed
   * notice, and because that notice is plausible prose it passed
   * `hasMeaningfulProse` and suppressed the grounded fallback in
   * `deliverAnswer`, which is precisely the thing that could have answered the
   * question from Pundit's own numbers.
   */
  it("does not invent a notice for an answer that was already empty", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      expect(sanitizeGroundedMatchNarrative(empty, groundedMatch())).toBe(empty);
    }
    // And an answer it leaves entirely alone is returned untouched, not
    // re-issued through the notice branch.
    const intact = "**Verdict**\nOver 2.5 lands at **54.0%**.";
    expect(sanitizeGroundedMatchNarrative(intact, groundedMatch())).toBe(intact);
  });
});

/**
 * The market guard verifies a quote instead of replacing it.
 *
 * It used to substitute `renderValidatedOneXTwoMarket` for the model's whole
 * line whenever a market was named. `MATCH_SYSTEM_PROMPT` asks the model to
 * compare its probability against the market and state the edge, and
 * `MATCH_EXAMPLE` demonstrates exactly that -- so the substitution deleted the
 * reasoning the prompt had just requested. A production answer had Celtic at
 * 66.9% against Kalshi's 55.4%, an eleven-point divergence and the single most
 * decision-relevant fact available, and the delivered text never mentioned it:
 * it was three bare percentages with `observed 2026-08-19T09:33:30.001Z` on
 * the end.
 *
 * The protection the guard exists for is unchanged and is re-asserted here
 * from every angle that could have been weakened by the change: a price with
 * no validated record behind it, one attributed to a source the grounding does
 * not carry, one that is plausible but simply absent, and one that contradicts
 * the record all still go.
 */
describe("the market guard verifies rather than replaces", () => {
  const observedAt = "2026-08-19T09:33:30.001Z";
  const kalshiLegs = (probabilities: [number, number, number] = [0.554, 0.238, 0.208]) =>
    (["home", "draw", "away"] as const).map((outcome, index) => ({
      outcome,
      decimalOdds: 1 / probabilities[index],
      source: "Kalshi",
      observedAt,
    }));

  it("keeps the model's edge analysis when the quoted figures reconcile", () => {
    // The production sentence, in the shape MATCH_EXAMPLE demonstrates.
    const analysis = "The model gives Celtic **66.9%**, while Kalshi is tighter at 55.4% / 23.8% / 20.8%, so the model sees about **11 points** more edge on the home win.";
    expect(stripUnvalidatedExternalMarketClaims(analysis, [kalshiLegs()])).toBe(analysis);

    for (const survivor of [
      // Labelled legs, the other order, and a lower precision than the record.
      "Kalshi has the home side at 55.4%, the draw at 23.8% and the away side at 20.8%.",
      "At 55.4% / 23.8% / 20.8%, Kalshi is well below the model's 66.9% on Celtic.",
      "Kalshi market-implied: home 55%, draw 24%, away 21%.",
      // The model's own figures share the sentence and are not held against
      // the market record.
      "Kalshi puts the home win at 55.4%, whereas the model has it at 66.9% and over 2.5 at 54.0%.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
    }
  });

  it("keeps the fused quote-and-interpretation sentence the prompt produces", () => {
    // Source quote and interpretation in ONE sentence. The prompt has a rule
    // asking the model to split them, added only to dodge the replace
    // behaviour; this assertion is what makes that rule belt-and-braces rather
    // than load-bearing on MiniMax's compliance.
    const fused = "Kalshi has Celtic at 55.4%, some 11.5 points below the model, the largest disagreement on the card.";
    expect(stripUnvalidatedExternalMarketClaims(fused, [kalshiLegs()])).toBe(fused);

    // The edge magnitude is a unit, not a price, in each form it is written.
    for (const survivor of [
      "Kalshi has Celtic at 55.4%, some **11.5 points** below the model.",
      "Kalshi has Celtic at 55.4%, 11.5 percentage points below the model.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
    }
  });

  /**
   * A gap is not a price, wherever in the sentence it sits.
   *
   * The guard used to exempt a gap magnitude only inside the clause the source
   * name opened, which made word order decide the outcome: "Kalshi has Celtic
   * at 55.4%, some 11.5 points below the model" survived, while "the model is
   * 11.5 percentage points higher than Kalshi" -- the same claim, and exactly
   * what MATCH_SYSTEM_PROMPT asks for -- was deleted as an unattributable
   * price. It quotes no price at all. A difference between two probabilities
   * was never published by any market and so cannot be a fabricated quote.
   */
  it("keeps a sentence that names a source but quotes only a gap", () => {
    for (const survivor of [
      // The gap before the source name, and the source name before the gap.
      "The model is 11.5 percentage points higher than Kalshi on Celtic.",
      "Kalshi is 11.5 percentage points below the model on Celtic.",
      "11.5 percentage points separate the model from Kalshi on Celtic.",
      "On Celtic, the gap to Kalshi is 11.5 percentage points.",
      "Pundit's model sits 11.5 points clear of Kalshi here.",
      "The model's edge over the betting markets is 11.5 points.",
      // A bare magnitude against a comparative, unit left implicit.
      "The model is 11.5 higher than Kalshi on Celtic.",
      // An attributive verb does not make a gap into a quote.
      "Kalshi prices Celtic some 11.5 points under the model.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(survivor, [kalshiLegs()])).toBe(survivor);
      // The gap is not a price whether or not a record exists, so a sentence
      // quoting none cannot be owed the fail-closed notice either.
      expect(stripUnvalidatedExternalMarketClaims(survivor)).toBe(survivor);
    }
  });

  /**
   * The exemption is for magnitudes, not for comparatives. A percent sign means
   * a percentage, and a percentage beside a market source is a price until the
   * record says otherwise -- otherwise "Kalshi has Arsenal at 62.0% above the
   * model" would wave an invented quote straight through on the strength of the
   * word "above".
   */
  it("does not let a comparative excuse a percentage from being checked", () => {
    for (const priced of [
      "Kalshi has Arsenal at 62.0% above the model's read.",
      "Kalshi has Arsenal at 62.0% higher than the model.",
      "Kalshi has Arsenal at 57.0%, well above the model.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs()]);
      expect(sanitized).not.toBe(priced);
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }
  });

  /**
   * Every protection the guard exists for, asserted in the reversed word order
   * too. The fix is positional, so anything that only held in one direction
   * would be a hole in the other.
   */
  it("still removes an unvalidated price written either way round", () => {
    // No record at all.
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "At 62%, Kalshi has Arsenal, so the model is a touch higher.",
    ]) expect(stripUnvalidatedExternalMarketClaims(priced)).toContain("omitted those numbers");

    // A source the grounding does not carry.
    for (const priced of [
      "Polymarket prices the home win at 58.0%.",
      "At 58.0% on the home win, Polymarket is below the model.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs()]);
      expect(sanitized).not.toContain("58.0%");
      expect(sanitized).toContain("omitted those numbers");
    }

    // Plausible but simply absent from the record.
    for (const absent of [
      "Kalshi has Arsenal at 57.0%.",
      "At 57.0%, Kalshi has Arsenal.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(absent, [kalshiLegs()]))
        .toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // Contradicting the record wholesale.
    for (const contradicting of [
      "Kalshi market: home 99%, draw 0.5%, away 0.5%.",
      "Home 99%, draw 0.5%, away 0.5% is the Kalshi market.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(contradicting, [kalshiLegs()]);
      expect(sanitized).not.toContain("99%");
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // A stale or incomplete record is no record, in either order.
    for (const priced of [
      "Kalshi has home 55.4%, draw 23.8% and away 20.8%.",
      "Home 55.4%, draw 23.8% and away 20.8% is what Kalshi shows.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(priced, [kalshiLegs().slice(0, 2)]))
        .toContain("omitted those numbers");
    }
  });

  it("lets two named sources in one sentence each answer for their own figures", () => {
    const polymarketLegs = (["home", "draw", "away"] as const).map((outcome, index) => ({
      outcome,
      decimalOdds: 1 / [0.57, 0.23, 0.2][index],
      source: "Polymarket",
      observedAt,
    }));
    const both = "Kalshi has the home win at 55.4% and Polymarket at 57.0%, either way below the model.";
    expect(stripUnvalidatedExternalMarketClaims(both, [kalshiLegs(), polymarketLegs]))
      .toBe(both);

    // One record cannot vouch for the other's price: with only Kalshi
    // validated, the Polymarket figure is unattributable and the sentence goes.
    expect(stripUnvalidatedExternalMarketClaims(both, [kalshiLegs()])).not.toContain("57.0%");
    // Nor can the sentence pass by quoting one source correctly and the other
    // with a number that source never showed.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has the home win at 55.4% and Polymarket at 61.0%.",
      [kalshiLegs(), polymarketLegs]
    )).not.toContain("61.0%");
  });

  it("corrects a single slipped figure in place and keeps the sentence", () => {
    // A repair leaves no unvalidated price standing: the wrong figure is
    // replaced by the record's own, at the precision the model wrote.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.9% and away 20.8%, so the model is 11 points higher.",
      [kalshiLegs()]
    )).toBe("Kalshi has home 55.4%, draw 23.8% and away 20.8%, so the model is 11 points higher.");
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.8% and away 25.0%, a wider book than the model's.",
      [kalshiLegs()]
    )).toBe("Kalshi has home 55.4%, draw 23.8% and away 20.8%, a wider book than the model's.");
  });

  it("never emits a raw ISO timestamp when it does fall back to a recital", () => {
    const recited = stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 10.0%, draw 80.0% and away 10.0%.",
      [kalshiLegs()]
    );
    expect(recited).not.toContain(observedAt);
    expect(recited).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(recited).toContain("observed 19 August 2026 at 09:33 UTC");
    expect(recited).toContain("home 55.4%, draw 23.8%, away 20.8%");
  });

  it("still removes a price that cannot be attributed to a validated record", () => {
    // No record at all -- the long-standing default, unchanged.
    for (const priced of [
      "Kalshi has Arsenal at 62%, so the model is a touch higher.",
      "The bookmakers price the draw at 3.40 and the away win at 3.60.",
      "Kalshi market-implied home 48.0%, draw 28.0%, away 24.0%.",
    ]) {
      expect(stripUnvalidatedExternalMarketClaims(priced)).toContain("omitted those numbers");
    }

    // A record exists, but not for the source the sentence names. Kalshi's
    // record cannot vouch for a Polymarket price, and the guard does not
    // silently re-attribute one source's numbers to another's sentence.
    const otherSource = stripUnvalidatedExternalMarketClaims(
      "Polymarket prices the home win at 58.0%.",
      [kalshiLegs()]
    );
    expect(otherSource).not.toContain("58.0%");
    expect(otherSource).not.toContain("Kalshi");
    expect(otherSource).toContain("omitted those numbers");

    // Plausible, well-formed, correctly attributed -- and simply not a figure
    // the record contains. Nearness is not validation.
    for (const absent of [
      "Kalshi has Arsenal at 57.0%.",
      "Kalshi is at 55.9% on the home win.",
      // More than one leg out of step is a different book, not a slip.
      "Kalshi has home 55.4%, draw 30.0% and away 25.0%, a wider book than the model's.",
    ]) {
      const sanitized = stripUnvalidatedExternalMarketClaims(absent, [kalshiLegs()]);
      expect(sanitized).not.toBe(absent);
      expect(sanitized).toContain("Kalshi market-implied probabilities");
      expect(sanitized).toContain("home 55.4%, draw 23.8%, away 20.8%");
    }

    // Figures that contradict the record wholesale are replaced, not repaired:
    // rewriting every leg would be authoring the quote rather than checking it.
    const contradicting = stripUnvalidatedExternalMarketClaims(
      "Kalshi market: home 99%, draw 0.5%, away 0.5%.",
      [kalshiLegs()]
    );
    expect(contradicting).not.toContain("99%");
    expect(contradicting).toContain("home 55.4%, draw 23.8%, away 20.8%");

    // An incomplete record is no record: the hatch never opens on two legs.
    expect(stripUnvalidatedExternalMarketClaims(
      "Kalshi has home 55.4%, draw 23.8% and away 20.8%.",
      [kalshiLegs().slice(0, 2)]
    )).toContain("omitted those numbers");
  });
});

/**
 * The qualifier points rewrite fires on a points *return*, not on the word.
 *
 * A knockout tie pays no league points, so describing a draw as "one point" is
 * wrong on a qualifier and the rewrite is legitimate. It was written as an
 * unconditional `/\b(?:one|1) point\b/` though, which mangled every other use
 * of the word -- including "Celtic lead the group by one point", ordinary
 * standings prose that makes no claim about this tie at all and shipped as
 * "lead the group by a draw" on every qualifier fixture.
 *
 * The new prompt makes this worse rather than rarer: it asks for the edge in
 * points ("the model is one point higher"), which is a unit of measurement and
 * the exact phrase the old rewrite destroyed.
 */
describe("the qualifier points rewrite", () => {
  const qualifier = {
    kind: "match",
    competitionId: "uefa.champions_qual",
    home: "Celtic",
    away: "LASK",
    scorelines: [],
  } as unknown as Grounding;

  it("leaves a point used as a unit of measurement alone", () => {
    for (const prose of [
      "The model is one point higher on the draw than the market.",
      "Celtic lead the group by one point.",
      "The model is 1 point higher on the home win.",
      "The model is about 11 percentage points higher on the home win.",
      "A one point swing would not change the read.",
    ]) {
      expect(sanitizeMatchAnswer(prose, qualifier)).toBe(prose);
    }
  });

  /**
   * Firing is only half the job. Swapping the noun phrase "one point" for the
   * noun phrase "a draw" produced "A draw is worth a draw to Celtic." -- the
   * claim was correctly identified as false and the reader still got broken
   * English. Every rule here is asserted on its whole output sentence, not on
   * the presence or absence of a token, because a token assertion is exactly
   * what let the gibberish through.
   */
  it("rewrites a points return into prose that reads", () => {
    for (const [claimed, expected] of [
      // The reported defect.
      ["A draw is worth one point to Celtic.", "A draw is worth no league points to Celtic."],
      ["A 1-1 is worth one point.", "A 1-1 is worth no league points."],
      ["A draw is only worth one point.", "A draw is worth no league points."],
      // A noun phrase keeps its object, and a sentence-initial rewrite keeps
      // its capital -- the words carrying it are the ones removed.
      ["One point from the tie keeps LASK alive.", "A draw in the tie keeps LASK alive."],
      ["A share of the points would suit LASK.", "A draw would suit LASK."],
      // A verb is rewritten as a verb, in the tense it was written in.
      ["LASK would take one point from a 1-1.", "LASK would draw from a 1-1."],
      ["LASK could earn a point here.", "LASK could draw here."],
      ["Celtic will settle for one point.", "Celtic will draw."],
      ["Celtic settled for one point in the first leg.", "Celtic drew in the first leg."],
      ["Celtic share the points at 1-1.", "Celtic draw at 1-1."],
      ["Celtic shared the points in the first leg.", "Celtic drew in the first leg."],
      ["Celtic claimed three points in the first leg.", "Celtic won in the first leg."],
      ["Celtic are taking three points from this.", "Celtic are winning from this."],
      // No article to rewrite, so the idiom is kept and the points claim goes.
      ["Kuopio's share of the points came at 1-1.", "Kuopio's share of the spoils came at 1-1."],
      // The pre-existing rewrites still land, and still read.
      ["A 1-1 gives Celtic a share of the points.", "A 1-1 gives Celtic a draw."],
      ["Celtic take all three points with a 2-0.", "Celtic win with a 2-0."],
      ["Sabah's route to three points is a 1-0.", "Sabah's route to victory is a 1-0."],
    ]) {
      expect(sanitizeMatchAnswer(claimed, qualifier)).toBe(expected);
    }

    // No rewrite may leave a league-points claim behind it, and none may leave
    // the doubled noun phrase that prompted this fix.
    for (const claimed of [
      "A draw is worth one point to Celtic.",
      "One point from the tie keeps LASK alive.",
      "Celtic take all three points with a 2-0.",
      "A 1-1 gives Celtic a share of the points.",
    ]) {
      const rewritten = sanitizeMatchAnswer(claimed, qualifier);
      expect(rewritten).not.toMatch(/\bone point\b|\bthree points\b/i);
      expect(rewritten).not.toMatch(/\ba draw is worth a draw\b|\ba draw a draw\b/i);
    }
  });

  it("does not touch league prose outside a qualifier", () => {
    const league = { ...qualifier, competitionId: "eng.1" } as Grounding;
    const prose = "Arsenal would take one point from a 1-1 and lead by one point.";
    expect(sanitizeMatchAnswer(prose, league)).toBe(prose);
  });
});

/**
 * The match answer's job is to reason from the grounding, not to read it out.
 *
 * The live failure these tests stand for: an answer to Celtic vs LASK that
 * quoted the model at 66.9% and Kalshi at 55.4% in adjacent clauses, and never
 * said that they disagree by eleven and a half points -- the one fact on the
 * card that could have changed a decision.
 *
 * Two things have to hold for the fix to be real, and only one of them is a
 * prompt edit. The prompt has to ask for divergence, conditionality and honest
 * abstention; and the answer shape it asks for has to survive the guard chain,
 * which has a long history of deleting exactly the sentences a prompt just
 * asked for. The second half is what the sanitizer cases below check, using the
 * real Celtic vs LASK numbers.
 */
describe("match-tier analytical priorities", () => {
  const celticLask = (overrides: Partial<Grounding> = {}): Grounding => withDivergence({
    kind: "match",
    fixtureId: "espn:uefa.champions_qual:1",
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifying",
    homeFieldAdvantage: true,
    date: "2026-08-19T19:00:00Z",
    stage: "Playoff Round - First Leg",
    home: "Celtic",
    away: "LASK",
    pHome: 0.669,
    pDraw: 0.208,
    pAway: 0.124,
    pOver2_5: 0.579,
    pUnder2_5: 0.421,
    pBttsYes: 0.513,
    pBttsNo: 0.487,
    topScores: [
      { score: "2-0", probability: 0.116 },
      { score: "1-1", probability: 0.099 },
      { score: "1-0", probability: 0.098 },
    ],
    scorelines: [
      { score: "2-0", probability: 0.116 },
      { score: "1-1", probability: 0.099 },
      { score: "1-0", probability: 0.098 },
      { score: "1-2", probability: 0.038 },
      { score: "0-1", probability: 0.033 },
    ],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
    ...overrides,
  });

  it("asks for quantified divergence, honest agreement and a conditional read", () => {
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Reason from the numbers rather than reciting them");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Lead with model-versus-market disagreement");
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("via its fact slot");
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("never by typing a percentage or \"percentage points\" figure into the JSON text");
    // Agreement has to be reportable as a conclusion, or the prompt has just
    // taught the model to invent an edge on every efficiently priced fixture.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Agreement is a conclusion, not a hole to fill");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("no meaningful disagreement here");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Never manufacture an edge");
    // The verdict half. The band is named so the prompt and the deterministic
    // floor cannot contradict each other in front of the reader, and the
    // no-edge verdict is stated as a result worth giving rather than a
    // fallback -- "the moneyline is efficiently priced" is the answer more
    // often than an edge is.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Report the disagreement; do not recommend a bet");
    // Pundit prices no stake and sees no execution price, so it is not in a
    // position to tell anyone what to do with a probability difference.
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("Never phrase a gap as value, an edge, a play, or a side worth backing");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("inside the agreement band");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("the model and the market agree here");
    // The close names the evidence needed for reassessment without inventing an effect.
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("Close on what would change the read, and make it conditional");
    expect(MATCH_ANALYSIS_PRIORITIES)
      .toContain("what evidence would let me reassess");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Never say a missing player shrinks an edge");
    // The recital is replaced, not the numbers: no correctness regression.
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("Keep every grounded number you would have reported");
    expect(MATCH_ANALYSIS_PRIORITIES).toContain("by inserting its fact slot");
  });

  it("names the capabilities Pundit does not have so ambition cannot license invention", () => {
    for (const missing of [
      "no bookmaker odds",
      "no betting splits",
      "handle or money percentages",
      "no opening lines or line-movement history",
      "player-level data of any kind",
    ]) expect(MATCH_CAPABILITY_BOUNDS).toContain(missing);
    expect(MATCH_CAPABILITY_BOUNDS)
      .toContain("never quote a price in decimal, fractional or American form");
    expect(MATCH_CAPABILITY_BOUNDS).toContain("say Pundit cannot see it");
  });

  it("keeps market quoting and interpretation in separate sentences, as the guards require", () => {
    // Not a style rule. `stripUnvalidatedExternalMarketClaims` replaces any
    // sentence naming a market source with Pundit's own rendering of that
    // market, so reasoning written inside such a sentence is deleted along with
    // the quote. The prompt has to say so; the sanitizer cases below are why.
    expect(MATCH_CAPABILITY_BOUNDS).toContain("Quote market probabilities one source per sentence");
    expect(MATCH_CAPABILITY_BOUNDS)
      .toContain("put your interpretation of the gap in a separate sentence");
    expect(MATCH_CAPABILITY_BOUNDS).toContain("matching market fact slot");
    expect(MATCH_CAPABILITY_BOUNDS).toContain("Never type percentage-point digits");
  });

  it("delivers a divergence-led answer through the real guard chain intact", () => {
    const answer = [
      "**Model vs market**",
      "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%** for the"
      + " 19 August playoff first leg. Kalshi: home 55.4%, draw 23.8%, away 20.8%. The"
      + " disagreement is concentrated on the home win, where the model is about"
      + " **11 percentage points** higher than the priced probability; the draw is within three"
      + " points and LASK within eight, so the value such as it is sits on Celtic and nowhere else.",
      "",
      "**Goals**",
      "**Over 2.5 at 57.9%** and **both teams to score at 51.3%** point to an open game.",
      "",
      "**Likely scorelines**",
      "**2-0 (11.6%)**, **1-1 (9.9%)** and **1-0 (9.8%)** lead the table.",
      "",
      "**What would change this**",
      "No dated team-news source was found for either side, and the model's edge assumes a normal"
      + " Celtic XI. If the first-choice back line starts, the gap on the home win stands; if two"
      + " of them are missing, that gap is the first thing to shrink and the draw becomes the"
      + " better-priced outcome.",
    ].join("\n");
    // One instance, because the market observation timestamp is rendered into
    // the answer and a second `celticLask()` would move it.
    const grounding = celticLask();
    const delivered = sanitizeDeliveredAnswer(answer, "match", grounding);
    // The interpretation is the whole point of the rewrite, so it is the thing
    // asserted to survive -- alongside every number the old recital got right.
    expect(delivered).toContain("I am about **11 percentage points** higher");
    expect(delivered).not.toContain("the value such as it is sits on Celtic");
    expect(delivered).not.toContain("that gap is the first thing to shrink");
    for (const figure of ["66.9%", "20.8%", "12.4%", "57.9%", "51.3%", "11.6%", "9.9%", "9.8%"]) {
      expect(delivered).toContain(figure);
    }
    // Pundit re-renders the quoted market from its own record; the figures are
    // the grounding's own, so nothing is lost by that substitution.
    expect(delivered).toMatch(/Kalshi[^\n]*home 55\.4%, draw 23\.8%, away 20\.8%/);
    expect(delivered).toContain("**What would change this**");
    // Idempotent: the delivery chain runs more than once on a settled answer.
    expect(sanitizeDeliveredAnswer(delivered, "match", grounding)).toBe(delivered);
  });

  it("carries an agreement finding and an actionable abstention through the guards", () => {
    const agreed = celticLask({
      oddsSources: [{
        source: "kalshi",
        observedAt: new Date().toISOString(),
        pHome: 0.664,
        pDraw: 0.214,
        pAway: 0.122,
      }],
    });
    const answer = [
      "**Model vs market**",
      "Pundit's model makes **Celtic 66.9%**, the **draw 20.8%** and **LASK 12.4%** on 19 August."
      + " Kalshi: home 66.4%, draw 21.4%, away 12.2%. There is no meaningful disagreement here:"
      + " every outcome sits within a point of the priced probability, so the fixture looks"
      + " efficiently priced and there is no edge to take on the result.",
      "",
      "**What would change this**",
      "No dated team-news source was found. If a first-choice striker is ruled out before kickoff,"
      + " the under and the draw are where that shows up first; check a lineup report an hour"
      + " before kickoff.",
    ].join("\n");
    const delivered = sanitizeDeliveredAnswer(answer, "match", agreed);
    expect(delivered).toContain("There is no meaningful disagreement here");
    expect(delivered).toContain("there is no edge to take on the result");
    expect(delivered).toContain("check a lineup report an hour before kickoff");
    expect(delivered).not.toContain("omitted those numbers");
  });

  it("keeps the fused shape, and still deletes the market-favours shape", () => {
    // The fused shape USED to lose its reasoning, which is why the prompt has a
    // rule asking the model to split the quote from the interpretation. The
    // market guard now verifies a quote instead of replacing the line, so a
    // fused sentence whose figures reconcile survives whole -- the prompt rule
    // is belt-and-braces rather than load-bearing. Pinned here so a regression
    // in the guard shows up as the reasoning disappearing again.
    const fused = sanitizeDeliveredAnswer(
      "**Model vs market**\nKalshi has Celtic at 55.4%, some 11.5 points below Pundit's model at"
      + " 66.9%, which is the largest disagreement on the card.",
      "match",
      celticLask()
    );
    expect(fused).toContain("largest disagreement on the card");
    expect(fused).toContain("55.4%");

    const favours = sanitizeDeliveredAnswer(
      "**Model vs market**\nThe market gives LASK more of an edge than the model does.\n"
      + "The market prices LASK about 8 points higher than the model does.",
      "match",
      celticLask()
    );
    expect(favours).not.toContain("gives LASK more of an edge");
    expect(favours).toContain("The market prices LASK about 8 points higher than I do.");
  });
});

/**
 * The precomputed divergence and the sentence the delivery guarantee composes
 * from it.
 *
 * Both halves of this feature exist because MiniMax followed a prompt
 * instruction roughly half the time, and neither half can be checked against
 * MiniMax from here. What *can* be checked is that the arithmetic is right,
 * that the composed sentence survives the guard chain that has historically
 * deleted market prose, and that a model which already stated the gap is not
 * made to state it twice.
 */
describe("model-versus-market divergence", () => {
  // The live market cache is empty in tests, so the built grounding's own
  // divergence is empty; dropping it lets `withDivergence` recompute against
  // the sources this suite supplies.
  const { marketDivergence: _unpriced, ...celticBase } = buildGrounding(
    fixture("Celtic", "LASK", {
      competitionId: "uefa.champions_qual",
      competition: "UEFA Champions League Qualifying",
      pHome: 0.669,
      pDraw: 0.208,
      pAway: 0.124,
    })
  );

  /** The real Celtic vs LASK payload: model 66.9/20.8/12.4 against two books. */
  const celtic = withDivergence({
    ...celticBase,
    oddsSources: [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: 0.238, pAway: 0.208 },
      { source: "polymarket", observedAt: new Date().toISOString(), pHome: 0.565, pDraw: 0.235, pAway: 0.2 },
    ],
  });

  const kalshi = celtic.marketDivergence[0];

  it("differences every leg of every complete source", () => {
    expect(celtic.marketDivergence.map((entry) => entry.source))
      .toEqual(["kalshi", "polymarket"]);
    expect(kalshi.legs).toEqual([
      { outcome: "home", label: "Celtic", modelPercent: 66.9, marketPercent: 55.4, gapPoints: 11.5 },
      { outcome: "draw", label: "the draw", modelPercent: 20.8, marketPercent: 23.8, gapPoints: -3 },
      { outcome: "away", label: "LASK", modelPercent: 12.4, marketPercent: 20.8, gapPoints: -8.4 },
    ]);
    // The headline is the widest absolute gap, not the widest positive one.
    expect(kalshi.largest.outcome).toBe("home");
    expect(celtic.marketDivergence[1].largest)
      .toMatchObject({ outcome: "home", marketPercent: 56.5, gapPoints: 10.4 });
  });

  /**
   * The gap is the difference of the two percentages the sentence quotes, so a
   * reader can check it on the page. Differencing the raw probabilities gives
   * 11.4 here, which would read as an arithmetic error next to 66.9% and 55.4%.
   */
  it("differences the quoted percentages rather than the raw probabilities", () => {
    expect(kalshi.largest.gapPoints)
      .toBeCloseTo(kalshi.largest.modelPercent - kalshi.largest.marketPercent, 6);
    expect(kalshi.largest.gapPoints).toBe(11.5);
    // Unrounded inputs are where the two conventions part company: 0.66879 and
    // 0.55437 display as 66.9% and 55.4%, but their raw difference is 11.4.
    // Reporting that would put "66.9%", "55.4%" and "11.4 percentage points" in
    // one sentence and invite the reader to call it an error.
    const unrounded = computeMarketDivergence(
      { home: "Celtic", away: "LASK", pHome: 0.66879, pDraw: 0.208, pAway: 0.124 },
      [{ source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.55437, pDraw: 0.238, pAway: 0.208 }]
    )[0].legs[0];
    expect([unrounded.modelPercent, unrounded.marketPercent]).toEqual([66.9, 55.4]);
    expect((0.66879 - 0.55437) * 100).toBeCloseTo(11.44, 2);
    expect(unrounded.gapPoints).toBe(11.5);
  });

  it("produces nothing for an absent or incomplete market", () => {
    expect(computeMarketDivergence(celtic, [])).toEqual([]);
    expect(computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.554, pDraw: null, pAway: 0.208 },
    ])).toEqual([]);
    // A certainty is not a price, and the market guard would refuse to vouch
    // for one, so no divergence may be built from it either.
    expect(computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 1, pDraw: 0, pAway: 0 },
    ])).toEqual([]);
  });

  /**
   * The whole point of composing the sentence server-side is that the guard
   * chain cannot delete it. `stripUnvalidatedExternalMarketClaims` removes any
   * market claim it cannot reconcile against the validated record, and this
   * sentence is built from that record, so the chain must be a no-op on it --
   * on a `uefa.champions_qual` fixture, where the qualifier points rewrites
   * also run over the word "points".
   */
  it("composes a sentence the guard chain returns unchanged", () => {
    const answer = "**Model vs market**\nI make **Celtic 66.9%**, the"
      + " **draw 20.8%** and **LASK 12.4%**. "
      + composeMarketDivergenceSentence(kalshi, kalshi.largest);
    expect(answer).toContain(
      "Against Kalshi, which prices Celtic at 55.4%, my 66.9% estimate is"
      + " 11.5 percentage points higher"
    );
    expect(sanitizeDeliveredAnswer(answer, "match", celtic)).toBe(answer);
  });

  it("survives the chain for a draw and an away headline too", () => {
    for (const leg of kalshi.legs) {
      const answer = `**Model vs market**\n${composeMarketDivergenceSentence(kalshi, leg)}`;
      expect(sanitizeDeliveredAnswer(answer, "match", celtic)).toBe(answer);
      expect(answer).toContain(`${leg.marketPercent.toFixed(1)}%`);
    }
  });

  it("reports a level market as agreement rather than as an edge", () => {
    const level = computeMarketDivergence(celtic, [
      { source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.669, pDraw: 0.208, pAway: 0.123 },
    ])[0];
    const sentence = composeMarketDivergenceSentence(level, level.legs[0]);
    expect(sentence).toContain("land on the same number");
    expect(sentence).not.toContain("percentage points");
  });

  /**
   * Detection has to be robust to phrasing, or the guarantee prints the model's
   * own point twice. These are the same claim written four ways, and none of
   * them may be read as a missing divergence.
   */
  it("recognises a divergence however the model phrased it", () => {
    const stated = [
      "The model is 11.5 percentage points higher than Kalshi on the home win.",
      "About 11 points above the market on Celtic, which is where the edge sits.",
      "Pundit is 11.4 higher, in points, than the books here.",
      "That leaves the model 8.4 pts under the market on LASK.",
      "**Model vs market**\nKalshi has Celtic at 55.4%, some 11.5 points below"
        + " Pundit's model at 66.9%.",
    ];
    for (const answer of stated) {
      expect(statesMarketDivergence(answer, celtic.marketDivergence)).toBe(true);
    }
  });

  it("does not mistake other prose for a stated divergence", () => {
    const silent = [
      "Pundit's model makes Celtic 66.9%, the draw 20.8% and LASK 12.4%.",
      // A points figure with nothing to do with the market comparison.
      "Celtic lead the group by one point.",
      // The market named, but no gap given -- the exact half-compliance shape
      // this feature exists to catch.
      "Kalshi prices Celtic at 55.4%, so the market is a little tighter.",
      // A gap in points that matches no leg of this payload.
      "The model is 30 percentage points clear of the market on the draw.",
    ];
    for (const answer of silent) {
      expect(statesMarketDivergence(answer, celtic.marketDivergence)).toBe(false);
    }
    // And with no market at all there is nothing to have stated.
    expect(statesMarketDivergence(
      "The model is 11.5 percentage points higher than the market.",
      []
    )).toBe(false);
  });
});

/**
 * Answers and search share OPENROUTER_API_KEY. MiniMax is only the answer
 * fallback when that key is absent, and it does not serve search.
 */
describe("inference credential configuration", () => {
  const envKeys = [
    "MINIMAX_API_KEY",
    "MINIMAX_BASE_URL",
    "MINIMAX_MODEL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_BASE_URL",
  ] as const;

  function withEnv(values: Partial<Record<(typeof envKeys)[number], string>>, run: () => void) {
    const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    Object.assign(process.env, values);
    try {
      run();
    } finally {
      for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key] as string;
      }
      resetInferenceStatus();
    }
  }

  it("pins answers to one OpenRouter model and leaves the auto-router unused", () => {
    withEnv(
      {
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_MODEL: "openrouter/auto",
        MINIMAX_API_KEY: "shared-subscription-key",
      },
      () => {
        const client = prepareAsk("Who wins the Premier League?", []).client as unknown as
          { apiKey: string; baseURL: string };
        expect(client.apiKey).toBe("openrouter-key");
        expect(client.baseURL).toBe("https://openrouter.ai/api");
        expect(getInferenceStatus()).toMatchObject({
          configured: true,
          dedicatedKey: false,
          keySource: "OPENROUTER_API_KEY",
          model: "deepseek/deepseek-v4-flash",
          endpointHost: "openrouter.ai",
        });
      }
    );
  });

  it("keeps every existing deployment working on MINIMAX_API_KEY alone", () => {
    withEnv({ MINIMAX_API_KEY: "shared-subscription-key" }, () => {
      const client = prepareAsk("Who wins the Premier League?", []).client as unknown as
        { apiKey: string };
      expect(client.apiKey).toBe("shared-subscription-key");
      expect(getInferenceStatus()).toMatchObject({
        configured: true,
        // Visible on /ready precisely so this configuration is not silent.
        dedicatedKey: false,
        keySource: "MINIMAX_API_KEY",
      });
    });
  });

  it("honours a region-scoped MiniMax host when OpenRouter is unset", () => {
    withEnv(
      {
        MINIMAX_API_KEY: "shared-subscription-key",
        MINIMAX_BASE_URL: "https://api.minimaxi.com/anthropic",
      },
      () => {
        const client = prepareAsk("Who wins the Premier League?", []).client as unknown as
          { baseURL: string };
        expect(client.baseURL).toBe("https://api.minimaxi.com/anthropic");
        expect(getInferenceStatus().endpointHost).toBe("api.minimaxi.com");
      }
    );
  });

  it("fails closed at the first model call when no inference credential is configured", () => {
    withEnv({}, () => {
      // Preparation succeeds so deterministic answers still render; the
      // client refuses as soon as anything tries to call the model.
      const prepared = prepareAsk("Who wins the Premier League?", []);
      expect(() => prepared.client.messages).toThrow(AppError);
      expect(getInferenceStatus()).toMatchObject({ configured: false, keySource: "unset" });
    });
  });

  it("reports a keyless model turn as unavailable without counting a vendor failure", async () => {
    const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    for (const key of envKeys) delete process.env[key];
    resetInferenceStatus();
    searchWeb.mockReset();
    searchWeb.mockResolvedValue([]);
    try {
      await expect(answerQuestion("Explain what xG is in football"))
        .rejects.toMatchObject({ statusCode: 502, message: "Analysis service is temporarily unavailable." });
      expect(getInferenceStatus()).toMatchObject({ configured: false, failures: 0, consecutiveFailures: 0 });
    } finally {
      for (const key of envKeys) {
        if (saved[key] !== undefined) process.env[key] = saved[key] as string;
      }
      resetInferenceStatus();
    }
  }, 20_000);

  it("never reports the key itself in inference status", () => {
    withEnv({ OPENROUTER_API_KEY: "openrouter-key-must-not-appear" }, () => {
      expect(JSON.stringify(getInferenceStatus())).not.toContain("openrouter-key-must-not-appear");
    });
  });

  it("counts a genuine vendor throttle as an inference failure", async () => {
    resetInferenceStatus();
    const throttle = Object.assign(new Error("rate limited"), { status: 429 });
    Object.setPrototypeOf(throttle, Anthropic.APIError.prototype);
    await expect(trackedInference(() => Promise.reject(throttle))).rejects.toBe(throttle);
    expect(getInferenceStatus()).toMatchObject({
      failures: 1,
      consecutiveFailures: 1,
      lastFailureStatus: 429,
    });
    expect(getInferenceStatus().lastThrottledAt).not.toBeNull();
    resetInferenceStatus();
  });

  it("does not blame inference for a reader who cancelled the request", async () => {
    // /ready's inference block is how an operator answers "is the inference
    // quota healthy?". Readers close tabs constantly, so counting an abort as
    // a failure left that block permanently accusing a vendor that was fine.
    resetInferenceStatus();
    const aborted = new AbortController();
    aborted.abort();
    const cancellation = Object.assign(new Error("Request was aborted."), { name: "AbortError" });
    await expect(
      trackedInference(() => Promise.reject(cancellation), aborted.signal)
    ).rejects.toBe(cancellation);
    expect(getInferenceStatus()).toMatchObject({
      failures: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastFailureStatus: null,
    });
    resetInferenceStatus();
  });

  it("recognises a cancellation from the error alone when no signal is passed", async () => {
    resetInferenceStatus();
    const cancellation = Object.assign(new Error("Request was aborted."), { name: "AbortError" });
    await expect(trackedInference(() => Promise.reject(cancellation))).rejects.toBe(cancellation);
    expect(getInferenceStatus()).toMatchObject({ failures: 0, consecutiveFailures: 0 });
    resetInferenceStatus();
  });

  it("does not record a cancelled attempt as a success either", async () => {
    // Nothing was learned about the vendor, so the attempt belongs in neither
    // column: an abort counted as a success would mask a real outage.
    resetInferenceStatus();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      trackedInference(() => Promise.reject(new Error("aborted")), aborted.signal)
    ).rejects.toThrow();
    expect(getInferenceStatus()).toMatchObject({ totalCalls: 0, failures: 0 });
    resetInferenceStatus();
  });
});

describe("deterministic fixture clarification", () => {
  it("preserves compact presentation for a desk totals follow-up", async () => {
    await refreshClubRatings(new Date());
    const kickoff = new Date(Date.now() + 86_400_000).toISOString();
    const model = fixture("Arsenal", "Chelsea", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    try {
      const result = await answerQuestion("What about over 2.5?", [
        { role: "user", content: "Arsenal vs Chelsea" },
        { role: "assistant", content: "I have Arsenal vs Chelsea in view." },
      ], undefined, undefined, { fixtureId: espnFixtureIdentity(model) }, undefined, "desk");
      expect(result.grounding?.kind).toBe("match");
      expect(result.presentation).toEqual({ responseMode: "totals", fixtureCard: "compact" });
      expect(result.answer).toMatch(/over 2\.5.*55\.0%/i);
      expect(result.answer).not.toMatch(/My 1X2/);
    } finally {
      cached.mockRestore();
    }
  });

  it("settles identity-free ambiguity in first person without internal terminology", () => {
    const answer = deterministicUngroundedClarification("Which side should I trust more here?", null);
    expect(answer).toMatch(/^I need/);
    expect(answer).not.toMatch(/JSON|grounding|payload|retrieval|model plumbing/i);
  });
  it("acknowledges a third club without answering for the pinned match", () => {
    const grounding = buildGrounding(fixture("Arsenal", "Chelsea"));
    const answer = deterministicUngroundedClarification("Who scores for Everton?", grounding);
    expect(answer).toContain("Everton’s opponent");
    expect(answer).toContain(`${grounding.home} vs ${grounding.away}`);
    expect(answer).toContain("player-level projections");
    expect(answer).not.toMatch(/JSON|grounding|payload|retrieval/i);
  });
});

it.each(["What about Liverpool?", "Liverpool odds?"])("retains the explicit fixture for an unresolved switch: %s", (question) => {
  const model = fixture("Arsenal", "Chelsea");
  const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model, fixture("Liverpool", "Everton")], lastUpdated: null, error: null });
  try {
    expect(resolveAskContext(question, [], undefined, [model], [], [], { fixtureContext: { fixtureId: espnFixtureIdentity(model) } })).toMatchObject({ tier: "match", fixture: model });
    expect(deterministicUngroundedClarification(question, buildGrounding(model))).toContain("opponent before I can switch fixtures");
  } finally { cached.mockRestore(); }
});

it("keeps scorer evidence follow-ups concise and distinct from projections", () => {
  const answer = deterministicUngroundedEvidenceFollowUp("What evidence would change that answer?", [{ role: "user", content: "Who scores for Liverpool?" }], buildGrounding(fixture("Arsenal", "Chelsea")));
  expect(answer).toContain("confirmed starters, expected minutes and a dated scorer market");
  expect(answer).toContain("Recent goals alone cannot establish");
  expect(answer!.length).toBeLessThan(300);
});

it.each(["What about Injuries?", "What about The weather?", "What about Pressing?"])("does not mistake a conceptual follow-up for a club: %s", (question) => {
  expect(deterministicUngroundedClarification(question, buildGrounding(fixture("Arsenal", "Chelsea")))).toBeNull();
});

describe("todayPreamble", () => {
  it("names the 2026-27 season from August 2026, not the season before it", () => {
    const text = todayPreamble(new Date("2026-09-29T12:00:00Z"));
    expect(text).toContain("Today's date is 2026-09-29");
    expect(text).toContain("2026-27");
    expect(text).not.toContain("2025-26");
  });

  it("keeps the previous season until July ends, and rolls over on 1 August", () => {
    expect(todayPreamble(new Date("2026-03-01T00:00:00Z"))).toContain("2025-26");
    expect(todayPreamble(new Date("2026-07-31T23:59:00Z"))).toContain("2025-26");
    expect(todayPreamble(new Date("2026-08-01T00:00:00Z"))).toContain("2026-27");
    expect(todayPreamble(new Date("2027-01-15T00:00:00Z"))).toContain("2026-27");
  });
});

describe("evidence attached to a match turn", () => {
  it("goes in front of the JSON reminder, which stays last", () => {
    const bundle = {
      queries: ["q"], results: [{ id: "S1", title: "T", url: "https://www.bbc.co.uk/x", date: "2026-09-28", snippet: "s", tier: "news" }],
    } as unknown as Parameters<typeof attachEvidence>[1];
    const [turn] = attachEvidence([{ role: "user", content: `User question: hi\n${MATCH_JSON_REMINDER}` }], bundle);
    expect(turn.content.endsWith(MATCH_JSON_REMINDER)).toBe(true);
    expect(turn.content.indexOf("S1")).toBeLessThan(turn.content.lastIndexOf(MATCH_JSON_REMINDER));
  });
});

describe("settled player news requires exact current-claim verification", () => {
  it("hydrates a late real publisher report ahead of nine official fixture hits and preserves its S10 citation in JSON, desk and SSE", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T02:00:00Z"));
    await refreshClubRatings(new Date());
    const model = fixture("Arsenal", "Leeds", { utcDate: "2026-10-10T11:30:00Z", date: "2026-10-10" });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = "test-only";
    const savedReasoning = process.env.PUNDIT_REASONING; delete process.env.PUNDIT_REASONING;
    // Actual publication metadata and 20 source words captured from this real URL.
    const html = readFileSync(join(__dirname, "__fixtures__/yahoo-arsenal-injury-2026-10-05.html"), "utf8");
    const source = { title: "Arsenal injury bulletin (dated club report)",
      link: "https://uk.sports.yahoo.com/news/arsenal-injury-christos-tzolis-kai-050000771.html", date: "", snippet: "It has been a costly international break for the Gunners so far" };
    const official = Array.from({ length: 9 }, (_, index) => ({ title: "Arsenal vs Leeds confirmed lineup",
      link: `https://www.premierleague.com/lineups/${index}`, date: "", snippet: "Upcoming fixture lineups." }));
    const prefetch = vi.spyOn(evidencePages, "prefetchEvidencePages").mockImplementation((candidates) => {
      expect(candidates).toHaveLength(8); expect(candidates[0]).toMatchObject({ id: "S10", url: source.link });
    });
    const realRetrieve = evidencePages.retrieveEvidencePages;
    const fetch = vi.fn(async (url: string | URL) => new Response(String(url) === source.link
      ? html.replace("<body>", `<body><nav>${"Sports navigation. ".repeat(300)}</nav>`)
        .replace("</body>", "<p>Earlier fixtures: Arsenal vs Everton: archive.</p></body>")
      : "<html><body>Upcoming fixture lineups.</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    const retrieve = vi.spyOn(evidencePages, "retrieveEvidencePages").mockImplementation((candidates, signal, options) => {
      expect(candidates.length).toBeLessThanOrEqual(8);
      return realRetrieve(candidates, signal, { ...options, fetch,
        resolveHost: async () => [{ address: "93.184.216.34", family: 4 }], now: () => new Date() });
    });
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
      const input = params as Anthropic.MessageCreateParamsNonStreaming;
      if (String(input.system) === DESK_DATED_CLUB_NEWS_SYSTEM) {
        // A provider can consume a small budget with reasoning and return no
        // visible text. Mimic that failure unless reasoning is controlled.
        if (input.thinking?.type !== "disabled") return Promise.resolve({ content: [{ type: "thinking", thinking: "", signature: "" }],
          stop_reason: "max_tokens" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
        expect(input.max_tokens).toBe(1_024);
        const evidence = String(input.messages.at(-1)?.content);
        expect(evidence).toContain("[[S10]] 2026-10-05T09:42:23Z"); expect(evidence).toContain("Kai Havertz");
        expect(evidence).toContain("hamstring"); expect(evidence).toContain("source passage omitted");
        expect(evidence).toContain("Earlier fixtures: Arsenal vs Everton");
        return Promise.resolve({ content: [{ type: "text", text: "On 2026-10-05, Arsenal's Kai Havertz was reported sidelined with a hamstring problem [[S10]]." }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      }
      expect(String(input.system)).toMatch(/^You are Pundit's bounded factual claim verifier\./);
      const data = JSON.parse(String(input.messages[0].content).split("Verify these claims against these pages: ")[1]);
      expect(data.claims).toHaveLength(1); expect(data.claims[0].text).toContain("[[S10]]");
      expect(data.pages.find((page: { id: string }) => page.id === "S10")).toMatchObject({ publishedDate: "2026-10-05T09:42:23Z", url: source.link });
      return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ decisions: [{ claimId: data.claims[0].id,
        outcome: "supported", evidenceIds: ["S10"] }], summary: "Exact dated claim supported." }) }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
    });
    searchWeb.mockReset(); searchWeb.mockResolvedValue([...official, source]);
    const question = "What are the latest dated club injury updates for Arsenal and Leeds? Keep current reports distinct from future kickoff availability.";
    try {
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, { fixtureId: espnFixtureIdentity(model) }, undefined, voice);
        expect(result.verification).toEqual({ status: "verified", supportedClaimCount: 1, removedClaimCount: 0 });
        expect(result.citations).toMatchObject([{ id: "S10", url: source.link, date: "2026-10-05T09:42:23Z" }]);
        expect(result.answer).toContain("Kai Havertz"); expect(result.answer).toContain("do not establish the starting XI");
        expect(result.answer).toContain("couldn’t establish a verified, dated Leeds club update");
      }
      const deltas: string[] = [];
      const result = await answerQuestionStream(question, [], ["Arsenal", "Leeds"], { onGrounding: () => {}, onDelta: (s) => deltas.push(s) }, { fixtureId: espnFixtureIdentity(model) });
      expect(result.verification.supportedClaimCount).toBe(1); expect(result.citations?.[0].id).toBe("S10");
      expect(deltas).toEqual([result.answer]); expect(create).toHaveBeenCalledTimes(6);
      expect(fetch.mock.calls.filter(([url]) => String(url) === source.link)).toHaveLength(3);
    } finally {
      create.mockRestore(); retrieve.mockRestore(); prefetch.mockRestore(); cached.mockRestore(); vi.useRealTimers();
      if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
      if (savedReasoning === undefined) delete process.env.PUNDIT_REASONING; else process.env.PUNDIT_REASONING = savedReasoning;
    }
  });
  it.each(["supported", "unsupported", "conflict", "thinking-only", "truncated", "provider-error"] as const)("handles dated club-report prose only after exact claim verification: %s", async (outcome) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    await refreshClubRatings(new Date());
    const model = fixture("Arsenal", "Leeds", { utcDate: "2026-10-10T11:30:00Z", date: "2026-10-10" });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY; process.env.MINIMAX_API_KEY = "test-only";
    const source = { title: "Arsenal injury update: Kai Havertz latest news", link: "https://www.arsenal.com/news/latest-injury-update", date: "2026-10-05",
      snippet: "Arsenal are dealing with injury concerns. Kai Havertz sustained a hamstring issue on international duty and will undergo further assessment." };
    const prefetch = vi.spyOn(evidencePages, "prefetchEvidencePages").mockImplementation(() => {});
    const retrieve = vi.spyOn(evidencePages, "retrieveEvidencePages").mockImplementation(async (candidates) => candidates.map((candidate) => ({ ...candidate,
      finalUrl: candidate.url, text: source.snippet, retrievedAt: new Date().toISOString() })));
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
      const input = params as Anthropic.MessageCreateParamsNonStreaming;
      if (String(input.system) === DESK_DATED_CLUB_NEWS_SYSTEM) {
        expect(String(input.messages.at(-1)?.content)).toContain(source.snippet);
        if (outcome === "provider-error") throw new Error("private provider response must not be logged");
        if (outcome === "thinking-only") return Promise.resolve({ content: [{ type: "thinking", thinking: "private reasoning", signature: "" }],
          stop_reason: "max_tokens" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
        if (outcome === "truncated") return Promise.resolve({ content: [{ type: "text", text: "On 2026-10-05, Arsenal's Kai Havertz had a hamstring issue [[S1]]." }],
          stop_reason: "max_tokens" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
        return Promise.resolve({ content: [{ type: "text", text: "On 2026-10-05, Arsenal's Kai Havertz was reported to have a hamstring issue pending assessment [[S1]]. Leeds will definitely win." }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      }
      expect(String(input.system)).toMatch(/^You are Pundit's bounded factual claim verifier\./);
      const data = JSON.parse(String(input.messages[0].content).split("Verify these claims against these pages: ")[1]);
      expect(data.claims).toHaveLength(1); expect(data.claims[0].text).toContain("Kai Havertz");
      expect(data.claims[0].text).not.toContain("definitely");
      return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ decisions: data.claims.map((claim: { id: string }) => ({ claimId: claim.id, outcome, evidenceIds: ["S1"] })), summary: "Exact claim assessed." }) }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
    });
    searchWeb.mockReset(); searchWeb.mockResolvedValue([source]);
    try {
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion("What is the latest team news?", [], ["Arsenal", "Leeds"], undefined, { fixtureId: espnFixtureIdentity(model) }, undefined, voice);
        expect(result.grounding?.kind).toBe("match");
        expect(result.answer).not.toContain("definitely");
        if (outcome === "supported") {
          expect(result.answer).toContain("Kai Havertz"); expect(result.answer).toContain(source.link);
          expect(result.answer).toContain("do not establish the starting XI");
          expect(result.verification).toEqual({ status: "verified", supportedClaimCount: 1, removedClaimCount: 0 });
        } else {
          expect(result.answer).not.toContain("Kai Havertz"); expect(result.citations ?? []).toEqual([]);
          expect(result.verification.supportedClaimCount).toBe(0);
        }
      }
      const deltas: string[] = [];
      const result = await answerQuestionStream("What is the latest team news?", [], ["Arsenal", "Leeds"], { onGrounding: () => {}, onDelta: (s) => deltas.push(s) }, { fixtureId: espnFixtureIdentity(model) });
      expect(deltas).toEqual([result.answer]); expect(deltas.join("")).not.toContain("definitely");
      if (outcome !== "supported") expect(deltas.join("")).not.toContain("Kai Havertz");
      expect(create).toHaveBeenCalledTimes(["thinking-only", "truncated", "provider-error"].includes(outcome) ? 3 : 6);
    } finally {
      create.mockRestore(); retrieve.mockRestore(); prefetch.mockRestore(); cached.mockRestore(); vi.useRealTimers();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY; else process.env.MINIMAX_API_KEY = saved;
    }
  });
  it.each([
    { label: "actual Back identity fragment", snippet: "Back (Arsenal) is unavailable.", outcome: "supported", accepted: false, extracted: false },
    { label: "different-player heading proximity", snippet: "Saka (Arsenal) trained. Return dates for Kai Havertz are beside an unavailable-player heading.", outcome: "supported", accepted: false, extracted: false },
    { label: "hypothetical absence", snippet: "If Bukayo Saka (Arsenal) is ruled out, another player could deputise.", outcome: "supported", accepted: false, extracted: false },
    { label: "negated absence", snippet: "Saka (Arsenal) is not ruled out.", outcome: "supported", accepted: false, extracted: false },
    { label: "doubtful does not establish unavailable", snippet: "Kai Havertz (Arsenal) is doubtful for Arsenal vs Leeds.", outcome: "supported", accepted: true, extracted: true, exactStatus: "doubtful" },
    { label: "injury does not establish absence", snippet: "Kai Havertz (Arsenal) is injured but remains available for Arsenal.", outcome: "supported", accepted: true, extracted: true, exactStatus: "injured" },
    { label: "suspension is preserved", snippet: "Kai Havertz (Arsenal) is suspended.", outcome: "supported", accepted: true, extracted: true, exactStatus: "suspended" },
    { label: "verified full-name availability", snippet: "Kai Havertz (Arsenal) is ruled out.", outcome: "supported", accepted: true, extracted: true },
    { label: "verified Unicode identity", snippet: "Martin Ødegaard (Arsenal) is ruled out.", outcome: "supported", accepted: true, extracted: true, named: "Martin Ødegaard" },
    { label: "verified surname lineup", snippet: "Saka (Arsenal) is confirmed to start.", outcome: "supported", accepted: true, extracted: true },
    { label: "unsupported named absence", snippet: "Kai Havertz (Arsenal) is ruled out.", outcome: "unsupported", accepted: false, extracted: true },
    { label: "conflicting named absence", snippet: "Kai Havertz (Arsenal) is ruled out.", outcome: "conflict", accepted: false, extracted: true },
    { label: "unavailable verifier", snippet: "Kai Havertz (Arsenal) is ruled out.", outcome: "unavailable", accepted: false, extracted: true },
    { label: "undated named absence", snippet: "Kai Havertz (Arsenal) is ruled out.", outcome: "supported", accepted: false, extracted: false, undated: true },
    { label: "verified scorer quote and lineup", snippet: "Saka anytime 2.10 for Arsenal; Saka expected to start for Arsenal.", outcome: "supported", accepted: true, extracted: true, scorer: true },
    { label: "unsupported scorer quote and lineup", snippet: "Saka anytime 2.10 for Arsenal; Saka expected to start for Arsenal.", outcome: "unsupported", accepted: false, extracted: true, scorer: true },
  ])("does not grant verification from citation count: $label", async ({ snippet, outcome, accepted, extracted, undated, scorer, exactStatus, named }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    await refreshClubRatings(new Date());
    const kickoff = "2026-10-06T15:00:00Z";
    const model = fixture("Arsenal", "Leeds", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const cached = vi.spyOn(modelData, "getCachedModelData").mockReturnValue({ fixtures: [model], lastUpdated: new Date(), error: null });
    const saved = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    const source = { title: "Arsenal vs Leeds team news", link: "https://www.arsenal.com/news/dated-team-news",
      snippet: `Arsenal vs Leeds. ${snippet}`, date: undated ? "" : "2026-10-04" };
    const prefetch = vi.spyOn(evidencePages, "prefetchEvidencePages").mockImplementation(() => {});
    const retrieve = vi.spyOn(evidencePages, "retrieveEvidencePages").mockImplementation(async (candidates) => candidates.map((candidate) => ({
      ...candidate, finalUrl: candidate.url, text: source.snippet, retrievedAt: new Date().toISOString(),
    })));
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
      const input = params as Anthropic.MessageCreateParamsNonStreaming;
      expect(String(input.system)).toMatch(/^You are Pundit's bounded factual claim verifier\./);
      if (outcome === "unavailable") return Promise.reject(new Error("Provider unavailable")) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      const data = JSON.parse(String(input.messages[0].content).split("Verify these claims against these pages: ")[1]);
      expect(data.claims.length).toBeGreaterThan(0);
      expect(data.claims.every((claim: { text: string }) => named ? claim.text.includes(named) : /Saka|Kai Havertz/.test(claim.text))).toBe(true);
      return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ decisions: data.claims.map((claim: { id: string }) => ({
        claimId: claim.id, outcome, evidenceIds: ["S1"],
      })), summary: "Exact claim assessed." }) }], stop_reason: "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
    });
    searchWeb.mockReset(); searchWeb.mockResolvedValue([source]);
    const question = scorer ? "Who is most likely to score for Arsenal?" : "Any injury or lineup news for Arsenal vs Leeds?";
    try {
      const context = { fixtureId: espnFixtureIdentity(model) };
      for (const voice of [undefined, "desk"] as const) {
        const result = await answerQuestion(question, [], ["Arsenal", "Leeds"], undefined, context, undefined, voice);
        expect(result.grounding?.kind).toBe("match");
        if (accepted) {
          if (named) expect(result.answer).toContain(named);
          else expect(result.answer).toMatch(/Kai Havertz|Saka/);
          expect(result.answer).toContain(source.link);
          expect(result.verification?.status).toBe("verified");
          expect(result.verification?.supportedClaimCount).toBeGreaterThan(0);
          expect(result.citations?.[0]?.date).toMatch(/2026-10-04/);
          if (exactStatus) {
            expect(result.answer).toContain(`listed as ${exactStatus}`);
            expect(result.answer).not.toContain("listed as unavailable");
          }
        } else {
          expect(result.answer).not.toMatch(/Kai Havertz|Saka|Back \(Arsenal\)|2\.10/);
          expect(result.answer).toMatch(/verified|verify/i);
          expect(result.citations ?? []).toEqual([]);
          expect(result.verification?.supportedClaimCount).toBe(0);
          expect(result.verification?.status).toBe(outcome === "conflict" ? "conflict" : outcome === "unavailable" ? "unavailable" : "abstain");
        }
        expect(result.answer).not.toMatch(/My 1X2|\[\[S1\]\]/);
      }
      const deltas: string[] = [];
      const streamed = await answerQuestionStream(question, [], ["Arsenal", "Leeds"], {
        onGrounding: () => {}, onDelta: (text) => deltas.push(text),
      }, context);
      expect(deltas).toEqual([streamed.answer]);
      expect(streamed.verification?.supportedClaimCount ?? 0).toBe(accepted ? scorer ? 2 : 1 : 0);
      if (named) expect(streamed.answer).toContain(named);
      if (exactStatus) {
        expect(streamed.answer).toContain(`listed as ${exactStatus}`);
        expect(streamed.answer).not.toContain("listed as unavailable");
      }
      if (!accepted) {
        expect(deltas.join("")).not.toMatch(/Kai Havertz|Saka|Back \(Arsenal\)|2\.10/);
        expect(streamed.citations ?? []).toEqual([]);
      }
      expect(create).toHaveBeenCalledTimes(extracted ? 3 : 0);
      expect(retrieve.mock.calls.every((call) => Boolean(call[2]?.cache))).toBe(true);
    } finally {
      create.mockRestore(); retrieve.mockRestore(); prefetch.mockRestore(); cached.mockRestore();
      vi.useRealTimers();
      if (saved === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = saved;
    }
  });

  it("does not append an unchecked parsed availability wrinkle after prose verification", async () => {
    const grounding = buildGrounding(fixture("Arsenal", "Leeds"));
    const result = await deliverAnswer({ answer: "If Arsenal press high, Leeds could attack the space behind.",
      question: "Tactical matchup", tier: "match", grounding, voice: "desk", evidenceRequired: true,
      candidateUnrecognized: false, client: {} as never,
      bundle: { queries: ["team news"], providerCalls: 0, results: [{ id: "S1", tier: "official", title: "Arsenal vs Leeds team news",
        url: "https://www.arsenal.com/news/team-news", date: "2026-08-01", snippet: "Arsenal vs Leeds. Kai Havertz (Arsenal) is ruled out." }] } });
    expect(result.answer).not.toContain("Kai Havertz");
    expect(result.citations).toEqual([]);
    expect(result.verification.supportedClaimCount).toBe(0);
  });
});
