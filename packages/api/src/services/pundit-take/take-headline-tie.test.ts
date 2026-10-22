import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { buildPunditTakePlan } from "./take-plan";
import { format1x2V2Headline, formatLevel1x2SuppressedHeadline, pickHigherGridSide } from "./take-headline";
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

/** Raw gap 1.99 pt (level) but rounded ints 37 vs 35 — table must use raw band, not rounded. */
function roundingEdgePalNewGrounding() {
  return {
    ...palNewGrounding(),
    pHome: 0.365,
    pDraw: 0.28,
    pAway: 0.3451,
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
  expect(answer).toMatch(/level, 37% v 36%; I have no side/i);
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
    const exactTable = formatTakeOddsTable(exactPlan, exact);
    expect(exactTable).toMatch(/\| Crystal Palace \| 36%/);
    expect(exactTable).toMatch(/\| Newcastle \| 36%/);
    expect(exactTable).not.toMatch(/\| Draw \| 28%/);

    const near = {
      ...nearTiePalNewGrounding(),
      pricing: { ...nearTiePalNewGrounding().pricing, markets: [] },
    };
    const nearPlan = buildPunditTakePlan(near, null);
    expect(nearPlan.levelNoSide).toBe(true);
    const nearTable = formatTakeOddsTable(nearPlan, near);
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

  it("rounding edge level table shows both sides when raw gap is under 2 pt but rounded ints differ", () => {
    const grounding = roundingEdgePalNewGrounding();
    const noMarket = {
      ...grounding,
      pricing: { ...grounding.pricing, markets: [] },
    };
    const plan = buildPunditTakePlan(noMarket, null);
    expect(plan.levelNoSide).toBe(true);
    const table = formatTakeOddsTable(plan, noMarket);
    expect(table).toMatch(/\| Crystal Palace \| 37%/);
    expect(table).toMatch(/\| Newcastle \| 35%/);
    expect(table).not.toMatch(/\| Draw \| 28%/);
  });

  it("sync rounding-edge delivery keeps both level sides on the no-market table", () => {
    withPalNewPinnedNow(() => {
      const base = roundingEdgePalNewGrounding();
      const grounding = {
        ...base,
        pricing: { ...base.pricing, markets: [] },
      };
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expect(delivery.answer).toMatch(/level, 37% v 35%; I have no side/i);
      expect(delivery.answer).toMatch(/\| Crystal Palace \| 37%/);
      expect(delivery.answer).toMatch(/\| Newcastle \| 35%/);
      expect(delivery.answer).not.toMatch(/\| Draw \| 28%/);
    });
  });

  it("async rounding-edge delivery stays level and never calls the LLM", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key-for-level-bypass");
    vi.stubEnv("MINIMAX_API_KEY", "");
    const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Crystal Palace v Newcastle — Crystal Palace at 37%." }],
        stop_reason: "end_turn",
      } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>);
    await withPalNewPinnedNow(async () => {
      const base = roundingEdgePalNewGrounding();
      const grounding = {
        ...base,
        pricing: { ...base.pricing, markets: [] },
      };
      const question = "Crystal Palace v Newcastle — who wins?";
      const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: false });
      const delivery = await withPunditTakeRequestScope("v2", () =>
        composePunditTakeDeliveryAsync(question, grounding, plan));
      expect(delivery).not.toBeNull();
      expect(delivery!.answer).toMatch(/level, 37% v 35%; I have no side/i);
      expect(delivery!.answer).toMatch(/\| Crystal Palace \| 37%/);
      expect(delivery!.answer).toMatch(/\| Newcastle \| 35%/);
      expect(create).not.toHaveBeenCalled();
    });
    create.mockRestore();
    vi.unstubAllEnvs();
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

function homeDrawNearTieGrounding() {
  return { ...palNewGrounding(), pHome: 0.36, pDraw: 0.35, pAway: 0.29 };
}

function awayDrawNearTieGrounding() {
  return { ...palNewGrounding(), pHome: 0.28, pDraw: 0.355, pAway: 0.365 };
}

const SIDE_V_DRAW_CASES = [
  { name: "home", club: "Crystal Palace", other: "Newcastle", grounding: homeDrawNearTieGrounding },
  { name: "away", club: "Newcastle", other: "Crystal Palace", grounding: awayDrawNearTieGrounding },
] as const;

