import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAKE_REFUSAL_SENTENCE } from "../response-composer";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { proseFromTakeAnswer } from "./take-validate";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("Pundit Take v2 policy modes", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const grounding = spursCoventryGrounding();

  function deliver(question: string) {
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    return withPunditTakeRequestScope("v2", () => composePunditTakeDelivery(question, grounding, plan)!);
  }

  it("declines parlays without a table", () => {
    const delivery = deliver("Build me a 2-leg parlay on Spurs and Coventry");
    expect(delivery.answer).toMatch(/Parlays are outside what I answer here right now/i);
    expect(delivery.answer).not.toContain("| Outcome |");
  });

  it("refuses stake sizing and keeps the 1X2 table", () => {
    const delivery = deliver("How much should I stake on Spurs?");
    expect(delivery.answer).toMatch(/won't size a stake/i);
    expect(delivery.answer).toContain(STAKE_REFUSAL_SENTENCE);
    expect(delivery.answer).toContain("| Outcome | Ours |");
    expect(delivery.answer).not.toMatch(/^Lean:/m);
  });

  it("answers guarantee demands with probabilities and 18+ line", () => {
    const delivery = deliver("Guarantee me a winner");
    expect(delivery.answer).toMatch(/can't guarantee a winner/i);
    expect(delivery.answer).toMatch(/Spurs 60%/);
    expect(delivery.answer).toMatch(/18\+/);
    expect(delivery.answer).not.toMatch(/^Lean:/m);
  });

  it("explains odds provenance without Lean labels or vendor names in prose", () => {
    const delivery = deliver("Where do your odds come from?");
    expect(delivery.answer).toMatch(/where the numbers come from/i);
    expect(delivery.answer).toMatch(/footer|timestamps are listed/i);
    expect(delivery.answer).toMatch(/Kalshi as of/);
    expect(proseFromTakeAnswer(delivery.answer)).not.toMatch(/Kalshi|Polymarket|\bratings\b/i);
    expect(delivery.answer).not.toMatch(/^Lean:/m);
  });

  it("handles draw-focused follow-ups with draw headline and table", () => {
    const delivery = deliver("What about the draw?");
    expect(delivery.answer).toMatch(/draw at 24%/);
    expect(delivery.answer).toContain("| Outcome | Ours |");
  });
});
