import { describe, expect, it, vi } from "vitest";
import * as modelData from "./model-data";
import * as modelMarketOdds from "./model-market-odds";
import { fixture } from "./__fixtures__/model-fixture";
import { largestSlateModelMarketGap } from "./slate-market-scan";

describe("slate-market-scan", () => {
  it("picks the largest gap across priced fixtures", () => {
    const a = fixture("Arsenal", "Everton", { pHome: 0.62, pDraw: 0.22, pAway: 0.16 });
    const b = fixture("Chelsea", "Tottenham", { pHome: 0.45, pDraw: 0.27, pAway: 0.28 });
    vi.spyOn(modelData, "getCachedModelData").mockReturnValue({
      fixtures: [a, b],
      lastUpdated: new Date(),
      error: null,
    });
    vi.spyOn(modelMarketOdds, "getCachedFixtureMarketOdds").mockImplementation((row) => {
      if (row.fixtureId === a.fixtureId) {
        return {
          observedAt: "2026-10-18T12:00:00.000Z",
          kalshi: { pHome: 0.5, pDraw: 0.25, pAway: 0.25 },
          polymarket: null,
          stake: null,
        };
      }
      return {
        observedAt: "2026-10-18T12:00:00.000Z",
        kalshi: { pHome: 0.44, pDraw: 0.28, pAway: 0.28 },
        polymarket: null,
        stake: null,
      };
    });
    const best = largestSlateModelMarketGap();
    expect(best?.fixtureLabel).toBe("Arsenal v Everton");
    expect(best?.label).toBe("Arsenal");
    expect(best?.gapPoints).toBeCloseTo(12, 0);
    vi.restoreAllMocks();
  });
});
