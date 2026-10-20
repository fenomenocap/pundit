import { describe, expect, it } from "vitest";
import type { Grounding } from "./ask";
import { formatIndependentTakeWhyLine } from "./basics-answer-voice";
import { buildMatchPricing } from "./response-correctness";
import { sampleMatchContextFields } from "./match-context";
import { sampleAgentFreshness } from "../config/freshness-policy";

function whyLineGrounding(overrides: {
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  homeElo: number;
  awayElo: number;
  homeFieldAdvantage?: boolean;
}): Grounding {
  const observedAt = "2026-10-18T12:00:00.000Z";
  const { home, away, pHome, pDraw, pAway, homeElo, awayElo, homeFieldAdvantage = true } = overrides;
  return {
    kind: "match",
    fixtureId: "eng.1:test",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home,
    away,
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:test",
      home,
      away,
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "clubelo@1:testhash000000000000000000000000000000000000000000",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness({ ratingsAsOf: observedAt }),
    ...sampleMatchContextFields({ homeElo, awayElo }),
  };
}

describe("formatIndependentTakeWhyLine (legacy)", () => {
  it("home favourite rated stronger: home advantage helps", () => {
    const line = formatIndependentTakeWhyLine(whyLineGrounding({
      home: "Tottenham",
      away: "Coventry",
      pHome: 0.59,
      pDraw: 0.24,
      pAway: 0.17,
      homeElo: 1799,
      awayElo: 1706,
    }));
    expect(line).toBe(
      "Spurs are the stronger side on our ratings, and home advantage helps.",
    );
  });

  it("home favourite rated weaker: ratings side vs home tip (Palace v Newcastle)", () => {
    const line = formatIndependentTakeWhyLine(whyLineGrounding({
      home: "Crystal Palace",
      away: "Newcastle",
      pHome: 0.41,
      pDraw: 0.28,
      pAway: 0.31,
      homeElo: 1818,
      awayElo: 1860,
    }));
    expect(line).toBe(
      "Newcastle rate slightly stronger, but home advantage tips it to Crystal Palace.",
    );
    expect(line).not.toMatch(/\bElo\b|\d{4}/);
  });

  it("away favourite rated stronger: no home-advantage clause", () => {
    const line = formatIndependentTakeWhyLine(whyLineGrounding({
      home: "Coventry",
      away: "Tottenham",
      pHome: 0.22,
      pDraw: 0.26,
      pAway: 0.52,
      homeElo: 1706,
      awayElo: 1799,
    }));
    expect(line).toBe("Spurs are the stronger side on our ratings.");
    expect(line).not.toMatch(/home advantage/i);
  });

  it("large ratings gap omits slightly when away is stronger but home is tipped", () => {
    const line = formatIndependentTakeWhyLine(whyLineGrounding({
      home: "Crystal Palace",
      away: "Newcastle",
      pHome: 0.44,
      pDraw: 0.26,
      pAway: 0.30,
      homeElo: 1750,
      awayElo: 1860,
    }));
    expect(line).toBe(
      "Newcastle rate stronger, but home advantage tips it to Crystal Palace.",
    );
  });
});
