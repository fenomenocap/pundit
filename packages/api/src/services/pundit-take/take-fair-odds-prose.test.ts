import { describe, expect, it } from "vitest";
import { buildMatchPricing } from "../response-correctness";
import { buildPunditTakePlan } from "./take-plan";
import { renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { chelseaTottenhamGrounding } from "./test-fixtures/chelsea-tottenham-grounding";
import { spursCoventryGrounding } from "./test-fixtures/spurs-coventry-grounding";

const NOW = new Date("2026-10-18T10:00:00.000Z");

describe("renderFairOddsTakeProse copy", () => {
  it("when best is shorter than fair: too short, no value (Chelsea v Spurs away)", () => {
    const base = chelseaTottenhamGrounding();
    const pHome = 1 / 1.68;
    const pDraw = 1 / 4.08;
    const pAway = 1 / 6.22;
    const observedAt = "2026-10-18T09:30:00.000Z";
    const oddsSources = [{
      source: "kalshi" as const,
      observedAt,
      pHome: 1 / 1.68,
      pDraw: 1 / 4.08,
      pAway: 1 / 4.9,
    }];
    const grounding = {
      ...base,
      pHome,
      pDraw,
      pAway,
      oddsSources,
      pricing: buildMatchPricing({
        fixtureId: "eng.1:401879800",
        home: "Chelsea",
        away: "Tottenham",
        kickoff: "2026-10-18T17:30:00.000Z",
        modelVersion: base.pricing.modelVersion,
        pricedAt: observedAt,
        pHome,
        pDraw,
        pAway,
        markets: oddsSources.map((source) => ({
          source: source.source,
          observedAt: source.observedAt,
          pHome: source.pHome,
          pDraw: source.pDraw,
          pAway: source.pAway,
          impliedDisplayDecimals: true,
          decimalOdds: {
            home: 1 / source.pHome,
            draw: 1 / source.pDraw,
            away: 1 / source.pAway,
          },
        })),
      }),
    };
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderFairOddsTakeProse(plan, grounding);
    expect(prose).toMatch(/My fair prices: Chelsea 1\.68, Draw 4\.08, Spurs 6\.22\./);
    expect(prose).toContain("Spurs at 4.90 are too short; I make them 6.22 (16%), so there's no value there.");
    expect(prose).not.toMatch(/\blooks rich\b|\blooks light\b/i);
    expect(prose).not.toMatch(/\bSpurs looks\b/i);
  });

  it("when best is longer than fair: value side with pts in our favour (draw)", () => {
    const grounding = spursCoventryGrounding();
    const plan = buildPunditTakePlan(grounding, null, { now: NOW });
    const prose = renderFairOddsTakeProse(plan, grounding);
    expect(prose).toMatch(/My fair prices: Spurs \d+\.\d{2}, Draw \d+\.\d{2}, Coventry \d+\.\d{2}\./);
    expect(prose).toContain("Draw at 4.81 is bigger than my 4.10 (24%), so that's the value side, +3.6 pts in our favour.");
    expect(prose).not.toMatch(/too short/);
  });
});
