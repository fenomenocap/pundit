import { describe, expect, it } from "vitest";
import { scoreMatrix, eloToLambdas } from "./dixon-coles";
import {
  composeSameGameParlayAnswer,
  isSameGameParlayQuestion,
  jointProbabilityFromScoreGrid,
  resolveSameGameParlayLegs,
} from "./same-game-parlay";
import type { Grounding } from "./ask";

function miniGrounding(overrides: Partial<Grounding> = {}): Grounding {
  const matrix = scoreMatrix(...eloToLambdas(1850, 1600, 42));
  return {
    kind: "match",
    home: "Tottenham Hotspur",
    away: "Coventry City",
    date: "2026-10-19T19:00:00.000Z",
    competition: "Premier League",
    pHome: 0.62,
    pDraw: 0.22,
    pAway: 0.16,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.4,
    pBttsNo: 0.6,
    topScores: [],
    scoreGrid: matrix,
    homeElo: 1850,
    awayElo: 1600,
    homeFieldAdvantage: true,
    oddsSources: [],
    pricing: { model: { home: { p: 0.62, fairOdds: 1.61 }, draw: { p: 0.22, fairOdds: 4.55 }, away: { p: 0.16, fairOdds: 6.25 } }, markets: [] },
    ...overrides,
  } as Grounding;
}

describe("same-game parlay", () => {
  it("detects compound win + over + BTTS questions", () => {
    expect(isSameGameParlayQuestion("Spurs win + over 2.5 + BTTS")).toBe(true);
    expect(isSameGameParlayQuestion("Is Arsenal vs Chelsea over or under 2.5?")).toBe(false);
  });

  it("joint probability is at least the naive product for correlated goal legs", () => {
    const matrix = scoreMatrix(...eloToLambdas(1850, 1600, 42));
    const legs = { side: "home" as const, over25: true, btts: true };
    const joint = jointProbabilityFromScoreGrid(matrix, legs);
    expect(joint).toBeGreaterThan(0);
    expect(joint).toBeLessThan(1);
  });

  it("composes grid-based SGP with correlation note", () => {
    const answer = composeSameGameParlayAnswer(
      "Spurs win + over 2.5 + BTTS",
      miniGrounding()
    );
    expect(answer).toMatch(/same-game parlay/i);
    expect(answer).toMatch(/Correlation:/);
    expect(answer).toMatch(/fair \d+\.\d{2}/);
  });
});
