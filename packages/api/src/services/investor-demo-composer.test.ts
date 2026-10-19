import { describe, expect, it, vi } from "vitest";
import * as slateScan from "./slate-market-scan";
import { sampleAgentFreshness } from "../config/freshness-policy";
import type { Grounding } from "./ask";
import {
  composeMarketComparisonAnswer,
  composeMatchResponse,
  composeOddsProvenanceAnswer,
  STAKE_REFUSAL_SENTENCE,
} from "./response-composer";
import { PARLAY_OUT_OF_SCOPE } from "./basics-answer-voice";
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
    ...sampleMatchContextFields({
      homeElo: 1799,
      awayElo: 1706,
      homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
      awayTable: { position: 8, points: 14, goalDifference: 2, playedGames: 8 },
    }),
  };
}

describe("investor demo composer fixes", () => {
  const grounding = spursCoventryGrounding();

  it("1) market comparison answers with headline numbers, per-side gaps, and provenance", () => {
    const after = composeMarketComparisonAnswer("How does your 1X2 compare to Polymarket?", grounding)!;
    expect(after).toContain("Tottenham v Coventry:");
    expect(after).toContain("Tottenham 59.9% (fair 1.67)");
    expect(after).toContain("the draw 24.4% (fair 4.10)");
    expect(after).toContain("Coventry 15.7% (fair 6.37)");
    expect(after).toContain("Polymarket no-vig as of 18 October 2026");
    expect(after).toContain("Tottenham 64.0% (fair 1.56)");
    expect(after).toContain("fair 1.67 vs market 1.56 (before fees)");
    expect(after).toContain("gap -4.1 pts");
    expect(after).toContain("Provenance:");
    expect(after).not.toMatch(/\bEV\b/);
    expect(after).not.toMatch(/\bedge\b/i);
    const focused = composeMarketComparisonAnswer("What is the edge on Coventry?", grounding)!;
    expect(focused.indexOf("Coventry:")).toBeLessThan(focused.indexOf("Tottenham:"));
  });

  it("2) odds provenance route names feeds, model version, and as-of times", () => {
    const question = "Where do your odds come from and how fresh are they?";
    expect(planResponse(question, { groundingKind: "match" }).mode).toBe("odds-provenance");
    const after = composeOddsProvenanceAnswer(grounding);
    expect(after).toContain("clubelo@1:1da9aa95abcd0001");
    expect(after).toContain("Polymarket (18 October 2026)");
    expect(after).toContain("market odds 18 October 2026");
    expect(after).toContain("Lean:");
    expect(after).toContain("Provenance:");
  });

  it("3) BTTS and likeliest score use basics voice (headline, lean, provenance)", () => {
    const bttsAfter = composeMatchResponse("Both teams to score?", grounding, planResponse("Both teams to score?", { groundingKind: "match" }));
    expect(bttsAfter).toContain("BTTS yes is 52.0% (fair 1.92)");
    expect(bttsAfter).toContain("BTTS no is 48.0% (fair 2.08)");
    expect(bttsAfter).toContain("Lean:");
    expect(bttsAfter).toContain("Provenance:");

    const scoreAfter = composeMatchResponse("What is the most likely score?", grounding, planResponse("What is the most likely score?", { groundingKind: "match" }));
    expect(scoreAfter).toContain("1-1 the likeliest scoreline at 11.6% (fair 8.62)");
    expect(scoreAfter).toContain("Lean:");
  });

  it("adds one table-vs-Elo line when league rank contradicts the model favourite", () => {
    const answer = composeMatchResponse(
      "What are the 1X2 odds?",
      grounding,
      planResponse("What are the 1X2 odds?", { groundingKind: "match" }),
    );
    expect(answer).toMatch(/20th on 3 pts/);
    expect(answer).toMatch(/Elo \(1799 v 1706\)/);
    expect(answer).toMatch(/home advantage/);
  });

  it("4) pricing follow-ups with history stay on the composer, not tactics LLM route", () => {
    const followUp = { groundingKind: "match" as const, hasHistory: true };
    expect(planResponse("what about the draw?", followUp).mode).toBe("pricing-desk");
    expect(planResponse("What about over 2.5?", followUp).mode).toBe("totals");
    const answer = composeMatchResponse("what about the draw?", grounding, planResponse("what about the draw?", followUp));
    expect(answer).toContain("The draw is 24.4% (fair 4.10)");
    expect(answer).toContain("Lean:");
  });

  it("CTO A) Kalshi/Polymarket pricing legs carry before-fees decimals without EV", () => {
    const poly = grounding.pricing.markets.find((row) => row.source === "polymarket")!;
    expect(poly.legs.home.decimalOdds).toBeCloseTo(1 / 0.64);
    expect(poly.legs.home.evPct).toBeNull();
    expect(poly.legs.draw.impliedP).toBeCloseTo(0.205);
  });

  it("best value today uses the largest slate gap without edge language", () => {
    vi.spyOn(slateScan, "largestSlateModelMarketGapForDemo").mockReturnValue({
      slateLabel: "today (18 October 2026)",
      highlight: {
        fixtureLabel: "Tottenham v Coventry",
        fixtureDay: "2026-10-18",
        source: "polymarket",
        observedAt: "2026-10-18T12:00:00.000Z",
        outcome: "home",
        label: "Tottenham",
        modelPercent: 59.9,
        marketPercent: 64,
        gapPoints: -4.1,
      },
    });
    const answer = composeMatchResponse(
      "What is the best value today on the slate?",
      grounding,
      planResponse("What is the best value today on the slate?", { groundingKind: "match" }),
    );
    expect(planResponse("What is the best value today on the slate?", { groundingKind: "match" }).mode)
      .toBe("slate-best-gap");
    expect(answer).toContain("today (18 October 2026)");
    expect(answer).toContain("Tottenham v Coventry");
    expect(answer).toContain("gap -4.1 pts");
    expect(answer).not.toMatch(/\bedge\b/i);
    vi.restoreAllMocks();
  });

  it("parlay or acca questions are out of scope on this desk", () => {
    const answer = composeMatchResponse(
      "Guarantee me a winner on this acca",
      grounding,
      planResponse("Guarantee me a winner on this acca", { groundingKind: "match" }),
    );
    expect(answer).toBe(PARLAY_OUT_OF_SCOPE);
  });

  it("guarantee winner demand shows probabilities without parlay copy", () => {
    const answer = composeMatchResponse(
      "Guarantee me a winner",
      grounding,
      planResponse("Guarantee me a winner", { groundingKind: "match" }),
    );
    expect(answer).toMatch(/can.t guarantee a winner/i);
    expect(answer).toMatch(/59\.9%|Tottenham/);
    expect(answer).not.toMatch(/Accas multiply risk/i);
    expect(answer).toMatch(/18\+/);
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
    expect(answer).toContain("Provenance:");
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