describe("level 1X2 suppressed headline wording (CTO wording 21 Oct)", () => {
  const fixture = "Crystal Palace v Newcastle";

  it("equal rounded values keep 'level at N% each'", () => {
    expect(formatLevel1x2SuppressedHeadline(fixture, palNewGrounding(), "full"))
      .toBe("Crystal Palace v Newcastle — level at 36% each; I have no side.");
    expect(formatLevel1x2SuppressedHeadline(fixture, palNewGrounding(), "why"))
      .toBe("On Crystal Palace v Newcastle, the sides are level at 36% each; I have no side.");
  });

  it("equal rounded values from unequal raw probabilities stay 'level at N% each'", () => {
    const grounding = { ...palNewGrounding(), pHome: 0.364, pDraw: 0.28, pAway: 0.356 };
    expect(format1x2V2Headline(fixture, grounding, "full"))
      .toBe("Crystal Palace v Newcastle — level at 36% each; I have no side.");
  });

  it("unequal rounded values show higher first", () => {
    expect(format1x2V2Headline(fixture, nearTiePalNewGrounding(), "full"))
      .toBe("Crystal Palace v Newcastle — level, 37% v 36%; I have no side.");
    const awayHigher = { ...palNewGrounding(), pHome: 0.355, pDraw: 0.275, pAway: 0.37 };
    expect(format1x2V2Headline(fixture, awayHigher, "full"))
      .toBe("Crystal Palace v Newcastle — level, 37% v 36%; I have no side.");
  });

  it("rounding edge 0.365 v 0.3451 renders 37% v 35%", () => {
    expect(format1x2V2Headline(fixture, roundingEdgePalNewGrounding(), "full"))
      .toBe("Crystal Palace v Newcastle — level, 37% v 35%; I have no side.");
  });

  it("unequal rounded why-variant", () => {
    expect(format1x2V2Headline(fixture, nearTiePalNewGrounding(), "why"))
      .toBe("On Crystal Palace v Newcastle, it's level, 37% v 36%; I have no side.");
    const plan = buildPunditTakePlan(nearTiePalNewGrounding(), null, { now: PAL_NEW_PINNED_NOW });
    const prose = renderTakeProseDeterministic(plan, "why", nearTiePalNewGrounding());
    expect(prose).toMatch(/On Crystal Palace v Newcastle, it's level, 37% v 36%; I have no side\./);
  });

  it("gap at the threshold still names the side", () => {
    const grounding = { ...palNewGrounding(), pHome: 0.38, pDraw: 0.36, pAway: 0.26 };
    expect(format1x2V2Headline(fixture, grounding, "full"))
      .toBe("Crystal Palace v Newcastle — Crystal Palace at 38%.");
  });

  describe.each(SIDE_V_DRAW_CASES)("$name side v draw near-tie", ({ club, other, grounding }) => {
    const fullHeadline = `Crystal Palace v Newcastle — ${club} or a draw. I can't split them, so no side.`;
    const whyHeadline = `On Crystal Palace v Newcastle, ${club} or a draw. I can't split them, so no side.`;

    it("formats full and why headlines", () => {
      expect(formatLevel1x2SuppressedHeadline(fixture, grounding(), "full")).toBe(fullHeadline);
      expect(format1x2V2Headline(fixture, grounding(), "full")).toBe(fullHeadline);
      expect(format1x2V2Headline(fixture, grounding(), "why")).toBe(whyHeadline);
    });

    it("deterministic renderer uses the side-v-draw headline (full and why)", () => {
      const g = grounding();
      const plan = buildPunditTakePlan(g, null, { now: PAL_NEW_PINNED_NOW });
      expect(plan.levelNoSide).toBe(true);
      expect(plan.valueLeg).toBeNull();
      expect(plan.flipCondition).toBeNull();
      expect(renderTakeProseDeterministic(plan, "full", g).startsWith(fullHeadline)).toBe(true);
      expect(renderTakeProseDeterministic(plan, "why", g).startsWith(whyHeadline)).toBe(true);
    });

    it("sync v2 delivery uses the side-v-draw headline", () => {
      withPalNewPinnedNow(() => {
        const g = grounding();
        const question = "Crystal Palace v Newcastle — who wins?";
        const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
        const delivery = withPunditTakeRequestScope("v2", () =>
          composePunditTakeDelivery(question, g, plan)!);
        expect(delivery.answer).toContain(fullHeadline);
        expect(delivery.answer).not.toMatch(new RegExp(`${club} at \\d+%`));
        expect(delivery.answer).not.toMatch(new RegExp(`${other} at \\d+%`));
        expect(delivery.answer).not.toMatch(/I'd shift if|The value is/i);
      });
    });

    it("async v2 delivery uses the side-v-draw headline and never calls the LLM", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key-for-level-bypass");
      vi.stubEnv("MINIMAX_API_KEY", "");
      const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() =>
        Promise.resolve({
          content: [{ type: "text", text: `Crystal Palace v Newcastle — ${club} at 36%.` }],
          stop_reason: "end_turn",
        } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>);
      await withPalNewPinnedNow(async () => {
        const g = grounding();
        const question = "Crystal Palace v Newcastle — who wins?";
        const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
        const delivery = await withPunditTakeRequestScope("v2", () =>
          composePunditTakeDeliveryAsync(question, g, plan));
        expect(delivery).not.toBeNull();
        expect(delivery!.answer).toContain(fullHeadline);
        expect(delivery!.answer).not.toMatch(new RegExp(`${club} at \\d+%`));
        expect(create).not.toHaveBeenCalled();
      });
      create.mockRestore();
      vi.unstubAllEnvs();
    });
  });
});
