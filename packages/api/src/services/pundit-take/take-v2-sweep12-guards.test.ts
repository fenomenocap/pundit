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
): Grounding {
  const { pHome, pDraw, pAway } = probs;
  const observedAt = "2026-10-20T09:00:00.000Z";
  return {
    kind: "match",
    fixtureId: "espn:eng.1:test",
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
      fixtureId: "eng.1:test",
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

  it("repairs incomplete even-clause after model scrub in deterministic body assembly", () => {
    const raw = "Ipswich have shown they can find the net even when the model";
    const polished = polishTakeProseLine(raw);
    expect(polished).not.toMatch(/\beven\.\s*$/i);
    expect(polished).toMatch(/find the net\./i);
    expect(repairIncompleteEvenClause("showing they can find the net even.")).toBe(
      "showing they can find the net.",
    );

    const plan = {
      fixtureLabel: "Ipswich v Forest",
      supporting: [{ id: "s1", role: "support", text: raw, fieldPath: "test" }],
      contradicting: [],
    } as unknown as PunditTakePlan;
    const body = joinBodySentencesFromPlan(plan, 2);
    expect(body).not.toMatch(/\beven\.\s*$/i);
    expect(body).toMatch(/find the net/i);
  });

  it("drops upset brewing copy when the headline pick is the table favourite (Ipswich–Forest)", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Nottingham Forest",
      { position: 10, points: 10 },
      { position: 19, points: 4 },
      ["W", "L", "D", "W", "L"],
      ["L", "L", "D", "L", "W"],
      { pHome: 0.52, pDraw: 0.26, pAway: 0.22 },
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.call.outcome).toBe("home");
    const slip = "The league table suggests an upset is brewing";
    expect(sentenceStatesUpsetFraming(slip)).toBe(true);
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });
});
