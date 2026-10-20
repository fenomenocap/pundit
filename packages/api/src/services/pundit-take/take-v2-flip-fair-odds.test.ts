import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { renderFlipSentenceFromSpec } from "./take-flip-spec";
import { buildTakeFlipCondition } from "./take-flip-condition";
import { formatWhatFlipsItSentence } from "./take-flip-prose";
import { renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { buildPunditTakePlan } from "./take-plan";
import { normalizeFormScopeInText, scrubModelWordFromProse } from "./take-prose-polish";
import { renderTakeProseDeterministic } from "./take-prose";
import { planResponse } from "../response-plan";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

describe("Take v2 flip + fair odds (agent scope)", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("renders flip as one structured sentence with all-venues last 5", () => {
    const grounding = spursCoventryGrounding();
    const sentence = renderFlipSentenceFromSpec(
      { kind: "last5-scoring", team: "away", goalsFor: 6, played: 5 },
      grounding,
    );
    expect(sentence).toMatch(/^I'd shift if .+\.$/);
    expect(sentence).toMatch(/all venues/);
    expect(sentence).not.toMatch(/at this venue/i);
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    expect(formatWhatFlipsItSentence(plan)?.startsWith("I'd shift if")).toBe(true);
  });

  it("buildTakeFlipCondition never uses raw dossier claim text", () => {
    const grounding = chelseaTottenhamGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const flip = buildTakeFlipCondition(null, grounding, plan.call, plan.gridCall, "1x2");
    expect(flip?.text).toMatch(/^I'd shift if /);
    expect(flip?.text).not.toMatch(/travelling squad|evidence\./i);
  });

  it("normalizes mis-scoped form lines in prose polish", () => {
    const raw = "Ipswich have scored 7 across their last 5 league games at this venue stretch.";
    const fixed = normalizeFormScopeInText(raw);
    expect(fixed).not.toMatch(/at this venue/i);
    expect(fixed).toMatch(/all venues/i);
  });

  it("fair odds is one value-side sentence without model in prose", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const fair = renderFairOddsTakeProse(plan, grounding);
    expect(fair).not.toMatch(/\n/);
    expect(fair).toMatch(/looks (light|rich) at/);
    expect(scrubModelWordFromProse(fair)).not.toMatch(/\bmodel\b/i);
    expect(fair).not.toMatch(/\bmodel\b/i);
  });

  it("deterministic take prose has no venue-split form or spliced flip", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderTakeProseDeterministic(plan, "full", grounding);
    expect(prose).not.toMatch(/at this venue/i);
    expect(prose).not.toMatch(/I'd shift if .+ I'd shift if/i);
  });

  it("v2 fair-odds delivery uses value-side one-liner in answer prose block", () => {
    const grounding = spursCoventryGrounding();
    const question = "Fair odds vs market for Tottenham v Coventry?";
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    const prose = delivery.answer.split("\n\n| Outcome |")[0] ?? "";
    expect(prose).toMatch(/looks (light|rich) at/);
    expect(prose).not.toMatch(/\bmodel\b/i);
  });
});
