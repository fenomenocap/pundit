import { describe, expect, it, vi } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { format1x2V2Headline, pickHigherGridSide } from "./take-headline";
import { renderTakeProseDeterministic } from "./take-prose";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery, composePunditTakeDeliveryAsync } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { formatTakeOddsTable } from "./take-table";
import { finalizeLevelNoSideLlmProse, planSeedsJson } from "./take-llm";
import * as takeLlm from "./take-llm";

const PAL_NEW_PINNED_NOW = new Date("2026-10-18T10:00:00.000Z");
const PAL_NEW_OBSERVED_AT = "2026-10-18T09:30:00.000Z";

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
        observedAt: PAL_NEW_OBSERVED_AT,
      })),
    },
  };
}

function withPalNewPinnedNow<T>(run: () => T): T {
  vi.useFakeTimers({ now: PAL_NEW_PINNED_NOW });
  try {
    return run();
  } finally {
    vi.useRealTimers();
  }
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
    const plan = buildPunditTakePlan(grounding, null, { now: PAL_NEW_PINNED_NOW });
    const seeds = JSON.parse(planSeedsJson(plan));
    expect(seeds.levelNoSide).toBe(true);
    expect(seeds.tiedPct).toBe(36);
    expect(seeds.callPct).toBe(36);
    expect(seeds.call).toBe("level (no side)");
    const headline = format1x2V2Headline("Crystal Palace v Newcastle", grounding, "full");
    expect(headline).toMatch(/level at 36% each/i);
    expect(headline).toMatch(/no side/i);
    expect(headline).not.toMatch(/Crystal Palace at/i);
    expect(plan.levelNoSide).toBe(true);
    expect(plan.valueLeg).toBeNull();
    expect(plan.flipCondition).toBeNull();
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expectLevelPalNewProse(prose);
  });

  it("sync v2 delivery keeps Pal–New level with no value or flip", () => {
    withPalNewPinnedNow(() => {
      const grounding = palNewGrounding();
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
      const planJson = buildPunditTakePlan(grounding, null, { now: PAL_NEW_PINNED_NOW });
      expect(planJson.hasCompleteMarket).toBe(true);
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expectLevelPalNewProse(delivery.answer, delivery.answer);
    });
  });

  it("async v2 fallback path keeps Pal–New level with no value or flip", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("MINIMAX_API_KEY", "");
    await withPalNewPinnedNow(async () => {
      const grounding = palNewGrounding();
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
      const delivery = await withPunditTakeRequestScope("v2", () =>
        composePunditTakeDeliveryAsync(question, grounding, plan));
      expect(delivery).not.toBeNull();
      expectLevelPalNewProse(delivery!.answer, delivery!.answer);
    });
    vi.unstubAllEnvs();
  });

  it("level no-market table shows both tied sides, not only the draw row", () => {
    const grounding = {
      ...palNewGrounding(),
      pricing: { ...palNewGrounding().pricing, markets: [] },
    };
    const plan = buildPunditTakePlan(grounding, null);
    expect(plan.levelNoSide).toBe(true);
    expect(plan.hasCompleteMarket).toBe(false);
    const table = formatTakeOddsTable(plan);
    expect(table).toMatch(/\| Crystal Palace \| 36%/);
    expect(table).toMatch(/\| Newcastle \| 36%/);
    expect(table).not.toMatch(/\| Draw \| 28%/);
  });

  it("rejects level LLM output that names a side as value", async () => {
    vi.spyOn(takeLlm, "renderTakeProseWithLlmDetailed").mockImplementation(async (plan, variant, grounding) => {
      const raw = "Crystal Palace v Newcastle — Crystal Palace at 36%. The value is Crystal Palace at 3.06 against our fair 2.79.";
      const guarded = finalizeLevelNoSideLlmProse(raw, plan, variant ?? "full", grounding);
      if (!guarded) {
        return { prose: null, dropped: ["llm-rejected:level-side-call"], source: "none" };
      }
      return { prose: guarded, dropped: [], source: "llm" };
    });
    const grounding = palNewGrounding();
    const question = "Crystal Palace v Newcastle — who wins?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = await withPunditTakeRequestScope("v2", () =>
      composePunditTakeDeliveryAsync(question, grounding, plan));
    expect(delivery).not.toBeNull();
    expect(delivery!.answer).not.toMatch(/The value is Crystal Palace/i);
    expect(delivery!.answer).toMatch(/level at 36% each/i);
    vi.restoreAllMocks();
  });

  it("grid markets under 2 pt gap use level wording", () => {
    const lead = pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: 0.5 },
      { sideKey: "under", label: "Under 2.5", p: 0.49 },
    ]);
    expect(lead.coinFlip).toBe(true);
  });
});
