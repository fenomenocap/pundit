import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAKE_REFUSAL_SENTENCE } from "../response-composer";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { renderStakeRefusalTakeProse } from "./take-policy-prose";
import {
  applyV2ProseHygiene,
  dedupePolicyProseBlocks,
  dedupeVenueQualifiers,
  rewriteVenueInventedFormSentence,
} from "./take-v2-prose-hygiene";
import { postCheckTakeProseWithReport, proseFromTakeAnswer } from "./take-validate";
import { buildPunditTakePlan } from "./take-plan";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("Take v2 PR7 prose guards", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z")));
  afterEach(() => vi.useRealTimers());

  it("rewrites away-from-home form claims when there is no venue split", () => {
    const raw =
      "a Spurs side that has managed 6 goals in their last five away from home";
    const fixed = rewriteVenueInventedFormSentence(raw, false);
    expect(fixed).toMatch(/managed 6 goals in their last five league games/i);
    expect(fixed).not.toMatch(/away from home/i);

    const plan = buildPunditTakePlan(chelseaTottenhamGrounding(), null);
    const hygiened = applyV2ProseHygiene(`${raw}.`, plan);
    expect(hygiened).toMatch(/last five league games/i);
    expect(hygiened).not.toMatch(/away from home/i);

    const { prose } = postCheckTakeProseWithReport(
      `Chelsea v Tottenham — Chelsea at 48%. ${hygiened}`,
      plan,
    );
    expect(prose).not.toMatch(/away from home/i);
  });

  it("dedupes repeated all-venues qualifiers", () => {
    const noisy = "Coventry have scored 4 across their last 5 league games (all venues) at all venues.";
    expect(dedupeVenueQualifiers(noisy)).toBe(
      "Coventry have scored 4 across their last 5 league games (all venues).",
    );
    const plan = buildPunditTakePlan(spursCoventryGrounding(), null);
    const cleaned = applyV2ProseHygiene(noisy, plan);
    expect(cleaned).not.toMatch(/at all venues/i);
    expect(cleaned).toMatch(/\(all venues\)/);
  });

  it("dedupes repeated stake refusal blocks (Chelsea–Spurs slip)", () => {
    const plan = buildPunditTakePlan(chelseaTottenhamGrounding(), null);
    const doubled = [
      `${plan.fixtureLabel} — I won't size a stake without a bankroll and a risk band.`,
      STAKE_REFUSAL_SENTENCE,
      STAKE_REFUSAL_SENTENCE,
    ].join("\n\n");
    expect(dedupePolicyProseBlocks(doubled).split("\n\n").filter((b) => b.includes("I can print the price"))).toHaveLength(1);

    const prose = renderStakeRefusalTakeProse("How much should I stake on Chelsea?", plan);
    expect(prose).toContain(STAKE_REFUSAL_SENTENCE);
    expect(prose.split(STAKE_REFUSAL_SENTENCE).length - 1).toBe(1);

    const delivery = withPunditTakeRequestScope("v2", () => {
      const grounding = chelseaTottenhamGrounding();
      const question = "How much should I stake on Chelsea?";
      const responsePlan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
      return composePunditTakeDelivery(question, grounding, responsePlan)!;
    });
    const answerProse = proseFromTakeAnswer(delivery.answer);
    expect(answerProse.split(STAKE_REFUSAL_SENTENCE).length - 1).toBe(1);
  });

  it("deterministic totals/BTTS never ship table-only when post-check strips body", () => {
    const grounding = spursCoventryGrounding();
    for (const question of [
      "Over/under 2.5 in Hull City vs Brentford?",
      "BTTS in Sunderland vs Leeds United?",
    ]) {
      const responsePlan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, responsePlan)!);
      const prose = proseFromTakeAnswer(delivery.answer);
      expect(prose, question).toMatch(/^Spurs v Coventry —/);
      expect(prose, question).toMatch(/I'd shift if/i);
      expect(prose.length, question).toBeGreaterThan(40);
    }
  });

  it("dedupePolicyProseBlocks drops identical paragraphs", () => {
    const duped = dedupePolicyProseBlocks(
      "Line one about stakes.\n\nLine one about stakes.",
    );
    expect(duped).toBe("Line one about stakes.");
  });
});
