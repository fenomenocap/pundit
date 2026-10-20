import type { Grounding } from "../../ask";
import { buildMatchPricing } from "../../response-correctness";
import { sampleMatchContextFields } from "../../match-context";
import { sampleAgentFreshness } from "../../../config/freshness-policy";

/** Audit fixture: Chelsea v Tottenham with Kalshi + Polymarket rows (live-shaped). */
export function chelseaTottenhamGrounding(): Grounding {
  const pHome = 0.42;
  const pDraw = 0.28;
  const pAway = 0.30;
  const observedAt = "2026-10-18T09:30:00.000Z";
  const oddsSources = [
    { source: "kalshi" as const, observedAt, pHome: 0.44, pDraw: 0.26, pAway: 0.30 },
    { source: "polymarket" as const, observedAt, pHome: 0.43, pDraw: 0.27, pAway: 0.30 },
  ];
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401879800",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T17:30:00.000Z",
    stage: "Regular Season",
    home: "Chelsea",
    away: "Tottenham",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.58,
    pUnder2_5: 0.42,
    pBttsYes: 0.55,
    pBttsNo: 0.45,
    topScores: [{ score: "1-1", probability: 0.11 }],
    scorelines: [{ score: "2-1", probability: 0.09 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "kalshi",
      observedAt,
      legs: [
        { outcome: "home", label: "Chelsea", modelPercent: 42, marketPercent: 44, gapPoints: -2 },
        { outcome: "draw", label: "the draw", modelPercent: 28, marketPercent: 26, gapPoints: 2 },
        { outcome: "away", label: "Tottenham", modelPercent: 30, marketPercent: 30, gapPoints: 0 },
      ],
      largest: { outcome: "draw", label: "the draw", modelPercent: 28, marketPercent: 26, gapPoints: 2 },
    }],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879800",
      home: "Chelsea",
      away: "Tottenham",
      kickoff: "2026-10-18T17:30:00.000Z",
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
      espnLastUpdated: observedAt,
      ratingsAsOf: "2026-10-13T01:46:00.000Z",
    }),
    ...sampleMatchContextFields({
      homeElo: 1840,
      awayElo: 1820,
      lambdaHome: 1.55,
      lambdaAway: 1.35,
      totalXg: 2.9,
    }),
  };
}
