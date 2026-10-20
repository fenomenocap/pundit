import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponse } from "../response-plan";
import {
  composePunditTakeDelivery,
  composePunditTakeDeliveryAsync,
  PUNDIT_TAKE_V2_COMPOSE_TIMEOUT_MS,
  punditTakeApplies,
} from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const POLICY_PROMPTS = [
  "The draw?",
  "Guarantee me a winner",
  "Where do your odds come from?",
] as const;

describe("take v2 demo fixes (e)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes draw, guarantee, and provenance to v2 on every priced fixture", () => {
    const groundings = [spursCoventryGrounding(), chelseaTottenhamGrounding()];
    for (const grounding of groundings) {
      for (const question of POLICY_PROMPTS) {
        const plan = planResponse(question, {
          groundingKind: "match",
          hasCompleteMarket1x2: true,
          hasHistory: false,
        });
        expect(punditTakeApplies(plan, question)).toBe(true);
        const delivery = withPunditTakeRequestScope("v2", () =>
          composePunditTakeDelivery(question, grounding, plan)!);
        expect(delivery.answer.trim().length).toBeGreaterThan(20);
        expect(delivery.answer).not.toMatch(/captured decimal line before I can print EV%/i);
        expect(delivery.answer).toMatch(/\n\nModel /);
      }
    }
  });

  it("falls back to minimal take after the v2 compose timeout", async () => {
    const takeLlm = await import("./take-llm");
    vi.spyOn(takeLlm, "renderTakeProse").mockImplementation(
      () => new Promise<string>(() => {}),
    );
    const grounding = spursCoventryGrounding();
    const question = "Why?";
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      hasHistory: true,
    });
    const pending = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDeliveryAsync(question, grounding, plan));
    await vi.advanceTimersByTimeAsync(PUNDIT_TAKE_V2_COMPOSE_TIMEOUT_MS + 50);
    const delivery = await pending;
    expect(delivery?.answer.trim().length).toBeGreaterThan(20);
    expect(delivery?.answer).toMatch(/\| Outcome \| Ours \|/);
    expect(delivery?.answer).toMatch(/\n\nModel /);
  });
});
