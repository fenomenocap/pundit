import type { Grounding } from "../../ask";
import { buildMatchPricing } from "../../response-correctness";
import { sampleMatchContextFields } from "../../match-context";
import { sampleAgentFreshness } from "../../../config/freshness-policy";

export function spursCoventryGrounding(): Grounding {
  const pHome = 0.599;
  const pDraw = 0.244;
  const pAway = 0.157;
  const observedAt = "2026-10-18T09:30:00.000Z";
  const oddsSources = [{
    source: "kalshi" as const,
    observedAt,
    pHome: 0.625,
    pDraw: 0.208,
    pAway: 0.168,
  }];
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
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
    topScores: [{ score: "2-1", probability: 0.102 }],
    scorelines: [{ score: "1-1", probability: 0.116 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "kalshi",
      observedAt,
      legs: [
        { outcome: "home", label: "Tottenham", modelPercent: 59.9, marketPercent: 62.5, gapPoints: -2.6 },
        { outcome: "draw", label: "the draw", modelPercent: 24.4, marketPercent: 20.8, gapPoints: 3.6 },
        { outcome: "away", label: "Coventry", modelPercent: 15.7, marketPercent: 16.8, gapPoints: -1.1 },
      ],
      largest: { outcome: "draw", label: "the draw", modelPercent: 24.4, marketPercent: 20.8, gapPoints: 3.6 },
    }],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: "Tottenham",
      away: "Coventry",
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "clubelo@1:e92896aabcd0001",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: oddsSources.map((source) => ({
        source: source.source,
        observedAt: source.observedAt,
        pHome: source.pHome,
        pDraw: source.pDraw!,
        pAway: source.pAway,
        impliedDisplayDecimals: true,
        decimalOdds: {
          home: 1 / source.pHome,
          draw: 1 / source.pDraw!,
          away: 1 / source.pAway,
        },
      })),
    }),
    freshness: sampleAgentFreshness({
      marketOddsLastUpdated: observedAt,
      modelLastUpdated: observedAt,
      ratingsAsOf: "2026-10-13T01:46:00.000Z",
    }),
    ...sampleMatchContextFields({
      homeElo: 1799,
      awayElo: 1706,
      homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
      awayTable: { position: 16, points: 6, goalDifference: -4, playedGames: 8 },
    }),
  };
}
