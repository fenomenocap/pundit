import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { matchPlanContext, planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { renderFlipSentenceFromSpec } from "./take-flip-spec";
import { buildPunditTakePlan } from "./take-plan";
import { build1x2SupportingPoints } from "./take-plan-helpers";
import { fixtureTableGapSentence } from "./take-table-standings";
import { renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { filterProseByPlanNumbers } from "./take-prose-number-guard";
import { renderTakeProseDeterministic } from "./take-prose";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

const POLICY_PROMPTS = [
  "What about the draw?",
  "Guarantee me a winner",
  "Where do your odds come from?",
] as const;

describe("Sweep 3 fix pack (CTO root-cause)", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("flip is one whole sentence from structured spec (all-venues last 5)", () => {
    const grounding = spursCoventryGrounding();
    const sentence = renderFlipSentenceFromSpec(
      { kind: "last5-scoring", team: "away", goalsFor: 6, played: 5 },
      grounding,
    );
    expect(sentence).toMatch(/^I'd shift if Coventry keep scoring/);
    expect(sentence).toMatch(/all venues\)\.$/);
    expect(sentence).not.toMatch(/at this venue/i);
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).toMatch(/I'd shift if .+\.$/);
    expect(prose).not.toMatch(/I'd shift if .+ have scored \d+ across/i);
  });

  it("drops prose sentences whose numbers are not in the facts payload", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const dirty = `${plan.fixtureLabel} — Spurs at 99%. Coventry sit 20th on 3 points.`;
    const cleaned = filterProseByPlanNumbers(dirty, plan, grounding);
    expect(cleaned).not.toMatch(/99%/);
  });

  it("points gap is computed in code (one clear, not three)", () => {
    const sentence = fixtureTableGapSentence("Brentford", 6, 10, "Hull", 9, 9);
    expect(sentence).toMatch(/one clear of 9th-placed Hull on 9/);
    const grounding = spursCoventryGrounding();
    const points = build1x2SupportingPoints(grounding, null, "home", "Spurs", "Coventry");
    expect(points.find((p) => p.id === "fact-table-standings")?.text).toMatch(/clear of|level on/);
  });

  for (const question of POLICY_PROMPTS) {
    it(`policy prompts use v2 on every fixture: ${question}`, () => {
      const grounding = spursCoventryGrounding();
      const plan = planResponse(question, { ...matchPlanContext(grounding, false, false) });
      const answer = withPunditTakeRequestScope("v2", () =>
        composeMatchResponse(question, grounding, plan, null, false));
      expect(answer).not.toMatch(/captured decimal line before I can print EV%/i);
      expect(answer.trim().length).toBeGreaterThan(30);
    });
  }

  it("never returns empty v2 policy delivery", () => {
    const grounding = spursCoventryGrounding();
    for (const question of POLICY_PROMPTS) {
      const plan = planResponse(question, { ...matchPlanContext(grounding, false, false) });
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(question, grounding, plan)!);
      expect(delivery.answer.trim().length, question).toBeGreaterThan(20);
    }
  });

  it("allows toss-up language only when top-two gap is under 2 pts", () => {
    const tight = {
      ...spursCoventryGrounding(),
      pOver2_5: 0.501,
      pUnder2_5: 0.499,
    };
    const tightPlan = buildPunditTakePlan(tight, null, { marketKind: "totals", now: NOW });
    expect(tightPlan.gridCall?.coinFlip).toBe(true);
    const wide = {
      ...spursCoventryGrounding(),
      pHome: 0.45,
      pDraw: 0.30,
      pAway: 0.25,
    };
    const widePlan = buildPunditTakePlan(wide, null, { now: NOW });
    const prose = renderTakeProseDeterministic(widePlan, "full", wide);
    expect(prose).not.toMatch(/toss-up|coin-flip|coin flip/i);
  });

  it("fair odds is one value-side sentence without model in prose", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const fair = renderFairOddsTakeProse(plan, grounding);
    expect(fair).not.toMatch(/\n/);
    expect(fair).toMatch(/looks (light|rich) at/);
    expect(fair).not.toMatch(/\bmodel\b/i);
    expect(fair).not.toMatch(/Draw:.*Forest:/s);
  });
});
