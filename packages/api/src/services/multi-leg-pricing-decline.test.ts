import { describe, expect, it } from "vitest";
import { composeMultiLegPricingDeclineAnswer, isMultiLegPricingQuestion } from "./multi-leg-pricing-decline";

describe("multi-leg pricing decline", () => {
  it("detects parlay, acca, and fold wording", () => {
    expect(isMultiLegPricingQuestion("Build me a 2-leg parlay from today's matches")).toBe(true);
    expect(isMultiLegPricingQuestion("Pick me a 5-fold acca from the next slate")).toBe(true);
    expect(isMultiLegPricingQuestion("In general, how do accas work?")).toBe(false);
  });

  it("detects cross-game named legs", () => {
    expect(isMultiLegPricingQuestion(
      "Spurs to beat Coventry and Arsenal to beat Everton — combined fair price?",
    )).toBe(true);
  });

  it("composes a short decline with featured fixture when available", () => {
    const answer = composeMultiLegPricingDeclineAnswer();
    expect(answer).toMatch(/I price single matches for now/);
    expect(answer).toMatch(/multi-leg pricing is coming soon/);
    expect(answer).toMatch(/Want the numbers on/);
  });
});
