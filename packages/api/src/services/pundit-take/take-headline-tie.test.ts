import { describe, expect, it, vi } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { format1x2V2Headline, pickHigherGridSide } from "./take-headline";
import { renderTakeProseDeterministic } from "./take-prose";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery, composePunditTakeDeliveryAsync } from "./compose";
import { withPunditTakeRequestScope } from "./flags";

function palNewGrounding() {
  return {
    ...chelseaTottenhamGrounding(),
    home: "Crystal Palace",
    away: "Newcastle",
    pHome: 0.3587,
    pDraw: 0.28,
    pAway: 0.3587,
    pricing: {
      ...chelseaTottenhamGrounding().pricing,
      markets: chelseaTottenhamGrounding().pricing.markets.map((row) => ({
        ...row,
        observedAt: "2026-10-18T09:30:00.000Z",
      })),
    },
  };
}

function expectLevelPalNewProse(prose: string, answer?: string) {
  expect(prose).toMatch(/level at 36% each/i);
  expect(prose).toMatch(/no side/i);
  expect(prose).not.toMatch(/Crystal Palace at 36%/i);
  expect(prose).not.toMatch(/The value is Crystal Palace/i);
  expect(prose).not.toMatch(/I'd shift if/i);
  if (answer) {
    expect(answer).toMatch(/level at 36% each/i);
    expect(answer).not.toMatch(/I'd shift if/i);
    expect(answer).not.toMatch(/The value is Crystal Palace/i);
  }
}

describe("1x2 level headlines", () => {
  it("Pal–New real tied pct does not name a side", () => {
    const grounding = palNewGrounding();
    const headline = format1x2V2Headline("Crystal Palace v Newcastle", grounding, "full");
    expect(headline).toMatch(/level at 36% each/i);
    expect(headline).toMatch(/no side/i);
    expect(headline).not.toMatch(/Crystal Palace at/i);
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.levelNoSide).toBe(true);
    expect(plan.valueLeg).toBeNull();
    expect(plan.flipCondition).toBeNull();
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expectLevelPalNewProse(prose);
  });

  it("sync v2 delivery keeps Pal–New level with no value or flip", () => {
    const grounding = palNewGrounding();
    const question = "Crystal Palace v Newcastle — who wins?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expectLevelPalNewProse(delivery.answer, delivery.answer);
  });

  it("async v2 fallback path keeps Pal–New level with no value or flip", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("MINIMAX_API_KEY", "");
    const grounding = palNewGrounding();
    const question = "Crystal Palace v Newcastle — who wins?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = await withPunditTakeRequestScope("v2", () =>
      composePunditTakeDeliveryAsync(question, grounding, plan));
    expect(delivery).not.toBeNull();
    expectLevelPalNewProse(delivery!.answer, delivery!.answer);
    vi.unstubAllEnvs();
  });

  it("grid markets under 2 pt gap use level wording", () => {
    const lead = pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: 0.5 },
      { sideKey: "under", label: "Under 2.5", p: 0.49 },
    ]);
    expect(lead.coinFlip).toBe(true);
  });
});
