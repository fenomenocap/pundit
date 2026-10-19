import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../config/freshness-policy";
import type { Grounding } from "./ask";
import {
  composeMarketComparisonAnswer,
  composeMatchResponse,
  composeOddsProvenanceAnswer,
  STAKE_REFUSAL_SENTENCE,
} from "./response-composer";
import { buildMatchPricing } from "./response-correctness";
import { sampleMatchContextFields } from "./match-context";
import { planResponse } from "./response-plan";
import { normalizeAnalystIdentity } from "./ask";

function spursCoventryGrounding(): Grounding {
  const pHome = 0.599;
  const pDraw = 0.244;
  const pAway = 0.157;
  const observedAt = "2026-10-18T12:00:00.000Z";
  const oddsSources: Grounding["oddsSources"] = [{
    source: "polymarket",
    observedAt,
    pHome: 0.64,
    pDraw: 0.205,
    pAway: 0.155,
  }];
  return {
    kind: "match",
    fixtureId: "eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: "Tottenham",
    away: "Coventry",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "2-1", probability: 0.102 }, { score: "1-1", probability: 0.116 }],
    scorelines: [
      { score: "1-1", probability: 0.116 },
      { score: "2-1", probability: 0.102 },
      { score: "1-0", probability: 0.09 },
    ],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "polymarket",
      observedAt,
      legs: [
        { outcome: "home", label: "Tottenham", modelPercent: 59.9, marketPercent: 64.0, gapPoints: -4.1 },
        { outcome: "draw", label: "the draw", modelPercent: 24.4, marketPercent: 20.5, gapPoints: 3.9 },
        { outcome: "away", label: "Coventry", modelPercent: 15.7, marketPercent: 15.5, gapPoints: 0.2 },
      ],
      largest: { outcome: "home", label: "Tottenham", modelPercent: 59.9, marketPercent: 64.0, gapPoints: -4.1 },
    }],
    externalMarketConsensus: {
      label: "Market consensus",
      pHome: 0.64,
      pDraw: 0.205,
      pAway: 0.155,
      asOf: observedAt,
      stale: false,
      staleSources: [],
      disagreement: false,
      maxSpreadPoints: 0,
      sourceCount: 1,
      sources: [{ source: "polymarket", observedAt, weight: 1 }],
    },
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: "Tottenham",
      away: "Coventry",
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "clubelo@1:1da9aa95abcd0001",
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
        impliedDisplayDecimals: true,
        decimalOdds: {
          home: 1 / source.pHome,
          draw: source.pDraw != null ? 1 / source.pDraw : null,
          away: 1 / source.pAway,
        },
      })),
    }),
    freshness: sampleAgentFreshness({
      marketOddsLastUpdated: observedAt,
      modelLastUpdated: observedAt,
      ratingsAsOf: "2026-09-13T00:00:00.000Z",
    }),
    ...sampleMatchContextFields(),
  };
}

