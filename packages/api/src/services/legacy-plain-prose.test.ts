import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeMatchResponse } from "./response-composer";
import { composePunditTakeDelivery } from "./pundit-take/compose";
import { withPunditTakeRequestScope } from "./pundit-take/flags";
import { chelseaTottenhamGrounding } from "./pundit-take/test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./pundit-take/test-fixtures/spurs-coventry-grounding";
import { planResponse } from "./response-plan";
import { attachUserLine } from "./response-correctness";

const FORBIDDEN_LEGACY_PROSE =
  /\bElo\b|Kalshi|Polymarket|no-vig|ratings v\d|[0-9a-f]{7}\)/i;

function assertLegacyProseClean(prose: string, label: string) {
  expect(prose, label).not.toMatch(FORBIDDEN_LEGACY_PROSE);
  expect(prose, `${label} — no Model footer`).not.toMatch(/^Model:/m);
  expect(prose, `${label} — no pipe tables`).not.toMatch(/\| Outcome \|/);
}

describe("legacy composeMatchResponse plain prose (no source/model tokens)", () => {
  let prevTakeV2: string | undefined;

  beforeEach(() => {
    prevTakeV2 = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
  });

  afterEach(() => {
    if (prevTakeV2 === undefined) delete process.env.PUNDIT_TAKE_V2;
    else process.env.PUNDIT_TAKE_V2 = prevTakeV2;
  });

  const ctx = { groundingKind: "match" as const, hasCompleteMarket1x2: true };

  const legacyCases: Array<{ question: string; fixture: "chelsea" | "spurs" }> = [
    { question: "Who wins Chelsea v Tottenham?", fixture: "chelsea" },
    { question: "Who wins Tottenham v Coventry?", fixture: "spurs" },
    { question: "Price tonight's match for me", fixture: "spurs" },
    { question: "Fair odds vs market for Chelsea v Tottenham?", fixture: "chelsea" },
    { question: "Both teams to score?", fixture: "spurs" },
    { question: "Over 2.5 goals?", fixture: "chelsea" },
    { question: "Why do you favour Chelsea?", fixture: "chelsea" },
    { question: "What is the best value on this match?", fixture: "chelsea" },
    { question: "Where do you disagree with the market?", fixture: "chelsea" },
    { question: "Where do your odds come from and how fresh are they?", fixture: "spurs" },
    { question: "What is the most likely score?", fixture: "spurs" },
    { question: "Guarantee me a winner", fixture: "spurs" },
  ];

  for (const { question, fixture } of legacyCases) {
    it(`scrubs banned tokens: ${question}`, () => {
      const grounding = fixture === "chelsea" ? chelseaTottenhamGrounding() : spursCoventryGrounding();
      const plan = planResponse(question, { ...ctx, hasHistory: question.startsWith("Why") });
      const answer = composeMatchResponse(question, grounding, plan);
      assertLegacyProseClean(answer, question);
      expect(answer).toMatch(/\d/);
    });
  }

  it("pass-or-play user line keeps numbers without source tokens", () => {
    const base = spursCoventryGrounding();
    const grounding = {
      ...base,
      pricing: attachUserLine(base.pricing, { outcome: "home", decimalOdds: 1.55 }),
    };
    const question = "Spurs at 1.55 — pass or play?";
    const plan = planResponse(question, {
      ...ctx,
      hasUserLine: true,
    });
    const answer = composeMatchResponse(question, grounding, plan);
    assertLegacyProseClean(answer, question);
    expect(answer).toMatch(/1\.55/);
  });

  it("v2 delivery stays unchanged when take scope is v2", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, ctx);
    const v2FromComposer = withPunditTakeRequestScope("v2", () =>
      composeMatchResponse(question, grounding, plan));
    const v2Direct = composePunditTakeDelivery(question, grounding, plan)!.answer;
    expect(v2FromComposer).toBe(v2Direct);
    expect(v2Direct).toMatch(/\| Outcome \| Ours \|/);
  });
});
