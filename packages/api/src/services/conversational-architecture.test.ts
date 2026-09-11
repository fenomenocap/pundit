import { describe, expect, it } from "vitest";
import { closedGroundedAnswer, deliverAnswer, deterministicSearchQuery, planEvidenceQueries, type Grounding } from "./ask";
import { validateAnalystDraft, salvageCitedClaimProse } from "./analyst-draft";
import { stripUnresolvedResponseMarkers } from "./answer-provenance";
import { PLAYER_SCORER_ABSTENTION, TEAM_NEWS_COMPOSE_ABSTENTION } from "./player-evidence";
import { composeMatchResponse, SHARED_TOTAL_XG_SENTENCE, STAKE_REFUSAL_SENTENCE } from "./response-composer";
import { buildResponseFacts } from "./response-facts";
import { asksStakeSizeQuestion, isSettledMatchMode, planResponse, questionAcceptsUserLine, resolveRequestedScoreline, responsePresentation } from "./response-plan";
import { attachUserLine, buildMatchPricing, stripUntraceableMatchPercentages } from "./response-correctness";

function matchGrounding(input: {
  fixtureId: string;
  home: string;
  away: string;
  date: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: Grounding["topScores"];
  oddsSources: Grounding["oddsSources"];
}): Grounding {
  return {
    kind: "match",
    fixtureId: input.fixtureId,
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: input.date,
    stage: "Regular Season",
    home: input.home,
    away: input.away,
    pHome: input.pHome,
    pDraw: input.pDraw,
    pAway: input.pAway,
    pOver2_5: input.pOver2_5,
    pUnder2_5: input.pUnder2_5,
    pBttsYes: input.pBttsYes,
    pBttsNo: input.pBttsNo,
    topScores: input.topScores,
    scorelines: input.topScores,
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: input.oddsSources,
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: input.fixtureId,
      home: input.home,
      away: input.away,
      kickoff: input.date,
      pricedAt: "2026-09-09T10:00:00Z",
      pHome: input.pHome,
      pDraw: input.pDraw,
      pAway: input.pAway,
      markets: input.oddsSources.map((source) => ({
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

const grounding = (): Grounding => {
  const pHome = 0.563;
  const pDraw = 0.234;
  const pAway = 0.203;
  const oddsSources: Grounding["oddsSources"] = [{
    source: "kalshi", observedAt: "2026-09-12T08:00:00Z",
    pHome: 0.501, pDraw: 0.296, pAway: 0.203,
  }];
  return {
    kind: "match",
    fixtureId: "eng.1:1",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-12T14:00:00Z",
    stage: "Regular Season",
    home: "Arsenal",
    away: "Chelsea",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.589,
    pUnder2_5: 0.411,
    pBttsYes: 0.574,
    pBttsNo: 0.426,
    topScores: [{ score: "2-1", probability: 0.114 }, { score: "1-1", probability: 0.102 }],
    scorelines: [
      { score: "2-1", probability: 0.114 },
      { score: "1-1", probability: 0.102 },
      { score: "0-2", probability: 0.071 },
    ],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "kalshi", observedAt: "2026-09-12T08:00:00Z",
      legs: [
        { outcome: "home", label: "Arsenal", modelPercent: 56.3, marketPercent: 50.1, gapPoints: 6.2 },
        { outcome: "draw", label: "the draw", modelPercent: 23.4, marketPercent: 29.6, gapPoints: -6.2 },
        { outcome: "away", label: "Chelsea", modelPercent: 20.3, marketPercent: 20.3, gapPoints: 0 },
      ],
      largest: { outcome: "home", label: "Arsenal", modelPercent: 56.3, marketPercent: 50.1, gapPoints: 6.2 },
    }],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:1",
      home: "Arsenal",
      away: "Chelsea",
      kickoff: "2026-09-12T14:00:00Z",
      pricedAt: "2026-09-12T08:00:00Z",
      pHome,
      pDraw,
      pAway,
      markets: oddsSources.map((source) => ({
        source: source.source,
        observedAt: source.observedAt,
        pHome: source.pHome,
        pDraw: source.pDraw,
        pAway: source.pAway,
        decimalOdds: null,
      })),
    }),
  };
};

function liverpoolGrounding(): Grounding {
  return matchGrounding({
    fixtureId: "espn:eng.1:401879279",
    home: "Liverpool",
    away: "Fulham",
    date: "2026-09-12T14:00:00Z",
    pHome: 0.66,
    pDraw: 0.223,
    pAway: 0.117,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.45,
    pBttsNo: 0.55,
    topScores: [
      { score: "2-0", probability: 0.132 },
      { score: "1-0", probability: 0.123 },
      { score: "1-1", probability: 0.106 },
    ],
    oddsSources: [{
      source: "polymarket",
      observedAt: "2026-09-09T10:00:00Z",
      pHome: 0.64,
      pDraw: 0.23,
      pAway: 0.13,
    }],
  });
}

function arsenalChelseaGrounding(): Grounding {
  return matchGrounding({
    fixtureId: "espn:eng.1:401879292",
    home: "Arsenal",
    away: "Chelsea",
    date: "2026-09-06T15:30:00Z",
    pHome: 0.52,
    pDraw: 0.25,
    pAway: 0.23,
    pOver2_5: 0.57,
    pUnder2_5: 0.43,
    pBttsYes: 0.55,
    pBttsNo: 0.45,
    topScores: [
      { score: "2-1", probability: 0.098 },
      { score: "1-1", probability: 0.09 },
      { score: "1-0", probability: 0.085 },
    ],
    oddsSources: [],
  });
}

describe("V2 conversational architecture", () => {
  it("classifies narrow turns without requesting another full card", () => {
    const preview = planResponse("Preview Arsenal v Chelsea", { groundingKind: "match" });
    expect(responsePresentation(preview)).toEqual({ responseMode: "match-preview", fixtureCard: "expanded" });
    const desk = planResponse("What about Arsenal vs Chelsea?", { groundingKind: "match" });
    expect(responsePresentation(desk)).toEqual({ responseMode: "pricing-desk", fixtureCard: "expanded" });
    expect(desk.maxSections).toBe(1);
    expect(planResponse("Is Arsenal vs Chelsea over or under 2.5?", { groundingKind: "match" }).mode)
      .toBe("totals");
    const followUp = { groundingKind: "match" as const, hasHistory: true };
    expect(planResponse("BTTS?", followUp).mode).toBe("btts");
    expect(planResponse("btts", followUp).mode).toBe("btts");
    expect(planResponse("both teams to score", followUp).mode).toBe("btts");
    expect(planResponse("what are the possible scorelines and odds for o2.5", followUp).mode)
      .toBe("totals");
    for (const question of ["o2.5", "over2.5", "ou 2.5", "o/u 2.5", "o 2.5"]) {
      expect(planResponse(question, followUp).mode).toBe("totals");
    }
    expect(planResponse("possible scorelines", followUp).mode).toBe("exact-score");
    expect(planResponse("likely scores", followUp).mode).toBe("exact-score");
    for (const [question, mode] of [
      ["What is fair value for 2-1?", "fair-price"],
      ["Who is most likely to score?", "player-or-scorer"],
      ["Who will most likely score for Liverpool?", "player-or-scorer"],
      ["What if Saka misses out?", "lineup-counterfactual"],
      ["Why?", "match-follow-up"],
    ] as const) {
      const plan = planResponse(question, { groundingKind: "match", hasHistory: true });
      expect(plan.mode).toBe(mode);
      expect(responsePresentation(plan).fixtureCard).toBe("compact");
      expect(plan.maxSections).toBe(1);
    }
    expect(planResponse("Who scores?", { groundingKind: "match" }).evidenceRequired).toBe(true);
    expect(planResponse("Anytime scorer?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    expect(planResponse("First goal scorer?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    expect(planResponse("Who might score tonight?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    expect(planResponse("Who is the top scorer?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    expect(planResponse("Leading scorer?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    expect(planResponse("Who is the scorer?", { groundingKind: "match" }).mode).toBe("player-or-scorer");
    const scorerQueries = planEvidenceQueries("Who scores?", grounding(), null);
    expect(scorerQueries.some((query) => /anytime goalscorer first scorer/.test(query))).toBe(true);
    expect(scorerQueries.some((query) => /odds movement|over 2\.5|public betting/.test(query))).toBe(false);
    const teamNewsQueries = planEvidenceQueries("What is the latest team news?", grounding(), null);
    expect(teamNewsQueries.some((query) => /team news injuries/.test(query))).toBe(true);
    expect(teamNewsQueries.some((query) => /odds movement|public betting/.test(query))).toBe(false);
    const previewQueries = planEvidenceQueries(
      "Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.",
      grounding(),
      null
    );
    expect(previewQueries.some((query) => /public betting/.test(query))).toBe(false);
    expect(previewQueries.some((query) => /odds movement/.test(query))).toBe(false);
    const deskQueries = planEvidenceQueries("What about Arsenal vs Chelsea?", grounding(), null);
    expect(deskQueries.some((query) => /public betting|odds movement/.test(query))).toBe(false);
    const marketQueries = planEvidenceQueries(
      "Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?",
      grounding(),
      null
    );
    expect(marketQueries.some((query) => /odds movement/.test(query))).toBe(true);
    expect(marketQueries.some((query) => /public betting/.test(query))).toBe(false);
    expect(planResponse("Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.", { groundingKind: "match" }).mode).toBe("match-preview");
    expect(planResponse("Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?", { groundingKind: "match", hasHistory: true }).mode).toBe("market-comparison");
    expect(planResponse("If the home striker is ruled out, exactly how many percentage points would you take off the home win?", { groundingKind: "match", hasHistory: true }).mode).toBe("lineup-counterfactual");
    expect(planResponse("What is the latest team news?", { groundingKind: "match" }).evidenceRequired).toBe(true);
    expect(planResponse("I found Arsenal at 7 — pass or play?", { groundingKind: "match", hasUserLine: true }).mode)
      .toBe("user-line");
    expect(planResponse("How much should I stake?", { groundingKind: "match" }).mode).toBe("stake-refusal");
    expect(asksStakeSizeQuestion("Three points are at stake for Arsenal")).toBe(false);
    expect(planResponse("Three points are at stake for Arsenal", { groundingKind: "match", hasHistory: true }).mode)
      .not.toBe("stake-refusal");
    const followUpOdds = { groundingKind: "match" as const, hasHistory: true };
    expect(planResponse("what are the odds", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("what's the line", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("show me the board", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("what is a +EV bet", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("what's the expected value", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("edge vs the book", followUpOdds).mode).toBe("pricing-desk");
    expect(planResponse("projected score", followUpOdds).mode).toBe("exact-score");
    expect(planResponse("what's the projected score", followUpOdds).mode).toBe("exact-score");
    expect(planResponse("Tactical matchup", followUpOdds).mode).toBe("match-follow-up");
    expect(planResponse("How do Chelsea win this?", { groundingKind: "match" }).mode).toBe("match-follow-up");
    expect(planResponse("How do Cherries win this?", { groundingKind: "match" }).mode).toBe("match-follow-up");
    expect(planResponse("How do Man Utd win this?", { groundingKind: "match" }).mode).toBe("match-follow-up");
    expect(closedGroundedAnswer("How do Chelsea win this?", grounding())).toBeNull();
    expect(planResponse("who decides this", { groundingKind: "match" }).mode).toBe("match-follow-up");
    expect(planResponse("I found Arsenal at 7 — what's the +EV?", {
      groundingKind: "match", hasUserLine: true, hasHistory: true,
    }).mode).toBe("user-line");
    const leftoverLine = { groundingKind: "match" as const, hasHistory: true, hasUserLine: true };
    expect(planResponse("what are the odds", leftoverLine).mode).toBe("pricing-desk");
    expect(planResponse("projected score", leftoverLine).mode).toBe("exact-score");
    expect(planResponse("Tactical matchup", leftoverLine).mode).toBe("match-follow-up");
    expect(planResponse("what is a +EV bet", leftoverLine).mode).toBe("user-line");
    expect(planResponse("what is a +EV bet", { groundingKind: "match", hasHistory: true }).mode)
      .toBe("pricing-desk");
    expect(questionAcceptsUserLine("+EV")).toBe(true);
    expect(questionAcceptsUserLine("What are the odds")).toBe(false);
    expect(questionAcceptsUserLine("Tactical matchup")).toBe(false);
    expect(questionAcceptsUserLine("Projected score")).toBe(false);
  });

  it("plans real retrieval for stats questions without searching owned match facts", () => {
    const mbeumo = "How has Bryan Mbeumo performed statistically this season?";
    const planned = planEvidenceQueries(mbeumo, null, deterministicSearchQuery(mbeumo));
    expect(planned.length).toBeGreaterThanOrEqual(2);
    expect(planEvidenceQueries("Explain the offside rule", null, deterministicSearchQuery("Explain the offside rule")))
      .toEqual([]);
    expect(deterministicSearchQuery("What are Pundit's current 1X2 probabilities?", "", grounding())).toBeNull();
    expect(deterministicSearchQuery("What does the current table show?", "", {
      kind: "competition",
      competitionId: "eng.1",
      competition: "Premier League",
      updatedAt: "2026-09-08T00:00:00Z",
      standings: [],
    })).toBeNull();
    expect(planEvidenceQueries("Is Arsenal vs Chelsea over 2.5 goals?", grounding(), null)
      .some((query) => /\bstats\b/.test(query))).toBe(false);
  });

  it("separates model, market and abstention facts", () => {
    const match = grounding();
    expect(match.pricing.model.home.fairOdds).toBeCloseTo(1 / match.pHome);
    const facts = buildResponseFacts(match).facts;
    expect(facts.find((fact) => fact.id === "match.home")?.provenance).toBe("server-model");
    expect(facts.find((fact) => fact.id === "pricing.model.home")?.numeric).toEqual({
      value: match.pricing.model.home.fairOdds,
      unit: "decimal-odds",
    });
    expect(facts.find((fact) => fact.id === "market.kalshi.home")?.provenance).toBe("market-observation");
    expect(facts.find((fact) => fact.id === "market.kalshi.home")?.marketObservation).toEqual({
      modelProbability: 0.563,
      marketProbability: 0.501,
      gapPoints: 6.2,
    });
    expect(facts.find((fact) => fact.id === "market.kalshi.home")?.prohibitedClaims)
      .toContain("recommend-wager");
    expect(facts.find((fact) => fact.id === "pricing.market.kalshi.home")).toBeUndefined();
    expect(facts.find((fact) => fact.id === "limit.player-pricing")?.provenance).toBe("abstention");
  });

  it("accepts only structured drafts whose fact and source IDs validate", () => {
    const valid = validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "I make {{match.home}} the likelier outcome.", factIds: ["match.home"] },
      reasoning: [],
      uncertainty: { text: "I cannot price a lineup change.", factIds: ["limit.lineup-counterfactual"] },
      citedClaims: [{ text: "Saka trained on Friday", factIds: [], sourceIds: ["S1"] }],
    }), grounding(), { sourceIds: ["S1"] });
    expect(valid.valid).toBe(true);
    if (valid.valid) expect(valid.answer).toContain("[[S1]]");
    expect(validateAnalystDraft("ordinary prose", grounding())).toEqual({ valid: false, reason: "invalid-json" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "Invented", factIds: ["made.up"] }, reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "invalid-direct-answer" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "I make Arsenal 71.2%.", factIds: ["match.home"] },
      reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "untraceable-number" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "I make {{match.home}}.", factIds: ["match.home"] },
      reasoning: [], citedClaims: [{ text: "Claim", factIds: [], sourceIds: ["S2"] }],
    }), grounding(), { sourceIds: ["S1"] })).toEqual({ valid: false, reason: "invalid-source-ids" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: {
        text: "Kalshi is lower because Chelsea are missing players.",
        factIds: ["market.kalshi.home"],
      },
      reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "prohibited-claim" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "I make Chelsea {{match.home}}.", factIds: ["match.home"] },
      reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "free-text-match-subject" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "I prefer {{match.away}}.", factIds: ["match.away"] },
      reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "unsupported-ranking" });
    expect(validateAnalystDraft(JSON.stringify({
      directAnswer: { text: "Chelsea is +40% EV at 7.00 against a 2.02 play price.", factIds: ["match.away"] },
      reasoning: [], citedClaims: [],
    }), grounding())).toEqual({ valid: false, reason: "untraceable-number" });
    expect(salvageCitedClaimProse(JSON.stringify({
      directAnswer: { text: "I favour the home side.", factIds: ["match.home"] },
      citedClaims: [{ text: "Cole Palmer is ruled out.", sourceIds: ["S1"] }],
    }), ["S1"])).toMatch(/Cole Palmer is ruled out \[\[S1\]\]/);
    expect(salvageCitedClaimProse(JSON.stringify({
      citedClaims: [{ text: "Squawka preview dated {{date:2026-09-06}}.", sourceIds: ["S1"] }],
    }), ["S1"])).toMatch(/Squawka preview dated \[\[S1\]\]/);
    expect(salvageCitedClaimProse(JSON.stringify({
      citedClaims: [{ text: "Squawka preview dated {{date:2026-09-06}}.", sourceIds: ["S1"] }],
    }), ["S1"])).not.toMatch(/\{\{/);
  });

  it("uses the structured draft contract in the real delivery boundary and fails closed", async () => {
    const match = grounding();
    const client = {} as Parameters<typeof deliverAnswer>[0]["client"];
    const base = {
      tier: "match" as const,
      grounding: match,
      bundle: { queries: [], providerCalls: 0, results: [] },
      client,
      question: "Why do you favour Arsenal?",
      evidenceRequired: false,
      candidateUnrecognized: false,
      hasHistory: true,
      structuredDraftExpected: true,
    };
    const delivered = await deliverAnswer({
      ...base,
      answer: JSON.stringify({
        directAnswer: { text: "I favour {{match.home}}.", factIds: ["match.home"] },
        reasoning: [{ text: "That is my baseline for this fixture.", factIds: [] }],
        citedClaims: [],
      }),
    });
    expect(delivered.answer).toContain("I favour Arsenal 56.3%.");
    expect(delivered.answer).not.toContain("directAnswer");

    const rejected = await deliverAnswer({
      ...base,
      answer: JSON.stringify({
        directAnswer: { text: "I favour Arsenal at 71.2%.", factIds: ["match.home"] },
        reasoning: [], citedClaims: [],
      }),
    });
    expect(rejected.answer).toMatch(/My short answer is Arsenal at 56\.3%/);
    expect(rejected.answer).not.toContain("71.2%");
    expect(match.pricing.model.home.fairOdds).toBeCloseTo(1 / match.pHome);
    expect(match.pricing.markets[0].legs.home.evPct).toBeNull();

    const lined = {
      ...match,
      pricing: attachUserLine(match.pricing, { outcome: "away", decimalOdds: 7 }),
    };
    const emptied = await deliverAnswer({
      ...base,
      grounding: lined,
      question: "I found Arsenal at 7 — pass or play?",
      answer: "",
    });
    expect(emptied.answer).toMatch(/Chelsea at 7\.00/);
    expect(lined.pricing.userLine?.evPct).toBeCloseTo(lined.pAway * 7 - 1);
    expect(lined.pricing.stakeFrac).toBeNull();

    const scorerFallback = await deliverAnswer({
      ...base,
      question: "Who is most likely to score?",
      evidenceRequired: true,
      answer: JSON.stringify({
        directAnswer: { text: "I favour {{match.home}}.", factIds: ["match.home"] },
        reasoning: [],
        citedClaims: [],
      }),
    });
    expect(scorerFallback.answer).toBe(PLAYER_SCORER_ABSTENTION);
    expect(scorerFallback.answer).not.toMatch(/56\.3%/);
    expect(scorerFallback.verification.status).toBe("abstain");

    const quoted = await deliverAnswer({
      ...base,
      question: "Who is most likely to score?",
      evidenceRequired: true,
      bundle: {
        queries: ["Arsenal vs Chelsea anytime goalscorer"],
        providerCalls: 1,
        results: [{
          id: "S1",
          title: "Chelsea vs Arsenal anytime scorer odds",
          url: "https://example.com/scorers",
          date: "2026-09-11T08:00:00Z",
          snippet: "Cole Palmer anytime 2.10, Cole Palmer expected to start for Chelsea.",
        }],
      },
      answer: "I make Arsenal 56.3% and therefore Salah is the most likely scorer.",
    });
    expect(quoted.answer).toMatch(/Cole Palmer/);
    expect(quoted.answer).toMatch(/2\.10 decimal/);
    expect(quoted.answer).toMatch(/example\.com\/scorers/);
    expect(quoted.answer).toMatch(/don't treat that quote as a Pundit probability/i);
    expect(quoted.answer).not.toMatch(/56\.3%/);
    expect(quoted.answer).not.toMatch(/Salah/);
    expect(quoted.citations.map((citation) => citation.id)).toEqual(["S1"]);
    expect(quoted.verification.status).toBe("verified");

    const teamNewsEmpty = await deliverAnswer({
      ...base,
      question: "What is the latest team news?",
      evidenceRequired: true,
      answer: JSON.stringify({
        directAnswer: { text: "I favour {{match.home}}.", factIds: ["match.home"] },
        reasoning: [],
        citedClaims: [],
      }),
    });
    expect(teamNewsEmpty.answer).toBe(TEAM_NEWS_COMPOSE_ABSTENTION);
    expect(teamNewsEmpty.answer).not.toMatch(/56\.3%/);
    expect(teamNewsEmpty.verification.status).toBe("abstain");

    const teamNewsQuoted = await deliverAnswer({
      ...base,
      question: "What is the latest team news?",
      evidenceRequired: true,
      bundle: {
        queries: ["Arsenal vs Chelsea team news"],
        providerCalls: 1,
        results: [{
          id: "S1",
          title: "Arsenal vs Chelsea injury update",
          url: "https://example.com/news",
          date: "2026-09-11T08:00:00Z",
          snippet: "Cole Palmer ruled out for Chelsea.",
        }],
      },
      answer: "I make Arsenal 56.3% and therefore Palmer is fine to start.",
    });
    expect(teamNewsQuoted.answer).toMatch(/Cole Palmer/);
    expect(teamNewsQuoted.answer).toMatch(/unavailable/);
    expect(teamNewsQuoted.answer).toMatch(/example\.com\/news/);
    expect(teamNewsQuoted.answer).toMatch(/not a revised match forecast/i);
    expect(teamNewsQuoted.answer).not.toMatch(/56\.3%/);
    expect(teamNewsQuoted.citations.map((citation) => citation.id)).toEqual(["S1"]);
    expect(teamNewsQuoted.verification.status).toBe("verified");

    const deskNews = await deliverAnswer({
      ...base,
      voice: "desk",
      question: "What is the latest team news?",
      evidenceRequired: true,
      bundle: {
        queries: ["Arsenal vs Chelsea team news"],
        providerCalls: 1,
        results: [{
          id: "S1",
          title: "Arsenal vs Chelsea injury update",
          url: "https://example.com/news",
          date: "2026-09-11T08:00:00Z",
          snippet: "Cole Palmer ruled out for Chelsea.",
        }],
      },
      answer: "Iraola is gone and Marco Rose took over in April [[S1]].",
    });
    expect(deskNews.answer).toMatch(/Cole Palmer/);
    expect(deskNews.answer).toMatch(/example\.com\/news/);
    expect(deskNews.answer).toMatch(/11 Sep/);
    expect(deskNews.answer).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(deskNews.citations.map((citation) => citation.id)).toEqual(["S1"]);
    expect(deskNews.verification.status).toBe("verified");

    const deskSalvage = await deliverAnswer({
      ...base,
      voice: "desk",
      question: "What is the latest team news?",
      evidenceRequired: true,
      bundle: {
        queries: ["Arsenal vs Chelsea team news"],
        providerCalls: 1,
        results: [{
          id: "S1",
          title: "Arsenal vs Chelsea injury update",
          url: "https://example.com/news",
          date: "2026-09-11T08:00:00Z",
          snippet: "Cole Palmer ruled out for Chelsea.",
        }],
      },
      answer: JSON.stringify({
        directAnswer: { text: "I favour {{match.home}}.", factIds: ["match.home", "match.pHome"] },
        reasoning: [],
        citedClaims: [{ text: "Cole Palmer is ruled out for Chelsea.", sourceIds: ["S1"] }],
      }),
    });
    expect(deskSalvage.answer).toMatch(/Cole Palmer/);
    expect(deskSalvage.citations.map((citation) => citation.id)).toEqual(["S1"]);
    expect(deskSalvage.answer).not.toContain("directAnswer");
  });

  it("composes direct fair-price, scorer, lineup and market answers", () => {
    const match = grounding();
    const fair = composeMatchResponse("Fair odds for 2-1?", match,
      planResponse("Fair odds for 2-1?", { groundingKind: "match", hasHistory: true }));
    expect(fair).toMatch(/11\.4%.*8\.77/);
    expect(fair).not.toContain("full 1X2");
    expect(composeMatchResponse("Who scores?", match,
      planResponse("Who scores?", { groundingKind: "match", hasHistory: true }))).toMatch(/don’t have player-level projections/i);
    expect(composeMatchResponse("Who will most likely score for Chelsea?", match,
      planResponse("Who will most likely score for Chelsea?", { groundingKind: "match", hasHistory: true })))
      .toMatch(/can’t name a most likely scorer without inventing one/i);
    expect(composeMatchResponse("What if Saka is absent?", match,
      planResponse("What if Saka is absent?", { groundingKind: "match", hasHistory: true }))).toMatch(/won’t invent a percentage/i);
    const market = composeMatchResponse("Where do you disagree with Kalshi?", match,
      planResponse("Where do you disagree with Kalshi?", { groundingKind: "match", hasHistory: true }));
    expect(market).toMatch(/56\.3%.*50\.1%.*6\.2 percentage points/);
    expect(market).not.toMatch(/because.*lineup/i);
    expect(resolveRequestedScoreline("Chelsea to win 2-0", match)).toEqual({
      score: "0-2", orientation: "named-away",
    });
    const awayScore = composeMatchResponse("Fair odds for Chelsea to win 2-0?", match,
      planResponse("Fair odds for Chelsea to win 2-0?", { groundingKind: "match", hasHistory: true }));
    expect(awayScore).toMatch(/Arsenal 0-2 Chelsea.*7\.1%.*14\.08/);
    const ambiguous = composeMatchResponse("Fair odds for 2-1?", match,
      planResponse("Fair odds for 2-1?", { groundingKind: "match", hasHistory: true }));
    expect(ambiguous).toMatch(/^Reading 2-1 in home-away order/);
    const oneXTwo = composeMatchResponse("Back to that match: what will the 1X2 be?", match,
      planResponse("Back to that match: what will the 1X2 be?", { groundingKind: "match", hasHistory: true }));
    expect(oneXTwo).toMatch(/Arsenal 56\.3%.*draw 23\.4%.*Chelsea 20\.3%/i);
    const input = composeMatchResponse("Which model input matters most to that edge?", match,
      planResponse("Which model input matters most to that edge?", { groundingKind: "match", hasHistory: true }));
    expect(input).toMatch(/^I can’t isolate one input/i);

    const lined = {
      ...match,
      pricing: attachUserLine(match.pricing, { outcome: "away", decimalOdds: 7 }),
    };
    expect(lined.pricing.userLine?.evPct).toBeCloseTo(lined.pAway * 7 - 1);
    expect(lined.pricing.stakeFrac).toBeNull();
    const userLine = composeMatchResponse(
      "I found Arsenal at 7 — pass or play?",
      lined,
      planResponse("I found Arsenal at 7 — pass or play?", { groundingKind: "match", hasUserLine: true })
    );
    expect(userLine).toMatch(/Chelsea at 7\.00/);
    expect(userLine).toMatch(/I play/);
    expect(userLine).toMatch(/Risk is high/);
    expect(userLine).not.toMatch(/\block\b/i);
    const pass = composeMatchResponse(
      "I found Arsenal at 1.10 — pass or play?",
      { ...match, pricing: attachUserLine(match.pricing, { outcome: "home", decimalOdds: 1.1 }) },
      planResponse("I found Arsenal at 1.10 — pass or play?", { groundingKind: "match", hasUserLine: true })
    );
    expect(pass).toMatch(/I pass/);
    const abstain = composeMatchResponse(
      "I found Arsenal at 1.80 — pass or play?",
      { ...match, pricing: attachUserLine(match.pricing, { outcome: "home", decimalOdds: 1.8 }) },
      planResponse("I found Arsenal at 1.80 — pass or play?", { groundingKind: "match", hasUserLine: true })
    );
    expect(abstain).toMatch(/will not call it/);
    const stake = composeMatchResponse(
      "How much should I stake?",
      lined,
      planResponse("How much should I stake?", { groundingKind: "match", hasUserLine: true })
    );
    expect(stake).toContain(STAKE_REFUSAL_SENTENCE);
    expect(stake).toMatch(/I play/);
    expect(stake).not.toMatch(/kelly|unit size/i);

    const totals = composeMatchResponse(
      "Is Arsenal vs Chelsea over or under 2.5?",
      match,
      planResponse("Is Arsenal vs Chelsea over or under 2.5?", { groundingKind: "match" })
    );
    expect(totals).toMatch(/I have over 2\.5 at 58\.9%/);
    expect(totals).toMatch(/under 2\.5 is 41\.1%/);
    expect(totals).toContain(SHARED_TOTAL_XG_SENTENCE);
    expect(totals).not.toMatch(/ClubElo|Dixon-Coles|Dixon–Coles/i);

    const combinedQuestion = "what are the possible scorelines and odds for o2.5";
    const combined = composeMatchResponse(
      combinedQuestion,
      match,
      planResponse(combinedQuestion, { groundingKind: "match", hasHistory: true })
    );
    expect(combined).toMatch(/I have over 2\.5 at 58\.9% \(fair 1\.70\)/);
    expect(combined).toMatch(/under 2\.5 is 41\.1%/);
    expect(combined).toContain(SHARED_TOTAL_XG_SENTENCE);
    expect(combined).toMatch(/2-1 at 11\.4% \(fair 8\.77\)/);
    expect(combined).not.toMatch(/\b1-1\b/);
    expect(combined).not.toContain("My short answer is");
    expect(combined).not.toMatch(/full 1X2/i);

    const bttsQuestion = "BTTS?";
    const btts = composeMatchResponse(
      bttsQuestion,
      match,
      planResponse(bttsQuestion, { groundingKind: "match", hasHistory: true })
    );
    expect(btts).toMatch(/I have BTTS yes at 57\.4%/);
    expect(btts).toMatch(/BTTS no is 42\.6%/);
    expect(btts).not.toContain("My short answer is");
    expect(btts).not.toMatch(/56\.3%/);
    expect(btts).not.toMatch(/full 1X2/i);
    expect(btts).not.toMatch(/No verified, dated team-news/i);

    const scoreBoard = composeMatchResponse(
      "possible scorelines",
      match,
      planResponse("possible scorelines", { groundingKind: "match", hasHistory: true })
    );
    expect(scoreBoard).toMatch(/2-1 at 11\.4% \(fair 8\.77\)/);
    expect(scoreBoard).toMatch(/1-1 at 10\.2% \(fair 9\.80\)/);
    expect(scoreBoard).not.toMatch(/My short answer is/);
    expect(scoreBoard).not.toMatch(/56\.3%/);
    expect(scoreBoard).not.toMatch(/full 1X2/i);

    const named = composeMatchResponse(
      "What about Arsenal vs Chelsea?",
      match,
      planResponse("What about Arsenal vs Chelsea?", { groundingKind: "match" })
    );
    expect(named).toMatch(/My 1X2 is Arsenal 56\.3% \(fair 1\.78\)/);
    expect(named).toMatch(/draw 23\.4% \(fair 4\.27\)/);
    expect(named).toMatch(/Chelsea 20\.3% \(fair 4\.93\)/);
    expect(named).toMatch(/captured decimal line before I can print EV%/);
    expect(named).not.toContain(SHARED_TOTAL_XG_SENTENCE);
    expect(named).not.toMatch(/leading scorelines/i);

    const previewCopy = composeMatchResponse(
      "Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.",
      match,
      planResponse("Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.", { groundingKind: "match" })
    );
    expect(previewCopy).toMatch(/full 1X2/);
    expect(previewCopy).toContain(SHARED_TOTAL_XG_SENTENCE);
    expect(previewCopy).not.toMatch(/Over 2\.5 is 58\.9%/);
  });

  it("settles desk odds, +EV and projected-score turns from the composer", () => {
    const match = grounding();
    const history = { groundingKind: "match" as const, hasHistory: true };
    expect(isSettledMatchMode(planResponse("what are the odds", history).mode)).toBe(true);
    expect(closedGroundedAnswer("what are the odds", match, true)).toMatch(/My 1X2 is Arsenal/);
    expect(closedGroundedAnswer("what is a +EV bet", match, true)).toMatch(/captured decimal line/);
    expect(closedGroundedAnswer("projected score", match, true)).toMatch(/leading scorelines/);
    expect(isSettledMatchMode(planResponse("Tactical matchup", history).mode)).toBe(false);
    expect(closedGroundedAnswer("Tactical matchup", match, true)).toBeNull();
    const leftover = {
      ...match,
      pricing: attachUserLine(match.pricing, { outcome: "away", decimalOdds: 2.1 }),
    };
    expect(closedGroundedAnswer("what are the odds", leftover, true)).toMatch(/My 1X2 is Arsenal/);
    expect(closedGroundedAnswer("what are the odds", leftover, true)).not.toMatch(/EV [+\-]/);
    expect(closedGroundedAnswer("projected score", leftover, true)).toMatch(/leading scorelines/);
    expect(closedGroundedAnswer("Tactical matchup", leftover, true)).toBeNull();
    expect(closedGroundedAnswer("How do Chelsea win this?", leftover, true)).toBeNull();
    expect(closedGroundedAnswer("what is a +EV bet", leftover, true)).toMatch(/EV /);

    const odds = composeMatchResponse("what are the odds", match, planResponse("what are the odds", history));
    expect(odds).toMatch(/My 1X2 is Arsenal 56\.3% \(fair 1\.78\)/);
    expect(odds).toMatch(/captured decimal line before I can print EV%/);
    expect(odds).not.toMatch(/leading scorelines/i);

    const ev = composeMatchResponse("what is a +EV bet", match, planResponse("what is a +EV bet", history));
    expect(ev).toMatch(/captured decimal line before I can print EV%/);
    expect(ev).not.toMatch(/I will not size a stake/i);

    const lined = {
      ...match,
      pricing: attachUserLine(match.pricing, { outcome: "away", decimalOdds: 7 }),
    };
    const posted = composeMatchResponse(
      "what is a +EV bet",
      lined,
      planResponse("what is a +EV bet", { groundingKind: "match", hasHistory: true, hasUserLine: true })
    );
    expect(posted).toMatch(/EV \+/);
    expect(posted).toMatch(/Chelsea at 7\.00/);

    const projected = composeMatchResponse(
      "projected score",
      match,
      planResponse("projected score", history)
    );
    expect(projected).toMatch(/2-1 at 11\.4% \(fair 8\.77\)/);
    expect(projected).not.toMatch(/56\.3%/);
  });

  it("settles odds, projected score and +EV for a second open fixture with a named market", () => {
    const liverpool = liverpoolGrounding();
    const history = { groundingKind: "match" as const, hasHistory: true };
    expect(planResponse("what are the odds", history).mode).toBe("pricing-desk");
    expect(planResponse("projected score", history).mode).toBe("exact-score");
    expect(planResponse("what is a +EV bet", history).mode).toBe("pricing-desk");
    expect(closedGroundedAnswer("what are the odds", liverpool, true)).toMatch(/My 1X2 is Liverpool/);
    expect(closedGroundedAnswer("projected score", liverpool, true)).toMatch(/leading scorelines/);
    expect(closedGroundedAnswer("what is a +EV bet", liverpool, true)).toMatch(/captured decimal line/);

    const odds = composeMatchResponse("what are the odds", liverpool, planResponse("what are the odds", history));
    expect(odds).toMatch(/Liverpool 66\.0% \(fair 1\.52\)/);
    expect(odds).toMatch(/Fulham 11\.7% \(fair 8\.55\)/);
    expect(odds).toMatch(/captured decimal line before I can print EV%/);

    const projected = composeMatchResponse(
      "projected score",
      liverpool,
      planResponse("projected score", history)
    );
    expect(projected).toMatch(/2-0 at 13\.2% \(fair 7\.58\)/);
    expect(projected).not.toMatch(/66\.0%/);

    const lined = {
      ...liverpool,
      pricing: attachUserLine(liverpool.pricing, { outcome: "home", decimalOdds: 1.44 }),
    };
    expect(planResponse("what is a +EV bet", { ...history, hasUserLine: true }).mode).toBe("user-line");
    const posted = composeMatchResponse(
      "what is a +EV bet",
      lined,
      planResponse("what is a +EV bet", { ...history, hasUserLine: true })
    );
    expect(posted).toMatch(/Liverpool at 1\.44/);
    expect(posted).toMatch(/EV /);
  });

  it("applies the same desk compose/plan contract across remaining GW4 opens", () => {
    const remaining = [
      { fixtureId: "espn:eng.1:401879281", home: "Crystal Palace", away: "Ipswich Town" },
      { fixtureId: "espn:eng.1:401879284", home: "Aston Villa", away: "Nottingham Forest" },
      { fixtureId: "espn:eng.1:401879285", home: "Bournemouth", away: "Brentford" },
      { fixtureId: "espn:eng.1:401879277", home: "Tottenham", away: "Everton" },
      { fixtureId: "espn:eng.1:401878779", home: "Sunderland", away: "Arsenal" },
      { fixtureId: "espn:eng.1:401879282", home: "Coventry City", away: "Brighton" },
      { fixtureId: "espn:eng.1:401879280", home: "Leeds United", away: "Newcastle" },
    ] as const;
    const history = { groundingKind: "match" as const, hasHistory: true };
    const leftover = { ...history, hasUserLine: true };
    expect(planResponse("what are the odds", leftover).mode).toBe("pricing-desk");
    expect(planResponse("projected score", leftover).mode).toBe("exact-score");
    expect(planResponse("what is a +EV bet", history).mode).toBe("pricing-desk");
    expect(planResponse("what is a +EV bet", leftover).mode).toBe("user-line");
    expect(planResponse("what are the odds", { groundingKind: "fixture" }).mode).toBe("coverage");

    for (const row of remaining) {
      const g = matchGrounding({
        fixtureId: row.fixtureId,
        home: row.home,
        away: row.away,
        date: "2026-09-12T14:00:00Z",
        pHome: 0.48,
        pDraw: 0.26,
        pAway: 0.26,
        pOver2_5: 0.5,
        pUnder2_5: 0.5,
        pBttsYes: 0.47,
        pBttsNo: 0.53,
        topScores: [
          { score: "1-0", probability: 0.11 },
          { score: "1-1", probability: 0.1 },
          { score: "2-1", probability: 0.09 },
        ],
        oddsSources: [],
      });
      expect(closedGroundedAnswer("what are the odds", g, true)).toMatch(new RegExp(row.home.split(" ")[0]));
      expect(closedGroundedAnswer("what is a +EV bet", g, true)).toMatch(/captured decimal line/);
      const projected = composeMatchResponse(
        "projected score",
        g,
        planResponse("projected score", history)
      );
      expect(projected).toMatch(/1-0 at 11\.0%/);
      expect(projected).not.toMatch(/48\.0%/);
    }
  });

  it("still composes a board from completed-match grounding when a decimal is present or missing", () => {
    const historical = arsenalChelseaGrounding();
    const history = { groundingKind: "match" as const, hasHistory: true };
    expect(closedGroundedAnswer("what are the odds", historical, true)).toMatch(/My 1X2 is Arsenal/);
    expect(closedGroundedAnswer("projected score", historical, true)).toMatch(/leading scorelines/);
    expect(closedGroundedAnswer("what is a +EV bet", historical, true)).toMatch(/captured decimal line/);

    const odds = composeMatchResponse("what are the odds", historical, planResponse("what are the odds", history));
    expect(odds).toMatch(/Arsenal 52\.0% \(fair 1\.92\)/);
    expect(odds).toMatch(/Chelsea 23\.0% \(fair 4\.35\)/);
    expect(odds).toMatch(/captured decimal line before I can print EV%/);

    const projected = composeMatchResponse(
      "projected score",
      historical,
      planResponse("projected score", history)
    );
    expect(projected).toMatch(/2-1 at 9\.8%/);

    const lined = {
      ...historical,
      pricing: attachUserLine(historical.pricing, { outcome: "home", decimalOdds: 1.85 }),
    };
    const posted = composeMatchResponse(
      "what is a +EV bet",
      lined,
      planResponse("what is a +EV bet", { ...history, hasUserLine: true })
    );
    expect(posted).toMatch(/Arsenal at 1\.85/);
    expect(posted).toMatch(/EV /);
  });

  it("fails closed on untraceable percentages and strips unresolved final markers", () => {
    const safe = stripUntraceableMatchPercentages(
      "I make Arsenal 56.3%.\nI make Arsenal 71.2%.\nSaka trained [[S1]] and is 80% fit.",
      { probabilities: [0.563], fairDecimalOdds: [1 / 0.563] }
    );
    expect(safe).toContain("56.3%");
    expect(safe).not.toContain("71.2%");
    expect(safe).toContain("[[S1]]");
    expect(stripUntraceableMatchPercentages(
      "I make it 56.3%, or 1.78 in fair decimal odds.\nI make it 56.3%, or 2.40 in fair decimal odds.",
      { probabilities: [0.563], fairDecimalOdds: [1 / 0.563] }
    )).toBe("I make it 56.3%, or 1.78 in fair decimal odds.");
    expect(stripUnresolvedResponseMarkers("Answer [[S?]].\n[search web now]\nDone [[1]]."))
      .toBe("Answer.\n\nDone.");
  });
});
