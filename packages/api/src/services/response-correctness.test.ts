import { describe, expect, it } from "vitest";
import {
  applyClaimDecisions,
  attributeManagerEra,
  containsCorrectionCue,
  decimalImpliedProbability,
  edgeBand,
  evPct,
  fairOdds,
  hasValidProbabilityAttribution,
  impliedP,
  passPrice,
  playPrice,
  probabilityAttributionLabel,
  probabilityTotalWithinTolerance,
  reconcileContradictoryRationales,
  riskBand,
  settleScorelineTotal,
  reviseAnswerWithClaimDecisions,
  validateCompleteOneXTwoMarket,
  attachUserLine,
  buildMatchPricing,
} from "./response-correctness";

const legs = [
  { outcome: "home" as const, decimalOdds: 2, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
  { outcome: "draw" as const, decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
  { outcome: "away" as const, decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
];

describe("pricing math", () => {
  it("classifies +0.34% as noise", () => {
    expect(edgeBand(0.0034)).toBe("noise");
  });

  it("computes evPct as modelP * decimal - 1", () => {
    expect(evPct(0.2, 7)).toBeCloseTo(0.4);
    expect(evPct(0.2, 7.0)).toBeCloseTo(0.4);
  });

  it("returns null evPct when decimal is missing", () => {
    expect(evPct(0.2, null)).toBeNull();
    expect(evPct(0.2, undefined)).toBeNull();
  });

  it("does not invent a decimal from a no-vig probability", () => {
    const noVigP = 0.25;
    expect(impliedP(noVigP)).toBeNull();
    expect(evPct(0.2, noVigP)).toBeNull();
    expect(decimalImpliedProbability(noVigP)).toBeNull();
    expect(fairOdds(noVigP)).toBe(4);
  });

  it("maps fairOdds and impliedP only on open unit intervals / decimals > 1", () => {
    expect(fairOdds(0.2)).toBe(5);
    expect(fairOdds(0)).toBeNull();
    expect(fairOdds(1)).toBeNull();
    expect(impliedP(5)).toBeCloseTo(0.2);
    expect(impliedP(1)).toBeNull();
  });

  it("bands absolute EV and names pass / play / risk from the locked thresholds", () => {
    expect(edgeBand(0.009)).toBe("noise");
    expect(edgeBand(0.01)).toBe("thin");
    expect(edgeBand(0.029)).toBe("thin");
    expect(edgeBand(0.03)).toBe("real");
    expect(edgeBand(0.079)).toBe("real");
    expect(edgeBand(0.08)).toBe("fat-and-fragile");
    expect(edgeBand(null)).toBeNull();
    expect(passPrice(0.2)).toBeCloseTo(5.05);
    expect(playPrice(0.2)).toBeCloseTo(5.15);
    expect(riskBand(0.62, 0.0034)).toBe("low");
    expect(riskBand(0.2, 0.4)).toBe("high");
    expect(riskBand(0.4, 0.02)).toBe("medium");
    expect(riskBand(0.62, null)).toBeNull();
  });

  it("builds a pricing object without inventing decimals from no-vig rows", () => {
    const pricing = buildMatchPricing({
      fixtureId: "espn:eng.1:1",
      home: "Hull City",
      away: "Manchester United",
      kickoff: "2026-08-02",
      pricedAt: "2026-08-02T15:00:00.000Z",
      pHome: 0.2,
      pDraw: 0.3,
      pAway: 0.5,
      markets: [{
        source: "kalshi",
        observedAt: "2026-08-02T12:00:00Z",
        pHome: 0.25,
        pDraw: 0.3,
        pAway: 0.45,
        decimalOdds: null,
      }],
    });
    expect(pricing.model.home.fairOdds).toBeCloseTo(5);
    expect(pricing.userLine).toBeNull();
    expect(pricing.stakeFrac).toBeNull();
    expect(pricing.modelVersion).toBe("unknown");
    expect(pricing.markets).toHaveLength(1);
    expect(pricing.markets[0].edgeBand).toBeNull();
    expect(pricing.markets[0].legs.away).toMatchObject({
      modelP: 0.5,
      fairOdds: 2,
      decimalOdds: null,
      impliedP: null,
      evPct: null,
    });
  });

  it("fills evPct only when a real decimal exists", () => {
    const pricing = buildMatchPricing({
      fixtureId: "espn:eng.1:1",
      home: "Hull City",
      away: "Manchester United",
      kickoff: "2026-08-02",
      modelVersion: "clubelo@1:testhash",
      pricedAt: "2026-08-02T15:00:00.000Z",
      pHome: 0.2,
      pDraw: 0.3,
      pAway: 0.5,
      markets: [{
        source: "book",
        observedAt: "2026-08-02T12:00:00Z",
        pHome: 0.18,
        pDraw: 0.28,
        pAway: 0.54,
        decimalOdds: { home: 7, draw: null, away: 1.8 },
      }],
    });
    expect(pricing.modelVersion).toBe("clubelo@1:testhash");
    expect(pricing.markets[0].legs.home.evPct).toBeCloseTo(0.4);
    expect(pricing.markets[0].legs.home.impliedP).toBeCloseTo(1 / 7);
    expect(pricing.markets[0].legs.draw.evPct).toBeNull();
    expect(pricing.markets[0].legs.away.evPct).toBeCloseTo(-0.1);
    expect(pricing.markets[0].edgeBand).toBe("fat-and-fragile");
  });

  it("fills userLine from modelP * decimal - 1 and leaves stakeFrac null", () => {
    const pricing = attachUserLine(buildMatchPricing({
      fixtureId: "espn:eng.1:1",
      home: "Hull City",
      away: "Manchester United",
      kickoff: "2026-08-02",
      pricedAt: "2026-08-02T15:00:00.000Z",
      pHome: 0.2,
      pDraw: 0.3,
      pAway: 0.5,
    }), { outcome: "away", decimalOdds: 7 });
    expect(pricing.userLine).toMatchObject({
      outcome: "away",
      decimalOdds: 7,
      evPct: 0.5 * 7 - 1,
      edgeBand: "fat-and-fragile",
      riskBand: "high",
    });
    expect(pricing.userLine?.evPct).toBeCloseTo(2.5);
    expect(pricing.userLine?.passPrice).toBeCloseTo(2 * 1.01);
    expect(pricing.userLine?.playPrice).toBeCloseTo(2 * 1.03);
    expect(pricing.stakeFrac).toBeNull();
  });
});

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
    expect(applied.answer).toBe(
      "Claim one [[S1]]. Current reports conflict on one or more requested facts, so I’ve left those claims out."
    );
    expect(applyClaimDecisions(claims, [
      { claimId: "C1", outcome: "unsupported", evidenceIds: [] },
      { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
    ]).answer).toBe("I could not verify a reliable answer to that question.");
  });
});

