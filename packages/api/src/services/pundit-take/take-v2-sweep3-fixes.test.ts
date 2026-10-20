import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { matchPlanContext, planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { formatWhatFlipsItSentence } from "./take-flip-prose";
import { isCleanFlipClause, normalizeFlipClause } from "./take-flip-clause";
import { buildPunditTakePlan } from "./take-plan";
import { build1x2SupportingPoints } from "./take-plan-helpers";
import { fixtureTableGapSentence } from "./take-table-standings";
import { renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { renderTakeProseDeterministic } from "./take-prose";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

/** Sweep script prompts (draw / guarantee / provenance). */
const POLICY_PROMPTS = [
  "What about the draw?",
  "Guarantee me a winner",
  "Where do your odds come from?",
] as const;

describe("Sweep 3 fix pack", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("flip splice uses future conditional clauses, not pasted past-tense sentences", () => {
    const grounding = spursCoventryGrounding();
    const bad = "Coventry have scored 7 across their last 5 league games at this venue stretch.";
    expect(isCleanFlipClause(bad)).toBe(false);
    const fixed = normalizeFlipClause(bad, grounding.home, grounding.away);
    expect(fixed).toMatch(/Coventry keep scoring in league play \(7 in their last 5\)/);
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const withBadFlip = { ...plan, flipCondition: { ...plan.flipCondition!, text: bad } };
    const sentence = formatWhatFlipsItSentence(withBadFlip, grounding);
    expect(sentence).toMatch(/^I'd shift if /);
    expect(sentence).not.toMatch(/have scored 7 across/i);
    expect(sentence).not.toMatch(/would shift me toward/i);
  });

  it("form framing avoids venue-split wording for last-5 form", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const flip = plan.flipCondition?.text ?? "";
    expect(flip).not.toMatch(/at this venue/i);
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).not.toMatch(/last 5 league games at this venue/i);
  });

  it("points gap uses table arithmetic for clear-of wording", () => {
    const sentence = fixtureTableGapSentence("Brentford", 6, 10, "Hull", 9, 9);
    expect(sentence).toMatch(/one clear of 9th-placed Hull on 9/);
    expect(sentence).not.toMatch(/three clear/);
    const grounding = spursCoventryGrounding();
    const points = build1x2SupportingPoints(grounding, null, "home", "Spurs", "Coventry");
    const tablePoint = points.find((p) => p.id === "fact-table-standings");
    expect(tablePoint?.text).toMatch(/clear of|level on|points/);
  });

  for (const question of POLICY_PROMPTS) {
    it(`legacy policy prompts route to v2 take: ${question}`, () => {
      const grounding = spursCoventryGrounding();
      const plan = planResponse(question, { ...matchPlanContext(grounding, false, false) });
      const answer = withPunditTakeRequestScope("v2", () =>
        composeMatchResponse(question, grounding, plan, null, false));
      expect(answer).not.toMatch(/captured decimal line before I can print EV%/i);
      expect(answer.trim().length).toBeGreaterThan(30);
      if (question.includes("draw")) expect(answer).toMatch(/draw at \d+%/i);
      if (question.includes("Guarantee")) expect(answer).toMatch(/can't guarantee/i);
      if (question.includes("odds come from")) expect(answer).toMatch(/where the numbers come from/i);
    });
  }

  it("policy v2 delivery never returns an empty answer body", () => {
    const grounding = spursCoventryGrounding();
    for (const question of POLICY_PROMPTS) {
      const plan = planResponse(question, { ...matchPlanContext(grounding, false, false) });
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expect(delivery.answer.trim().length, question).toBeGreaterThan(20);
    }
  });

  it("suppresses toss-up and coin-flip language when the gap exceeds five points", () => {
    const grounding = {
      ...spursCoventryGrounding(),
      pHome: 0.45,
      pDraw: 0.30,
      pAway: 0.25,
    };
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/45%/);
    expect(prose).not.toMatch(/toss-up|coin-flip|coin flip/i);
  });

  it("fair odds prose highlights one edge; grid copy drops model wording on totals", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const fair = renderFairOddsTakeProse(plan, grounding);
    expect(fair).toMatch(/biggest gap is/i);
    expect(fair).not.toMatch(/Draw:.*Forest:/s);
    const totalsPlan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
    const totalsProse = renderTakeProseDeterministic(totalsPlan, "full", grounding);
    expect(totalsProse).not.toMatch(/\bthe model\b/i);
    const calibrated = {
      ...grounding,
      goalCalibration: { methodId: "outcome-anchored-shrunk-goals-v2", artifactId: "t", artifactSha256: "abc" },
      totalXg: 2.8,
      lambdaHome: 1.4,
      lambdaAway: 1.4,
    };
    const calibratedPlan = buildPunditTakePlan(calibrated, null, { marketKind: "totals", now: NOW });
    const calibratedProse = renderTakeProseDeterministic(calibratedPlan, "full", calibrated);
    expect(calibratedProse).toMatch(/I expect/i);
  });
});
