import { describe, expect, it } from "vitest";
import { tableVsModelFavoriteExplainLine } from "./basics-answer-voice";
import type { Grounding } from "./ask";
import { sampleAgentFreshness } from "../config/freshness-policy";
import { buildMatchPricing } from "./response-correctness";
import { sampleMatchContextFields } from "./match-context";

function minimalGrounding(overrides: Partial<Grounding> = {}): Grounding {
  const pHome = 0.599;
  const observedAt = "2026-10-18T12:00:00.000Z";
  return {
    kind: "match",
    fixtureId: "eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: "Tottenham",
    away: "Coventry",
    pHome,
    pDraw: 0.244,
    pAway: 0.157,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [{
      source: "polymarket",
      observedAt,
      pHome: 0.64,
      pDraw: 0.205,
      pAway: 0.155,
    }],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: "Tottenham",
      away: "Coventry",
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: observedAt,
      pHome,
      pDraw: 0.244,
      pAway: 0.157,
      markets: [],
    }),
    freshness: sampleAgentFreshness({
      marketOddsLastUpdated: observedAt,
      modelLastUpdated: observedAt,
      ratingsAsOf: observedAt,
    }),
    ...sampleMatchContextFields({
      homeElo: 1799,
      awayElo: 1706,
      homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
      awayTable: { position: 8, points: 14, goalDifference: 2, playedGames: 8 },
    }),
    ...overrides,
  };
}

describe("tableVsModelFavoriteExplainLine", () => {
  it("explains when table rank contradicts a strong Elo-backed home favourite", () => {
    const line = tableVsModelFavoriteExplainLine(minimalGrounding());
    expect(line).toMatch(/20th on 3 pts/);
    expect(line).toMatch(/rated stronger than Coventry on our numbers/);
    expect(line).toMatch(/home advantage/);
    expect(line).toMatch(/market price is higher at 64\.0%/);
    expect(line).not.toMatch(/\bElo\b|Polymarket/i);
  });

  it("skips when table positions are close", () => {
    const grounding = minimalGrounding({
      homeTable: { position: 12, points: 10, goalDifference: 0, playedGames: 8 },
      awayTable: { position: 14, points: 9, goalDifference: -1, playedGames: 8 },
    });
    expect(tableVsModelFavoriteExplainLine(grounding)).toBeNull();
  });

  it("skips when the draw is the model favourite", () => {
    const grounding = minimalGrounding({ pHome: 0.34, pDraw: 0.4, pAway: 0.26 });
    expect(tableVsModelFavoriteExplainLine(grounding)).toBeNull();
  });
});
