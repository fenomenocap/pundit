import { describe, expect, it, vi } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { inferUserLineFromQuestion } from "../response-correctness";
import { asksPassOrPlayQuestion, planResponse } from "../response-plan";
import { withPunditTakeRequestScope } from "./flags";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";

describe("Take v2 play/pass resolver gating (header only)", () => {
  it("legacy path: play or pass Chelsea at 1.70 matches pre-#351 captured-line behaviour", () => {
    const question = "play or pass Chelsea at 1.70";
    const grounding = chelseaTottenhamGrounding();
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      v2PlayPassResolver: false,
    });
    expect(asksPassOrPlayQuestion(question, false)).toBe(false);
    expect(plan.mode).not.toBe("user-line");
    expect(inferUserLineFromQuestion(question, grounding.home, grounding.away)).toBeUndefined();

    const prev = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
    try {
      const legacy = composeMatchResponse(question, grounding, plan);
      const scoped = withPunditTakeRequestScope("legacy", () => composeMatchResponse(question, grounding, plan));
      expect(scoped).toBe(legacy);
      expect(legacy).toMatch(/I only price a line you enter in the line field/i);
      expect(legacy).not.toMatch(/\bI pass on\b|\bI play\b/i);
    } finally {
      if (prev === undefined) delete process.env.PUNDIT_TAKE_V2;
      else process.env.PUNDIT_TAKE_V2 = prev;
    }
  });

  it("header v2 enables play-or-pass word order and line inference", () => {
    const question = "Chelsea at 1.70, play or pass?";
    const grounding = chelseaTottenhamGrounding();
    withPunditTakeRequestScope("v2", () => {
      expect(asksPassOrPlayQuestion(question, true)).toBe(true);
      expect(inferUserLineFromQuestion(question, grounding.home, grounding.away)).toEqual({
        outcome: "home",
        decimalOdds: 1.7,
      });
    });
  });

  it("no header keeps the legacy play-or-pass resolver", () => {
    const question = "Chelsea at 1.70, play or pass?";
    const grounding = chelseaTottenhamGrounding();
    const fromDefault = withPunditTakeRequestScope(null, () =>
      inferUserLineFromQuestion(question, grounding.home, grounding.away));
    expect(fromDefault).toBeUndefined();
  });
});
