import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponse } from "../response-plan";
import { composePunditTakeDeliveryAsync } from "./compose";
import { withPunditTakeRequestScope } from "./flags";
import { appendWhatFlipsItClosing, stripFlipSentencesFromProse } from "./take-flip-prose";
import { polishLlmTakeProse } from "./take-prose-polish";
import { buildPunditTakePlan } from "./take-plan";
import { postCheckTakeProseWithReport, proseFromTakeAnswer } from "./take-validate";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

describe("Take v2 prose 5b (LLM model scrub + single flip)", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polishLlmTakeProse rewrites my model expects and capitalizes", () => {
    const out = polishLlmTakeProse(
      "my model expects close to three goals. the model sees both sides scoring.",
    );
    expect(out).toMatch(/^I expect close to three goals/);
    expect(out).not.toMatch(/\bmodel\b/i);
    expect(out).toMatch(/^I expect/);
  });

  it("stripFlipSentencesFromProse removes shift lines only", () => {
    const raw =
      "Spurs v Coventry — Over 2.5 at 55%. I expect a busy night. I'd shift away from this call. I'd shift if one side fails to register a shot on target in the first half.";
    const stripped = stripFlipSentencesFromProse(raw);
    expect(stripped).not.toMatch(/I'd shift/i);
    expect(stripped).toMatch(/I expect a busy night/);
  });

  it("appendWhatFlipsItClosing keeps exactly one structured flip", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { marketKind: "totals", now: NOW });
    const llmish =
      "Spurs v Coventry — Over 2.5 at 55%. I expect close to three goals. I'd shift away from this call. I'd shift if the first hour stays goalless.";
    const merged = appendWhatFlipsItClosing(plan, llmish, grounding);
    const shiftCount = (merged.match(/I'd shift/gi) ?? []).length;
    expect(shiftCount).toBe(1);
    expect(merged).toMatch(/I'd shift if .+\.$/);
  });

  it("async assembly scrubs mocked LLM model phrasing and dedupes flip", async () => {
    const takeLlm = await import("./take-llm");
    const grounding = {
      ...spursCoventryGrounding(),
      goalCalibration: { methodId: "outcome-anchored-shrunk-goals-v2", artifactId: "t", artifactSha256: "abc" },
    };
    const question = "BTTS for Tottenham v Coventry?";
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      hasHistory: true,
    });
    const planJson = buildPunditTakePlan(grounding, null, { marketKind: "btts", now: NOW });
    const headline = `${planJson.fixtureLabel} — ${planJson.gridCall?.headlineLabel ?? planJson.call.headlineLabel} at ${planJson.gridCall?.modelPctInt ?? 52}%.`;
    const support = planJson.supporting[0]?.text ?? "Both sides have been leaky at the back lately.";
    const rawLlm = [
      headline,
      "my model expects close to three goals in this one.",
      support.replace(/\.$/, ""),
      "I'd shift away from this call.",
      planJson.flipCondition?.text ?? "I'd shift if one side fails to register a shot on target in the first half.",
    ].join(" ");

    vi.spyOn(takeLlm, "renderTakeProseWithLlmDetailed").mockImplementation(async (plan) => {
      const polished = polishLlmTakeProse(rawLlm.replace(planJson.fixtureLabel, plan.fixtureLabel));
      const checked = postCheckTakeProseWithReport(polished, plan);
      return {
        prose: checked.prose.trim() ? polishLlmTakeProse(checked.prose) : null,
        dropped: checked.dropped,
        source: checked.prose.trim() ? "llm" as const : "none",
      };
    });

    const delivery = await withPunditTakeRequestScope("v2", () =>
      composePunditTakeDeliveryAsync(question, grounding, plan));

    const prose = proseFromTakeAnswer(delivery!.answer);
    expect(prose).not.toMatch(/\bmodel\b/i);
    expect(prose).toMatch(/I expect close to three goals/i);
    expect((prose.match(/I'd shift/gi) ?? []).length).toBe(1);
    expect(prose).not.toMatch(/I'd shift away/i);
  });
});
