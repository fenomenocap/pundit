import { describe, expect, it } from "vitest";
import type { Grounding } from "../ask";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import { buildPunditTakePlan } from "./take-plan";
import {
  applyV2ProseHygiene,
  sentenceStatesUpsetFraming,
  sentenceStatesVagueFormGenerality,
  stripLeadingContrastConnective,
  VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS,
} from "./take-v2-prose-hygiene";
import { polishTakeProseLine, repairIncompleteEvenClause } from "./take-prose-polish";
import { joinBodySentencesFromPlan } from "./take-prose";
import type { PunditTakePlan } from "./types";

function groundingWithTableAndForm(
  home: string,
  away: string,
  homeTable: { position: number; points: number },
  awayTable: { position: number; points: number },
  homeForm: Array<"W" | "D" | "L">,
  awayForm: Array<"W" | "D" | "L">,
  probs: { pHome: number; pDraw: number; pAway: number },
  fixtureId = "eng.1:test",
): Grounding {
  const { pHome, pDraw, pAway } = probs;
  const observedAt = "2026-10-20T09:00:00.000Z";
  return {
    kind: "match",
    fixtureId: `espn:${fixtureId}`,
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-20T15:00:00.000Z",
    stage: "Regular Season",
    home,
    away,
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId,
      home,
      away,
      kickoff: "2026-10-20T15:00:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness({ modelLastUpdated: observedAt }),
    ...sampleMatchContextFields({
      homeTable: { ...homeTable, goalDifference: 0, playedGames: 8 },
      awayTable: { ...awayTable, goalDifference: 0, playedGames: 8 },
      homeForm,
      awayForm,
    }),
  };
}

describe("Sweep 12 guards", () => {
  it("drops vague negative results copy when last-five points exceed 4 (Spurs DDLDW)", () => {
    const grounding = groundingWithTableAndForm(
      "Tottenham",
      "Aston Villa",
      { position: 8, points: 11 },
      { position: 5, points: 14 },
      ["D", "D", "L", "D", "W"],
      ["W", "W", "L", "D", "W"],
      { pHome: 0.38, pDraw: 0.28, pAway: 0.34 },
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.homePoints).toBe(6);
    expect(6).toBeGreaterThan(VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS);
    const slip = "Tottenham have been struggling for results lately";
    expect(sentenceStatesVagueFormGenerality(slip)).toBe(true);
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("repairs incomplete even-clause mid-paragraph after model scrub", () => {
    const paragraph =
      "Ipswich have shown they can find the net even. The value is Forest at 2.43 against our fair 2.10.";
    expect(repairIncompleteEvenClause(paragraph)).toBe(
      "Ipswich have shown they can find the net. The value is Forest at 2.43 against our fair 2.10.",
    );
    const raw = "Ipswich have shown they can find the net even when the model";
    const polished = polishTakeProseLine(raw);
    expect(polished).not.toMatch(/\beven\.\s*$/i);
    expect(polished).toMatch(/find the net\./i);

    const plan = {
      fixtureLabel: "Ipswich v Forest",
      supporting: [{ id: "s1", role: "support", text: raw, fieldPath: "test" }],
      contradicting: [],
    } as unknown as PunditTakePlan;
    const body = joinBodySentencesFromPlan(plan, 2);
    expect(body).not.toMatch(/\bfind the net even\./i);
    expect(body).toMatch(/find the net/i);
  });

  it("drops table upset copy when Forest are the away pick (espn:eng.1:401879253 table)", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 9 },
      { position: 18, points: 5 },
      ["L", "W", "L", "W", "L"],
      ["L", "L", "D", "L", "W"],
      { pHome: 0.28, pDraw: 0.27, pAway: 0.45 },
      "eng.1:401879253",
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.call.outcome).toBe("away");
    const slip =
      "Ipswich are 10th on 9 points, while Forest are 18th on 5, so the league table suggests an upset brewing.";
    expect(sentenceStatesUpsetFraming(slip)).toBe(true);
    expect(applyV2ProseHygiene(slip, plan)).toBe("");
  });

  it("rewrites model scrub into natural first-person prose", () => {
    expect(polishTakeProseLine("My model's edge is small, and the model thinks Spurs are short."))
      .toBe("My edge is small, and I think Spurs are short.");
    expect(polishTakeProseLine("They can score even when the model rates them low."))
      .toBe("They can score even when I rate them low.");
    expect(polishTakeProseLine("the model has Chelsea at 59%."))
      .toBe("I have Chelsea at 59%.");
    expect(polishTakeProseLine("Chelsea are 4th, and the model's edge is small."))
      .toBe("Chelsea are 4th, and my edge is small.");
    expect(polishTakeProseLine("According to the model, Forest look live."))
      .toBe("By my numbers, Forest look live.");
    expect(polishTakeProseLine("The model's numbers favour Forest."))
      .toBe("My numbers favour Forest.");
    expect(polishTakeProseLine("I trust the model here."))
      .toBe("I trust these numbers here.");
    expect(polishTakeProseLine("Our model-only totals say over."))
      .toBe("Our totals say over.");
    expect(polishTakeProseLine("The model is confident here."))
      .toBe("I am confident here.");
    expect(polishTakeProseLine("The model sees value in the draw."))
      .toBe("I see value in the draw.");
  });

  it("does not strip Yet when it is not a leading contrast comma", () => {
    expect(stripLeadingContrastConnective("Yet to win away, Forest need a clean sheet."))
      .toBe("Yet to win away, Forest need a clean sheet.");
    expect(stripLeadingContrastConnective("Yet, Forest have been sharper."))
      .toBe("Forest have been sharper.");
  });

  it("strips a leading However when the prior contrast sentence was dropped", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 9 },
      { position: 18, points: 5 },
      ["L", "W", "L", "W", "L"],
      ["L", "L", "D", "L", "W"],
      { pHome: 0.28, pDraw: 0.27, pAway: 0.45 },
      "eng.1:401879253",
    );
    const plan = buildPunditTakePlan(grounding, null);
    const upset =
      "Ipswich are 10th on 9 points, while Forest are 18th on 5, so the league table suggests an upset brewing.";
    const headline = "Ipswich v Forest — Forest at 46%.";
    const follow = "However, Ipswich have scored 7 goals in their last five league games.";
    const cleaned = applyV2ProseHygiene(`${headline} ${upset} ${follow}`, plan);
    expect(cleaned).toMatch(/^Ipswich v Forest — Forest at 46%\./);
    expect(cleaned).not.toMatch(/\bHowever,/i);
    expect(cleaned).toMatch(/Ipswich have scored 7 goals in their last five league games\.$/);
    expect(stripLeadingContrastConnective("However, Forest press high.")).toBe("Forest press high.");
  });
});
