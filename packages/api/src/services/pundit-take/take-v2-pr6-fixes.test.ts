import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { provenanceBodyFromFooter } from "./take-provenance-voice";
import { buildTakeSourcesFooter } from "./take-sources";
import { proseFromTakeAnswer } from "./take-validate";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("Take v2 PR6 fixes", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z")));
  afterEach(() => vi.useRealTimers());

  const grounding = spursCoventryGrounding();

  function deliver(question: string) {
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    return withPunditTakeRequestScope("v2", () => composePunditTakeDelivery(question, grounding, plan)!);
  }

  it("provenance prose uses pundit voice from footer sources (no model/probabilities)", () => {
    const footer = buildTakeSourcesFooter(grounding, null, Date.now());
    const body = provenanceBodyFromFooter(footer);
    expect(body).toMatch(/My prices come from how I rate each side/i);
    expect(body).toMatch(/live betting markets/i);
    expect(body).toMatch(/listed below/i);
    expect(body).not.toMatch(/\bmodel\b|\bprobabilities\b/i);

    const delivery = deliver("Where do your odds come from?");
    const prose = proseFromTakeAnswer(delivery.answer);
    expect(prose).toMatch(/My prices come from how I rate each side/i);
    expect(prose).not.toMatch(/\bmodel\b|\bprobabilities\b|\bfooter\b/i);
    expect(prose).not.toMatch(/Kalshi|Polymarket|Stake/i);
  });

  it("policy modes omit I'd shift flip closing", () => {
    for (const question of [
      "Guarantee me a winner",
      "Where do your odds come from?",
      "How much should I stake on Spurs?",
      "Build me a 2-leg parlay on Spurs and Coventry",
    ]) {
      const delivery = deliver(question);
      const prose = proseFromTakeAnswer(delivery.answer);
      expect(prose, question).not.toMatch(/I'd shift/i);
    }
  });

  it("guarantee puts a full stop after the 1X2 fair-odds summary", () => {
    const delivery = deliver("Guarantee me a winner");
    const prose = proseFromTakeAnswer(delivery.answer);
    expect(prose).toMatch(/\(fair [\d.]+\)\.\s+Nothing is guaranteed/i);
  });

  it("totals phrasing opens with headline and closes with one flip", () => {
    const question = "Over/under 2.5 in Hull City vs Brentford?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    expect(plan.mode).toBe("totals");
    const delivery = deliver(question);
    const prose = proseFromTakeAnswer(delivery.answer);
    expect(prose).toMatch(/^Spurs v Coventry — (?:Over|Under) 2\.5 at \d+(?:\.\d+)?%\./);
    const flipCount = (prose.match(/\bI'd shift if\b/g) ?? []).length;
    expect(flipCount).toBe(1);
  });

  it("BTTS phrasing opens with headline and closes with one flip", () => {
    const question = "BTTS in Sunderland vs Leeds United?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    expect(plan.mode).toBe("btts");
    const delivery = deliver(question);
    const prose = proseFromTakeAnswer(delivery.answer);
    expect(prose).toMatch(/^Spurs v Coventry — BTTS yes at \d+(?:\.\d+)?%\./i);
    const flipCount = (prose.match(/\bI'd shift if\b/g) ?? []).length;
    expect(flipCount).toBe(1);
  });
});
