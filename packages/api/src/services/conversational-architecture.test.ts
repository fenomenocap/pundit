import { describe, expect, it } from "vitest";
import { deliverAnswer, type Grounding } from "./ask";
import { validateAnalystDraft } from "./analyst-draft";
import { stripUnresolvedResponseMarkers } from "./answer-provenance";
import { composeMatchResponse } from "./response-composer";
import { buildResponseFacts } from "./response-facts";
import { planResponse, resolveRequestedScoreline, responsePresentation } from "./response-plan";
import { stripUntraceableMatchPercentages } from "./response-correctness";

const grounding = (): Grounding => ({
  kind: "match",
  fixtureId: "eng.1:1",
  competitionId: "eng.1",
  competition: "Premier League",
  homeFieldAdvantage: true,
  date: "2026-09-12T14:00:00Z",
  stage: "Regular Season",
  home: "Arsenal",
  away: "Chelsea",
  pHome: 0.563,
  pDraw: 0.234,
  pAway: 0.203,
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
  oddsSources: [{
    source: "kalshi", observedAt: "2026-09-12T08:00:00Z",
    pHome: 0.501, pDraw: 0.296, pAway: 0.203,
  }],
  marketDivergence: [{
    source: "kalshi", observedAt: "2026-09-12T08:00:00Z",
    legs: [
      { outcome: "home", label: "Arsenal", modelPercent: 56.3, marketPercent: 50.1, gapPoints: 6.2 },
      { outcome: "draw", label: "the draw", modelPercent: 23.4, marketPercent: 29.6, gapPoints: -6.2 },
      { outcome: "away", label: "Chelsea", modelPercent: 20.3, marketPercent: 20.3, gapPoints: 0 },
    ],
    largest: { outcome: "home", label: "Arsenal", modelPercent: 56.3, marketPercent: 50.1, gapPoints: 6.2 },
  }],
});

describe("V2 conversational architecture", () => {
  it("classifies narrow turns without requesting another full card", () => {
    const preview = planResponse("Preview Arsenal v Chelsea", { groundingKind: "match" });
    expect(responsePresentation(preview)).toEqual({ responseMode: "match-preview", fixtureCard: "expanded" });
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
    expect(planResponse("Who scores?", { groundingKind: "match" }).evidenceRequired).toBe(false);
    expect(planResponse("Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.", { groundingKind: "match" }).mode).toBe("match-preview");
    expect(planResponse("Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?", { groundingKind: "match", hasHistory: true }).mode).toBe("market-comparison");
    expect(planResponse("If the home striker is ruled out, exactly how many percentage points would you take off the home win?", { groundingKind: "match", hasHistory: true }).mode).toBe("lineup-counterfactual");
    expect(planResponse("What is the latest team news?", { groundingKind: "match" }).evidenceRequired).toBe(true);
  });

  it("separates model, market and abstention facts", () => {
    const facts = buildResponseFacts(grounding()).facts;
    expect(facts.find((fact) => fact.id === "match.home")?.provenance).toBe("server-model");
    expect(facts.find((fact) => fact.id === "market.kalshi.home")?.provenance).toBe("market-observation");
    expect(facts.find((fact) => fact.id === "market.kalshi.home")?.marketObservation).toEqual({
      modelProbability: 0.563,
      marketProbability: 0.501,
      gapPoints: 6.2,
    });
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
