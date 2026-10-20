import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { fairDecimalFromRawProb, modelGapPointsVsBestDecimal } from "./take-maths";
import { buildPunditTakePlan } from "./take-plan";
import { renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { renderTakeProseDeterministic } from "./take-prose";
import { punditTakeApplies } from "./compose";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

describe("Sweep 1 fix pack", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  const legacyPrompts = [
    "What would flip it?",
    "Why?",
    "The draw?",
    "Guarantee me a winner",
    "Where do your odds come from?",
  ] as const;

  for (const question of legacyPrompts) {
    it(`routes v2 header prompt without legacy EV fallback: ${question}`, () => {
      const grounding = spursCoventryGrounding();
      const plan = planResponse(question, {
        groundingKind: "match",
        hasCompleteMarket1x2: true,
        hasHistory: question === "Why?",
      });
      expect(punditTakeApplies(plan, question)).toBe(true);
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expect(delivery.answer).not.toMatch(/captured decimal line before I can print EV%/i);
      expect(delivery.answer.length).toBeGreaterThan(20);
    });
  }

  it("never returns an empty v2 answer (headline, table, footer minimum)", () => {
    const grounding = spursCoventryGrounding();
    const question = "Why?";
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      hasHistory: true,
      v2PlayPassResolver: false,
    });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer.trim().length).toBeGreaterThan(20);
    expect(delivery.answer).toMatch(/\| Outcome \| Ours \|/);
    expect(delivery.answer).toMatch(/\n\nModel /);
  });

  it("never returns empty prose when traceability strips supporting lines", () => {
    const grounding = spursCoventryGrounding();
    const question = "Why?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true, hasHistory: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer.split("\n\nModel ")[0]?.trim().length).toBeGreaterThan(10);
  });

  it("flip line avoids price restatements and uses goal language on totals", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
    expect(plan.flipCondition?.text).not.toMatch(/fair at the books|shortens toward/i);
    expect(plan.flipCondition?.text).toMatch(/I'd shift if .+(goal|first hour|first half|scoring|league)/i);
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/I'd shift if/i);
    expect(prose).not.toMatch(/What flips it:/i);
  });

  it("fair odds gap uses best column decimal", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const drawRow = plan.rows.find((r) => r.outcome === "draw")!;
    const gap = modelGapPointsVsBestDecimal(grounding.pDraw, drawRow.bestDecimal);
    expect(gap).not.toBeNull();
    expect(gap!).toBeCloseTo((grounding.pDraw - 1 / 4.81) * 100, 1);
    const prose = renderFairOddsTakeProse(plan, grounding);
    expect(prose).toMatch(/−?\d+\.\d pts vs best offered/);
    expect(prose).not.toMatch(/−5\.3 pts/);
  });

  it("fair decimal uses unrounded probability", () => {
    expect(fairDecimalFromRawProb(0.0605)).toBe("16.53");
  });

  it("under headline drops high-total supporting copy", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pOver2_5: 0.42,
      pUnder2_5: 0.58,
      totalXg: 3.1,
      goalCalibration: { methodId: "outcome-anchored-shrunk-goals-v2", artifactId: "t", artifactSha256: "abc" },
    };
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
    expect(plan.gridCall?.headlineLabel).toBe("Under 2.5");
    expect(plan.supporting.some((p) => /close to three goals/i.test(p.text))).toBe(false);
  });

  it("capitalizes prose and removes my model phrasing", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/^[A-Z]/);
    expect(prose).not.toMatch(/\bmy model\b/i);
  });

  it("legacy default path stays byte-identical without v2 header", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const prev = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
    try {
      const legacy = composeMatchResponse(question, grounding, plan);
      const scoped = withPunditTakeRequestScope(null, () => composeMatchResponse(question, grounding, plan));
      expect(scoped).toBe(legacy);
    } finally {
      if (prev === undefined) delete process.env.PUNDIT_TAKE_V2;
      else process.env.PUNDIT_TAKE_V2 = prev;
    }
  });
});