describe("reviseAnswerWithClaimDecisions", () => {
  const answer = "Pundit's model gives Arsenal 56.3%. Saka is injured [[S1]]. "
    + "Odegaard is suspended [[S2]]. The verdict is a narrow home win.";
  const claims = [
    { id: "C1", text: "Saka is injured [[S1]]." },
    { id: "C2", text: "Odegaard is suspended [[S2]]." },
  ];

  it("keeps everything that was never a claim", () => {
    const revised = reviseAnswerWithClaimDecisions(answer, claims, [
      { claimId: "C1", outcome: "supported", evidenceIds: ["S4"] },
      { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
    ]);
    expect(revised.answer).toContain("Pundit's model gives Arsenal 56.3%.");
    expect(revised.answer).toContain("The verdict is a narrow home win.");
    // The supported claim is re-marked with the evidence the verifier accepted.
    expect(revised.answer).toContain("Saka is injured [[S4]].");
    expect(revised.answer).not.toContain("Odegaard");
    expect(revised.answer).not.toContain("[[S1]]");
  });

  it("reports the same bookkeeping as applyClaimDecisions", () => {
    const decisions = [
      { claimId: "C1", outcome: "supported" as const, evidenceIds: ["S4"] },
      { claimId: "C2", outcome: "conflict" as const, evidenceIds: ["S2", "S3"] },
    ];
    const revised = reviseAnswerWithClaimDecisions(answer, claims, decisions);
    const applied = applyClaimDecisions(claims, decisions);
    expect(revised.supported).toEqual(applied.supported);
    expect(revised.removedClaimIds).toEqual(applied.removedClaimIds);
    expect(revised.conflictClaimIds).toEqual(applied.conflictClaimIds);
    expect(revised.answer).toContain(
      "Current reports conflict on one or more requested facts, so I’ve left those claims out."
    );
  });

  it("appends the conflict notice without rebuilding the answer", () => {
    const revised = reviseAnswerWithClaimDecisions(answer, claims, [
      { claimId: "C1", outcome: "supported", evidenceIds: ["S4"] },
      { claimId: "C2", outcome: "conflict", evidenceIds: ["S2", "S3"] },
    ]);
    expect(revised.answer).toContain("Pundit's model gives Arsenal 56.3%.");
    expect(revised.answer.endsWith("so I’ve left those claims out.")).toBe(true);
  });

  it("returns the answer unchanged when there are no claims at all", () => {
    const modelOnly = "Pundit's model gives Arsenal 56.3%, the draw 24.1% and Chelsea 19.6%.";
    expect(reviseAnswerWithClaimDecisions(modelOnly, [], []).answer).toBe(modelOnly);
  });

  it("returns the answer unchanged when every claim is supported as written", () => {
    const single = "Saka is injured [[S1]].";
    const revised = reviseAnswerWithClaimDecisions(single, [{ id: "C1", text: single }], [
      { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
    ]);
    expect(revised.answer).toBe(single);
  });

  it("leaves text alone when a claim cannot be located in the answer", () => {
    const revised = reviseAnswerWithClaimDecisions(answer, [{ id: "C1", text: "Not in the answer." }], [
      { claimId: "C1", outcome: "unsupported", evidenceIds: [] },
    ]);
    expect(revised.answer).toBe(answer);
    expect(revised.removedClaimIds).toEqual(["C1"]);
  });

  it("resolves repeated identical claims to their own spans", () => {
    const repeated = "Saka is injured [[S1]]. Saka is injured [[S1]]. Kick-off is Saturday.";
    const text = "Saka is injured [[S1]].";
    const revised = reviseAnswerWithClaimDecisions(
      repeated,
      [{ id: "C1", text }, { id: "C2", text }],
      [
        { claimId: "C1", outcome: "supported", evidenceIds: ["S1"] },
        { claimId: "C2", outcome: "unsupported", evidenceIds: [] },
      ]
    );
    expect(revised.answer).toBe("Saka is injured [[S1]].  Kick-off is Saturday.");
  });
});
