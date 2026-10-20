import { describe, expect, it } from "vitest";
import { sampleMatchContextFields } from "../match-context";
import { buildPunditTakePlan } from "./take-plan";
import { applyV2TakeProseGuards, buildTakeNumericFacts } from "./take-number-check";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("take v2 number check (b)", () => {
  it("drops a sentence whose points-clear gap does not match computed table facts", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      home: "Brentford",
      away: "Hull",
      ...sampleMatchContextFields({
        homeTable: { position: 6, points: 10, goalDifference: 2, playedGames: 8 },
        awayTable: { position: 9, points: 9, goalDifference: -1, playedGames: 8 },
      }),
    };
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.table.pointsClear).toBe(1);
    const prose = [
      "Brentford sit 6th on 10 points, three clear of 9th-placed Hull on 9.",
      "Hull travel with something to prove.",
    ].join(" ");
    const guarded = applyV2TakeProseGuards(prose, plan);
    expect(guarded).not.toMatch(/three clear/i);
    expect(guarded).toMatch(/something to prove/i);
  });

  it("allows a one-clear gap phrase when it matches numericFacts", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      home: "Brentford",
      away: "Hull",
      ...sampleMatchContextFields({
        homeTable: { position: 6, points: 10, goalDifference: 2, playedGames: 8 },
        awayTable: { position: 9, points: 9, goalDifference: -1, playedGames: 8 },
      }),
    };
    const plan = buildPunditTakePlan(grounding, null);
    const phrase = "Brentford sit 6th on 10 points, one clear of 9th-placed Hull on 9.";
    expect(applyV2TakeProseGuards(phrase, plan)).toMatch(/one clear/i);
  });
});

describe("take v2 toss-up enforcement (c)", () => {
  it("drops coin-flip language when the top-two 1X2 gap is 17+ points", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pHome: 0.45,
      pDraw: 0.28,
      pAway: 0.27,
    };
    const plan = buildPunditTakePlan(grounding, null);
    const facts = buildTakeNumericFacts(grounding, null, plan.rows, plan.gridCall, plan.gridRows);
    expect(facts.topTwoGapPoints).toBeGreaterThanOrEqual(17);
    expect(facts.coinFlip).toBe(false);
    const prose = "Fulham at 45% in my read, so this is a coin-flip.";
    expect(applyV2TakeProseGuards(prose, plan)).toBe("");
  });

  it("keeps toss-up language when the top-two outcomes are within 2 points", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pHome: 0.34,
      pDraw: 0.33,
      pAway: 0.33,
    };
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.numericFacts?.coinFlip).toBe(true);
    const prose = "On the 1X2 this is a genuine toss-up between the top two.";
    expect(applyV2TakeProseGuards(prose, plan)).toMatch(/toss-up/i);
  });
});
