import { describe, expect, it } from "vitest";
import {
  buildExternalMarketConsensus,
  weightedMedian,
} from "./external-market-consensus";

describe("external market consensus", () => {
  it("computes a volume-weighted median per leg", () => {
    const median = weightedMedian([
      { value: 0.4, weight: 1 },
      { value: 0.5, weight: 3 },
      { value: 0.6, weight: 1 },
    ]);
    expect(median).toBeCloseTo(0.5);
  });

  it("flags stale sources and disagreement", () => {
    const now = Date.parse("2026-10-16T14:00:00.000Z");
    const consensus = buildExternalMarketConsensus([
      {
        source: "kalshi",
        observedAt: "2026-10-16T12:00:00.000Z",
        pHome: 0.5,
        pDraw: 0.25,
        pAway: 0.25,
      },
      {
        source: "polymarket",
        observedAt: "2026-10-16T13:30:00.000Z",
        pHome: 0.58,
        pDraw: 0.22,
        pAway: 0.20,
        weight: 2,
      },
    ], now);
    expect(consensus).not.toBeNull();
    expect(consensus!.stale).toBe(true);
    expect(consensus!.staleSources).toEqual(["kalshi"]);
    expect(consensus!.disagreement).toBe(true);
    expect(consensus!.sourceCount).toBe(2);
  });
});
