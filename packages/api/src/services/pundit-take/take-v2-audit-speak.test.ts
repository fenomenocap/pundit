import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { attachUserLine } from "../response-correctness";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import {
  firstForbiddenTokenInTakeProse,
  proseFromTakeAnswer,
} from "./take-validate";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const FIXTURE_NOW = new Date("2026-10-18T10:00:00.000Z");

const SPURS_PROMPTS = [
  "Who wins Tottenham v Coventry?",
  "Why?",
  "Fair odds vs market for Tottenham v Coventry?",
  "BTTS for Tottenham v Coventry?",
  "Over 2.5 Tottenham v Coventry?",
  "pass or play?",
  "What about the draw?",
  "Where do your odds come from?",
  "How much should I stake on Spurs?",
  "Guarantee me a winner",
  "Build me a 2-leg parlay on Spurs and Coventry",
  "1x2 for Tottenham v Coventry?",
] as const;

const CHELSEA_PROMPTS = [
  "Fair odds for Chelsea v Tottenham?",
  "Who wins Chelsea v Tottenham?",
  "Chelsea at 1.70, play or pass?",
] as const;

describe("Take v2 audit-speak guard", () => {
  beforeEach(() => {
    vi.setSystemTime(FIXTURE_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function deliver(question: string, grounding: ReturnType<typeof spursCoventryGrounding>) {
    const hasMarket = grounding.pricing.markets.some(
      (row) => row.legs.draw.decimalOdds != null || row.legs.draw.impliedP != null,
    );
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: hasMarket,
      hasHistory: question.trim() === "Why?",
      hasUserLine: Boolean(grounding.pricing.userLine),
    });
    return withPunditTakeRequestScope("v2", () => composePunditTakeDelivery(question, grounding, plan)!);
  }

  for (const question of SPURS_PROMPTS) {
    it(`prose is clean for Spurs fixture: ${question}`, () => {
      let grounding = spursCoventryGrounding();
      if (question === "pass or play?") {
        grounding = {
          ...grounding,
          pricing: attachUserLine(grounding.pricing, { outcome: "home", decimalOdds: 1.55 }),
        };
      }
      const delivery = deliver(question, grounding);
      const prose = proseFromTakeAnswer(delivery.answer);
      const hit = firstForbiddenTokenInTakeProse(prose);
      expect(hit, `forbidden token "${hit}" in:\n${prose}`).toBeNull();
    });
  }

  for (const question of CHELSEA_PROMPTS) {
    it(`prose is clean for Chelsea fixture: ${question}`, () => {
      let grounding = chelseaTottenhamGrounding();
      if (question.includes("play or pass")) {
        grounding = {
          ...grounding,
          pricing: attachUserLine(grounding.pricing, { outcome: "home", decimalOdds: 1.7 }),
        };
      }
      const delivery = deliver(question, grounding);
      const prose = proseFromTakeAnswer(delivery.answer);
      const hit = firstForbiddenTokenInTakeProse(prose);
      expect(hit, `forbidden token "${hit}" in:\n${prose}`).toBeNull();
    });
  }

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
      expect(legacy).toMatch(/Model:/);
    } finally {
      if (prev === undefined) delete process.env.PUNDIT_TAKE_V2;
      else process.env.PUNDIT_TAKE_V2 = prev;
    }
  });
});
