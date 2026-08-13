import { describe, expect, it } from "vitest";
import {
  applyClaimDecisions,
  attributeManagerEra,
  containsCorrectionCue,
  decimalImpliedProbability,
  hasValidProbabilityAttribution,
  probabilityAttributionLabel,
  probabilityTotalWithinTolerance,
  reconcileContradictoryRationales,
  settleScorelineTotal,
  validateCompleteOneXTwoMarket,
} from "./response-correctness";

const legs = [
  { outcome: "home" as const, decimalOdds: 2, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
  { outcome: "draw" as const, decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
  { outcome: "away" as const, decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
];

describe("odds correctness", () => {
  it("uses 1 / decimal odds and rejects invalid odds", () => {
    expect(decimalImpliedProbability(2.5)).toBeCloseTo(0.4);
    expect(decimalImpliedProbability(1)).toBeNull();
    expect(decimalImpliedProbability(Number.NaN)).toBeNull();
  });

  it("accepts only a complete same-source, same-time 1X2 market", () => {
    const result = validateCompleteOneXTwoMarket(legs);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.market.noVigProbabilities).toEqual({ home: 0.5, draw: 0.25, away: 0.25 });
      expect(probabilityTotalWithinTolerance(Object.values(result.market.noVigProbabilities))).toBe(true);
    }
    expect(validateCompleteOneXTwoMarket(legs.slice(0, 2))).toEqual({ valid: false, reason: "missing-leg" });
    expect(validateCompleteOneXTwoMarket([legs[0], legs[0], legs[2]])).toEqual({ valid: false, reason: "duplicate-leg" });
    expect(validateCompleteOneXTwoMarket([{ ...legs[0], source: "Other" }, legs[1], legs[2]])).toEqual({ valid: false, reason: "mixed-source" });
    expect(validateCompleteOneXTwoMarket([{ ...legs[0], observedAt: "later" }, legs[1], legs[2]])).toEqual({ valid: false, reason: "mixed-observation-time" });
  });

  it("enforces the +/-0.2 percentage-point total tolerance", () => {
    expect(probabilityTotalWithinTolerance([0.334, 0.333, 0.333])).toBe(true);
    expect(probabilityTotalWithinTolerance([0.335, 0.334, 0.334])).toBe(false);
  });

  it("labels external markets without calling them Pundit predictions", () => {
    const origin = { kind: "external-market" as const, source: "Stake", observedAt: "now" };
    const label = probabilityAttributionLabel(origin);
    expect(label).toContain("Stake");
    expect(label).toContain("not a Pundit");
    expect(hasValidProbabilityAttribution(label, origin)).toBe(true);
    expect(hasValidProbabilityAttribution("Pundit's model prediction", origin)).toBe(false);
  });
});

describe("football claim correctness", () => {
  it("does not call 1-1 over 2.5", () => {
    expect(settleScorelineTotal("1-1", 2.5, "over")).toBe("lose");
    expect(settleScorelineTotal("2-1", 2.5, "over")).toBe("win");
    expect(settleScorelineTotal("1-1", 2, "over")).toBe("push");
  });

  it("attributes results to the manager in charge on the event date", () => {
    const tenures = [
      { manager: "Old Manager", startedAt: "2025-01-01", endedAt: "2026-05-31" },
      { manager: "New Manager", startedAt: "2026-06-01" },
    ];
    expect(attributeManagerEra("2026-04-10", tenures, "New Manager")).toEqual({
      status: "conflict", manager: "Old Manager", assertedManager: "New Manager",
    });
    expect(attributeManagerEra("2026-08-10", tenures)).toEqual({ status: "supported", manager: "New Manager" });
  });

  it("removes opposed rationales on the same topic", () => {
    const result = reconcileContradictoryRationales([
      { topic: "midfield", direction: "home", text: "Home controls midfield." },
      { topic: "midfield", direction: "away", text: "Away controls midfield." },
      { topic: "venue", direction: "neutral", text: "The venue is neutral." },
    ]);
    expect(result.conflictingTopics).toEqual(["midfield"]);
    expect(result.retained.map((item) => item.text)).toEqual(["The venue is neutral."]);
  });

  it("detects correction language that must force re-verification", () => {
    expect(containsCorrectionCue("Actually, that's the wrong manager. Check again.")).toBe(true);
    expect(containsCorrectionCue("Tell me about their manager.")).toBe(false);
  });

  it("keeps only supported claims, reports conflicts, and abstains when none survive", () => {
    const claims = [{ id: "C1", text: "Claim one." }, { id: "C2", text: "Claim two." }];
    const applied = applyClaimDecisions(claims, [
      { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
      { claimId: "C2", outcome: "conflict", evidenceIds: ["S2", "S3"] },
    ]);
    expect(applied).toMatchObject({ conflictClaimIds: ["C2"] });
    expect(applied.supported).toEqual([{ id: "C1", text: "Claim one [[S1]]." }]);
    expect(applyClaimDecisions(claims, [
      { claimId: "C1", outcome: "unsupported", evidenceIds: [] },
      { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
    ]).answer).toContain("could not establish");
  });
});
