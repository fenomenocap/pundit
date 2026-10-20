import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../config/freshness-policy";
import type { Grounding } from "./ask";
import { formatFixtureMyCallHeadline } from "./basics-answer-voice";
import { composeMarketComparisonAnswer, composeMatchResponse } from "./response-composer";
import { buildMatchPricing } from "./response-correctness";
import { sampleMatchContextFields } from "./match-context";
import { planResponse } from "./response-plan";

function arsenalChelseaGrounding(): Grounding {
  const pHome = 0.563;
  const pDraw = 0.234;
  const pAway = 0.203;
  const observedAt = "2026-09-12T08:00:00Z";
  const oddsSources: Grounding["oddsSources"] = [{
    source: "kalshi",
    observedAt,
    pHome: 0.501,
    pDraw: 0.296,
    pAway: 0.203,
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
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "kalshi",
      observedAt,
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
      pricedAt: observedAt,
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
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields(),
  };
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

describe("directAnswerFirst default-path headlines", () => {
  const grounding = arsenalChelseaGrounding();

  it("homepage-desk-output turn 2: totals headline leads with model call and %", () => {
    const question = "What about over and under 2.5? Why do they add to 100%?";
    const answer = composeMatchResponse(
      question,
      grounding,
      planResponse(question, { groundingKind: "match", hasHistory: true }),
    );
    expect(firstLine(answer)).toBe(
      "Over/under 2.5 on Arsenal v Chelsea — I have over 2.5 at 58.9%.",
    );
  });

  it("featured-totals-honesty turn 1: over/under question leads with model call", () => {
    const question = "Is Arsenal vs Chelsea over or under 2.5?";
    const answer = composeMatchResponse(
      question,
      grounding,
      planResponse(question, { groundingKind: "match" }),
    );
    expect(firstLine(answer)).toBe(
      "Over/under 2.5 on Arsenal v Chelsea — I have over 2.5 at 58.9%.",
    );
  });

  it("formatFixtureMyCallHeadline includes the called side model %", () => {
    expect(formatFixtureMyCallHeadline(grounding)).toBe(
      "Arsenal v Chelsea — my call: Arsenal win at 56.3%.",
    );
  });

  it("analyst golden path turn 6: gap question leads with largest disagreement, not full take", () => {
    const question = "Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?";
    const answer = composeMarketComparisonAnswer(question, grounding)!;
    expect(firstLine(answer)).toMatch(
      /Arsenal v Chelsea — the largest gap is on Arsenal: I have 56\.3% vs the market 50\.1%/,
    );
    expect(answer).toMatch(/disagreement between my read and the market/);
    expect(answer).toMatch(/nothing about lineups on its own/);
    expect(answer).not.toMatch(/my call:/);
  });

  it("general market comparison keeps the independent take layout", () => {
    const answer = composeMarketComparisonAnswer(
      "How does your 1X2 compare to Kalshi?",
      grounding,
    )!;
    expect(firstLine(answer)).toBe("Arsenal v Chelsea — my call: Arsenal win at 56.3%.");
  });
});
