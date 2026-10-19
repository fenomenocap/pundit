import { describe, expect, it } from "vitest";
import { buildMatchPricing } from "../response-correctness";
import { attachUserLine, resolveUserLineDecision, userLineGapPoints } from "../response-correctness";
import { renderPassPlayTakeProse } from "./take-grid-prose";
import { buildPunditTakePlan } from "./take-plan";
import type { Grounding } from "../ask";

function minimalGrounding(modelPHome = 0.599): Grounding {
  const pHome = modelPHome;
  const pDraw = 0.244;
  const pAway = 0.157;
  const pricing = buildMatchPricing({
    fixtureId: "eng.1:401879257",
    home: "Tottenham",
    away: "Coventry",
    kickoff: "2026-10-18T15:00:00.000Z",
    modelVersion: "clubelo@1:test",
    pricedAt: "2026-10-18T09:30:00.000Z",
    pHome,
    pDraw,
    pAway,
    markets: [],
  });
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18",
    stage: "Regular Season",
    home: "Tottenham",
    away: "Coventry",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing,
    freshness: {
      tier: "fresh",
      reason: "test",
      espnLastUpdated: "2026-10-18T09:00:00.000Z",
      modelLastUpdated: "2026-10-18T09:00:00.000Z",
      marketOddsLastUpdated: null,
      ratingsAsOf: "2026-10-13T01:46:00.000Z",
      generatedAt: "2026-10-18T09:00:00.000Z",
    },
    homeElo: 1799,
    awayElo: 1706,
    lambdaHome: 1.85,
    lambdaAway: 0.85,
    totalXg: 2.7,
    homeForm: [],
    awayForm: [],
    homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
    awayTable: { position: 16, points: 6, goalDifference: -4, playedGames: 8 },
    homeScorers: [],
    awayScorers: [],
  };
}

describe("pass-or-play decision", () => {
  it("always passes when model-minus-implied gap is negative", () => {
    const grounding = minimalGrounding();
    const withLine = {
      ...grounding,
      pricing: attachUserLine(grounding.pricing, { outcome: "home", decimalOdds: 1.55 }),
    };
    const line = withLine.pricing.userLine!;
    const gap = userLineGapPoints(withLine.pricing.model.home.p, line.decimalOdds);
    expect(gap).toBeLessThan(0);
    expect(resolveUserLineDecision(line, gap)).toBe("pass");

    const plan = buildPunditTakePlan(withLine, null);
    const prose = renderPassPlayTakeProse(plan, withLine)!;
    expect(prose).toMatch(/I pass on Spurs at 1\.55/);
    expect(prose).not.toMatch(/I play/);
  });

  it("passes even when pass/play price thresholds were mis-set short", () => {
    const grounding = minimalGrounding();
    let pricing = attachUserLine(grounding.pricing, { outcome: "home", decimalOdds: 1.55 });
    pricing = {
      ...pricing,
      userLine: pricing.userLine
        ? { ...pricing.userLine, playPrice: 1.54, passPrice: 1.56 }
        : null,
    };
    const withLine = { ...grounding, pricing };
    const line = withLine.pricing.userLine!;
    const gap = userLineGapPoints(withLine.pricing.model.home.p, line.decimalOdds);
    expect(gap).toBeLessThan(0);
    expect(resolveUserLineDecision(line, gap)).toBe("pass");
  });
});
