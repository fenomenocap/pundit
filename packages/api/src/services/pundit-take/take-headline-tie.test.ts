import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { format1x2V2Headline, pickHigherGridSide } from "./take-headline";
import { renderTakeProseDeterministic } from "./take-prose";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery, composePunditTakeDeliveryAsync } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { formatTakeOddsTable } from "./take-table";
import { planSeedsJson } from "./take-llm";

const PAL_NEW_PINNED_NOW = new Date("2026-10-18T10:00:00.000Z");
const PAL_NEW_OBSERVED_AT = "2026-10-18T09:30:00.000Z";

const LEVEL_LLM_BYPASS_VARIANTS = [
  "Best value is Crystal Palace at 3.06 against our fair 2.79.",
  "There's value on Crystal Palace at 3.06.",
  "Crystal Palace at 3.06 beats our fair 2.79.",
  "I'd back Crystal Palace at 3.06.",
  "Crystal Palace v Newcastle — level at 36% each; I have no side. Crystal Palace v Newcastle — Crystal Palace to edge it.",
  "Crystal Palace v Newcastle: Crystal Palace to edge it.",
  "Crystal Palace to edge it.",
  "- Crystal Palace are my pick.",
  "I lean Crystal Palace.",
];

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

function nearTiePalNewGrounding() {
  return {
    ...palNewGrounding(),
    pHome: 0.37,
    pDraw: 0.275,
    pAway: 0.355,
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

function expectNearTieLevel(answer: string) {
  expect(answer).toMatch(/level at 37% each/i);
  expect(answer).not.toMatch(/I lean Crystal Palace/i);
  expect(answer).not.toMatch(/back Crystal Palace/i);
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
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key-for-level-bypass");
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

  it("level no-market table shows every outcome within the level threshold", () => {
    const exact = {
      ...palNewGrounding(),
      pricing: { ...palNewGrounding().pricing, markets: [] },
    };
    const exactPlan = buildPunditTakePlan(exact, null);
    expect(exactPlan.levelNoSide).toBe(true);
    const exactTable = formatTakeOddsTable(exactPlan);
    expect(exactTable).toMatch(/\| Crystal Palace \| 36%/);
    expect(exactTable).toMatch(/\| Newcastle \| 36%/);
    expect(exactTable).not.toMatch(/\| Draw \| 28%/);

    const near = {
      ...nearTiePalNewGrounding(),
      pricing: { ...nearTiePalNewGrounding().pricing, markets: [] },
    };
    const nearPlan = buildPunditTakePlan(near, null);
    expect(nearPlan.levelNoSide).toBe(true);
    const nearTable = formatTakeOddsTable(nearPlan);
    expect(nearTable).toMatch(/\| Crystal Palace \| 37%/);
    expect(nearTable).toMatch(/\| Newcastle \| 36%/);
    expect(nearTable).not.toMatch(/\| Draw \| 28%/);
  });

  it("sync near-tie delivery stays level on the no-market table", () => {
    withPalNewPinnedNow(() => {
      const grounding = nearTiePalNewGrounding();
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expectNearTieLevel(delivery.answer);
      expect(delivery.answer).toMatch(/\| Crystal Palace \| 37%/);
      expect(delivery.answer).toMatch(/\| Newcastle \| 36%/);
    });
  });

  it("async near-tie delivery stays level and never calls the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key-for-level-bypass");
    vi.stubEnv("MINIMAX_API_KEY", "");
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Crystal Palace v Newcastle — Crystal Palace at 37%." }],
        stop_reason: "end_turn",
      } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>);
    await withPalNewPinnedNow(async () => {
      const grounding = nearTiePalNewGrounding();
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });
      const delivery = await withPunditTakeRequestScope("v2", () =>
        composePunditTakeDeliveryAsync(question, grounding, plan));
      expect(delivery).not.toBeNull();
      expectNearTieLevel(delivery!.answer);
      expect(create).not.toHaveBeenCalled();
    });
    create.mockRestore();
    vi.unstubAllEnvs();
  });

  it.each(LEVEL_LLM_BYPASS_VARIANTS)(
    "async level 1X2 skips LLM and does not deliver bypass prose: %s",
    async (variant) => {
      vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key-for-level-bypass");
      vi.stubEnv("MINIMAX_API_KEY", "");
      const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() =>
        Promise.resolve({
          content: [{ type: "text", text: `Crystal Palace v Newcastle — level at 36% each; I have no side.\n\n${variant}` }],
          stop_reason: "end_turn",
        } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>);
      await withPalNewPinnedNow(async () => {
        const grounding = palNewGrounding();
        const question = "Crystal Palace v Newcastle — who wins?";
        const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
        const delivery = await withPunditTakeRequestScope("v2", () =>
          composePunditTakeDeliveryAsync(question, grounding, plan));
        expect(delivery).not.toBeNull();
        expect(create).not.toHaveBeenCalled();
        expect(delivery!.answer).toMatch(/level at 36% each/i);
        expect(delivery!.answer).not.toContain(variant);
        expect(delivery!.answer).not.toMatch(/back Crystal Palace|lean Crystal Palace|Best value is|value on Crystal Palace|beats our fair|Crystal Palace to edge it|are my pick/i);
      });
      create.mockRestore();
      vi.unstubAllEnvs();
    },
  );

  it("grid markets under 2 pt gap use level wording", () => {
    const lead = pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: 0.5 },
      { sideKey: "under", label: "Under 2.5", p: 0.49 },
    ]);
    expect(lead.coinFlip).toBe(true);
  });
});
