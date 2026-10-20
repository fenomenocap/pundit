import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeMatchResponse } from "../response-composer";
import { attachUserLine } from "../response-correctness";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import {
  DEFAULT_TAKE,
  punditTakeV2Active,
  punditTakeV2HeaderOverrideActive,
  resolvePunditTakeOverride,
  withPunditTakeRequestScope,
} from "./flags";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

describe("x-pundit-take request scope (POST /api/ask wiring)", () => {
  let prevTakeV2: string | undefined;

  beforeEach(() => {
    prevTakeV2 = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
  });

  afterEach(() => {
    if (prevTakeV2 === undefined) delete process.env.PUNDIT_TAKE_V2;
    else process.env.PUNDIT_TAKE_V2 = prevTakeV2;
  });

  it("resolvePunditTakeOverride honors v2 header without PUNDIT_TAKE_V2 env (prod path)", () => {
    expect(resolvePunditTakeOverride("v2", false)).toBe("v2");
    expect(resolvePunditTakeOverride(undefined, false)).toBeNull();
    expect(resolvePunditTakeOverride("legacy", false)).toBe("legacy");
  });

  it("code default is v2", () => {
    expect(DEFAULT_TAKE).toBe("v2");
  });

  it("legacy header compose stays byte-identical to the unscoped path", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const legacy = composeMatchResponse(question, grounding, plan);
    const scopedLegacy = withPunditTakeRequestScope("legacy", () => {
      expect(punditTakeV2Active()).toBe(false);
      return composeMatchResponse(question, grounding, plan);
    });
    expect(scopedLegacy).toBe(legacy);
  });

  it("no header uses the same v2 composer as an explicit v2 header", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const fromHeader = withPunditTakeRequestScope("v2", () => {
      expect(punditTakeV2Active()).toBe(true);
      expect(punditTakeV2HeaderOverrideActive()).toBe(true);
      return composeMatchResponse(question, grounding, plan);
    });
    const fromDefault = withPunditTakeRequestScope(null, () => {
      expect(punditTakeV2Active()).toBe(true);
      expect(punditTakeV2HeaderOverrideActive()).toBe(true);
      return composeMatchResponse(question, grounding, plan);
    });
    expect(fromDefault).toBe(fromHeader);
    expect(fromDefault).toContain("| Outcome | Ours |");
    expect(fromDefault).not.toBe(composeMatchResponse(question, grounding, plan));
  });

  it("v2 header activates take delivery (same seam as withPunditTakeRequestScope on /api/ask)", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const legacy = composeMatchResponse(question, grounding, plan);
    const takeOverride = resolvePunditTakeOverride("v2", false);
    const v2Answer = withPunditTakeRequestScope(takeOverride, () => {
      expect(punditTakeV2Active()).toBe(true);
      return composeMatchResponse(question, grounding, plan);
    });
    expect(v2Answer).toContain("| Outcome | Ours |");
    expect(v2Answer).not.toBe(legacy);
  });

  it("pass-or-play on v2 path returns fair vs offered maths, not a refusal", () => {
    const base = spursCoventryGrounding();
    const grounding = {
      ...base,
      pricing: attachUserLine(base.pricing, { outcome: "home", decimalOdds: 1.55 }),
    };
    const question = "Spurs at 1.55 — pass or play?";
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      hasUserLine: true,
    });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer).toMatch(/implies/i);
    expect(delivery.answer).toMatch(/I have/i);
    expect(delivery.answer).toMatch(/I pass on/i);
    expect(delivery.answer).not.toMatch(/won't size a stake|add a decimal line before I can call/i);
  });

  it("pass-or-play calls play when model edge clears the line", () => {
    const base = spursCoventryGrounding();
    const grounding = {
      ...base,
      pricing: attachUserLine(base.pricing, { outcome: "home", decimalOdds: 2.05 }),
    };
    const question = "Chelsea at 2.05, pass or play?";
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: true,
      hasUserLine: true,
    });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(question, grounding, plan)!);
    expect(delivery.answer).toMatch(/implies/i);
    expect(delivery.answer).toMatch(/I play/i);
  });
});
