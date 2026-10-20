import { describe, expect, it } from "vitest";
import type { Grounding } from "../ask";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import { buildPunditTakePlan } from "./take-plan";
import {
  applyV2ProseHygiene,
  sentenceComparesRecentForm,
  sentenceStatesLast5FormRecordClaim,
  sentenceStatesVagueFormGenerality,
  VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS,
  VAGUE_POSITIVE_FORM_MIN_LAST5_POINTS,
} from "./take-v2-prose-hygiene";

function groundingWithTableAndForm(
  home: string,
  away: string,
  homeTable: { position: number; points: number },
  awayTable: { position: number; points: number },
  homeForm: Array<"W" | "D" | "L">,
  awayForm: Array<"W" | "D" | "L">,
): Grounding {
  const pHome = 0.4;
  const pDraw = 0.28;
  const pAway = 0.32;
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

describe("Take v2 table standing snapshot hygiene", () => {
  it("drops Palace three-points-below Newcastle slip", () => {
    const grounding = groundingWithTableAndForm(
      "Crystal Palace",
      "Newcastle",
      { position: 14, points: 7 },
      { position: 11, points: 8 },
      ["W", "L", "D", "L", "W"],
      ["W", "D", "L", "W", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const slip = "Crystal Palace sit just three points below Newcastle in the league";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("drops Brentford spot-above Hull when places gap is three not one", () => {
    const grounding = groundingWithTableAndForm(
      "Brentford",
      "Hull",
      { position: 6, points: 10 },
      { position: 9, points: 9 },
      ["W", "W", "L", "L", "L"],
      ["W", "L", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const slip = "Brentford sit 6th on 10 points, a spot above Hull who have 9";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("keeps Coventry–Fulham one-point-behind phrase when snapshot matches", () => {
    const grounding = groundingWithTableAndForm(
      "Coventry",
      "Fulham",
      { position: 9, points: 9 },
      { position: 8, points: 10 },
      ["W", "D", "L", "W", "L"],
      ["W", "W", "D", "L", "W"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const line = "just a point behind";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });

  it("keeps Man Utd two-spots-and-one-point-above Bournemouth when snapshot matches", () => {
    const grounding = groundingWithTableAndForm(
      "Man Utd",
      "Bournemouth",
      { position: 5, points: 15 },
      { position: 7, points: 14 },
      ["W", "W", "D", "L", "W"],
      ["W", "L", "W", "D", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const line = "two spots and one point above";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });

  it("drops one place and one point above when Man Utd are two places above Bournemouth", () => {
    const grounding = groundingWithTableAndForm(
      "Man Utd",
      "Bournemouth",
      { position: 5, points: 15 },
      { position: 7, points: 14 },
      ["W", "W", "D", "L", "W"],
      ["W", "L", "W", "D", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(applyV2ProseHygiene("one place and one point above", plan)).toBe("");
    expect(applyV2ProseHygiene("one spot and one point above", plan)).toBe("");
  });

  it("drops possessive Spurs position+points pair when it disagrees with the table", () => {
    const grounding = groundingWithTableAndForm(
      "Tottenham",
      "Coventry",
      { position: 20, points: 3 },
      { position: 16, points: 6 },
      ["L", "L", "L", "D", "W"],
      ["W", "L", "D", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.fixtureLabel).toMatch(/^Spurs v /);
    const slip = "Spurs' 16th on 6";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("keeps Fulham point-behind clause with correct despite-being table attribution", () => {
    const grounding = groundingWithTableAndForm(
      "Coventry",
      "Fulham",
      { position: 8, points: 6 },
      { position: 18, points: 5 },
      ["W", "D", "L", "W", "L"],
      ["L", "D", "L", "W", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const line =
      "Fulham sit just a point behind Coventry in the table despite being 18th on 5 points";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });
});

describe("Take v2 form phrase false positives", () => {
  it("does not treat that gap in form as a form comparison or vague-form claim", () => {
    const line = "that gap in form is the swing factor here";
    expect(sentenceComparesRecentForm(line)).toBe(false);
    expect(sentenceStatesVagueFormGenerality(line)).toBe(false);
    expect(sentenceStatesLast5FormRecordClaim(line)).toBe(false);
  });
});

describe("Take v2 last-five W/D/L and streak hygiene", () => {
  it("drops won three of their last 5 when the snapshot shows two wins", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["W", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.away).toMatchObject({ wins: 2, played: 5 });
    const slip = "Forest have won three of their last 5";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("drops unbeaten-in-last-5 when the snapshot includes a loss", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["D", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    const slip = "Forest have been unbeaten in their last 5";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("keeps winless-in-last-5 when the snapshot has zero wins", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["L", "L", "D", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.away?.wins).toBe(0);
    const line = "Forest have been winless in their last 5";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });
});

describe("Take v2 vague form generality hygiene", () => {
  it("drops Forest competitive-in-most-matches when last-five is 4 pts", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["D", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.awayPoints).toBe(4);
    expect(4).toBeLessThan(VAGUE_POSITIVE_FORM_MIN_LAST5_POINTS);
    const slip = "Forest have been competitive in most matches";
    expect(applyV2ProseHygiene(`${slip}.`, plan)).toBe("");
  });

  it("keeps positive vague form when last-five meets the 7-point threshold", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["W", "W", "D", "W", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.awayPoints).toBeGreaterThanOrEqual(VAGUE_POSITIVE_FORM_MIN_LAST5_POINTS);
    const line = "Forest look in decent form lately";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });

  it("drops negative vague form when last-five is above the 4-point ceiling", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["W", "W", "D", "W", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.awayPoints).toBeGreaterThan(VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS);
    const line = "Forest are struggling for form";
    expect(applyV2ProseHygiene(line, plan)).toBe("");
  });

  it("keeps negative vague form when last-five is at or below 4 points", () => {
    const grounding = groundingWithTableAndForm(
      "Ipswich",
      "Forest",
      { position: 10, points: 10 },
      { position: 12, points: 9 },
      ["L", "W", "L", "W", "L"],
      ["D", "W", "L", "L", "L"],
    );
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.formLast5?.awayPoints).toBeLessThanOrEqual(VAGUE_NEGATIVE_FORM_MAX_LAST5_POINTS);
    const line = "Forest are struggling for form";
    expect(applyV2ProseHygiene(line, plan)).toBe(line);
  });
});