describe("investor demo composer fixes", () => {
  const grounding = spursCoventryGrounding();

  it("1) market comparison answers with all three sides, fair decimals, gaps, and source as-of", () => {
    const before = "On Tottenham, I am at 59.9% and Polymarket is at 64.2%…";
    const after = composeMarketComparisonAnswer("How does your 1X2 compare to Polymarket?", grounding)!;
    expect(before).toMatch(/On Tottenham, I am at 59\.9%/);
    expect(after).toContain("My 1X2 is Tottenham 59.9% (fair 1.67)");
    expect(after).toContain("the draw 24.4% (fair 4.10)");
    expect(after).toContain("Coventry 15.7% (fair 6.37)");
    expect(after).toContain("Polymarket no-vig, as of 18 October 2026");
    expect(after).toContain("Tottenham 64.0% (fair 1.56)");
    expect(after).toContain("Per side vs Polymarket (market decimal before fees)");
    expect(after).toContain("fair 1.67 vs market 1.56 (before fees)");
    expect(after).toContain("Tottenham gap -4.1 pts");
    expect(after).not.toMatch(/\bEV\b/);
    expect(after).not.toMatch(/\bedge\b/i);
    const focused = composeMarketComparisonAnswer("What is the edge on Coventry?", grounding)!;
    expect(focused.indexOf("Coventry")).toBeLessThan(focused.indexOf("My 1X2 is"));
  });

  it("2) odds provenance route names feeds, model version, and as-of times", () => {
    const question = "Where do your odds come from and how fresh are they?";
    expect(planResponse(question, { groundingKind: "match" }).mode).toBe("odds-provenance");
    const before = "On Tottenham, I am at 59.9% and Polymarket is at 64.2%…";
    expect(before).toMatch(/On Tottenham, I am at 59\.9%/);
    const after = composeOddsProvenanceAnswer(grounding);
    expect(after).toContain("clubelo@1:1da9aa95abcd0001");
    expect(after).toContain("Polymarket (18 October 2026)");
    expect(after).toContain("market odds 18 October 2026");
  });

  it("3) BTTS includes fair prices and likeliest score uses the top grid row", () => {
    const bttsBefore = "I have BTTS yes at 52.0%; BTTS no is 48.0%.";
    expect(bttsBefore).not.toContain("(fair");
    const bttsAfter = composeMatchResponse("Both teams to score?", grounding, planResponse("Both teams to score?", { groundingKind: "match" }));
    expect(bttsAfter).toContain("BTTS yes at 52.0% (fair 1.92)");
    expect(bttsAfter).toContain("BTTS no is 48.0% (fair 2.08)");

    const scoreBefore = "I make the leading scorelines 2-1 at 10.2% (fair 9.80) and 1-1 at 11.6% (fair 8.62).";
    expect(scoreBefore.startsWith("I make the leading scorelines 2-1")).toBe(true);
    const scoreAfter = composeMatchResponse("What is the most likely score?", grounding, planResponse("What is the most likely score?", { groundingKind: "match" }));
    expect(scoreAfter).toContain("1-1 the likeliest scoreline at 11.6% (fair 8.62)");
  });

  it("4) pricing follow-ups with history stay on the composer, not tactics LLM route", () => {
    const followUp = { groundingKind: "match" as const, hasHistory: true };
    expect(planResponse("what about the draw?", followUp).mode).toBe("pricing-desk");
    expect(planResponse("What about over 2.5?", followUp).mode).toBe("totals");
    const answer = composeMatchResponse("what about the draw?", grounding, planResponse("what about the draw?", followUp));
    expect(answer).toContain("the draw at 24.4% (fair 4.10)");
  });

  it("CTO A) Kalshi/Polymarket pricing legs carry before-fees decimals without EV", () => {
    const poly = grounding.pricing.markets.find((row) => row.source === "polymarket")!;
    expect(poly.legs.home.decimalOdds).toBeCloseTo(1 / 0.64);
    expect(poly.legs.home.evPct).toBeNull();
    expect(poly.legs.draw.impliedP).toBeCloseTo(0.205);
  });

  it("CTO B) bankroll stake questions get generic unit guidance, not Kelly", () => {
    const answer = composeMatchResponse(
      "I have $1,000 — how much should I stake on Tottenham?",
      grounding,
      planResponse("I have $1,000 — how much should I stake on Tottenham?", { groundingKind: "match" }),
    );
    expect(answer).toMatch(/hear the bankroll/i);
    expect(answer).toMatch(/1[–-]2%/);
    expect(answer).toMatch(/accas|accumulator/i);
    expect(answer).not.toMatch(/\bkelly\b/i);
    expect(answer).not.toContain(STAKE_REFUSAL_SENTENCE);
  });

  it("5) rewriteAnalystIdentity avoids broken subject rewrites", () => {
    expect(normalizeAnalystIdentity("If you trust the model at 59.9%, compare carefully."))
      .toBe("If you trust my model at 59.9%, compare carefully.");
    expect(normalizeAnalystIdentity("That is higher than the model does on the draw."))
      .toBe("That is higher than I do on the draw.");
    expect(normalizeAnalystIdentity("Pundit's model at Tottenham is 59.9%."))
      .toBe("my estimate at Tottenham is 59.9%.");
    expect(normalizeAnalystIdentity("I sheet only the numbers I can source."))
      .toBe("I sheet only the numbers I can source.");
  });
});
