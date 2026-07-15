import { describe, expect, it } from "vitest";
import { ModelFixture } from "./model-data";
import { parseActiveMatchResult, parseFeaturedMarketOdds } from "./model-market-odds";

function fixture(): ModelFixture {
  return {
    date: "2026-07-15", group: null, stage: "semifinals", home: "England", away: "Argentina",
    pHome: 0.25, pDraw: 0.25, pAway: 0.5, pOver2_5: 0.5, pUnder2_5: 0.5,
    pBttsYes: 0.5, pBttsNo: 0.5, topScores: [], stakePHome: null,
    stakePDraw: null, stakePAway: null, result: null,
  };
}

function market(status = "active", values = [0.35, 0.33, 0.32]) {
  return {
    match_result: {
      status,
      outcomes: {
        home: { implied_probability: values[0] },
        draw: { implied_probability: values[1] },
        away: { implied_probability: values[2] },
      },
    },
  };
}

describe("parseActiveMatchResult", () => {
  it("accepts and normalizes a complete active 1X2 market", () => {
    expect(parseActiveMatchResult(market())).toEqual({ pHome: 0.35, pDraw: 0.33, pAway: 0.32 });
  });

  it("rejects settled, incomplete, and 0/0/1 markets", () => {
    expect(parseActiveMatchResult(market("closed"))).toBeNull();
    expect(parseActiveMatchResult(market("active", [0, 0, 1]))).toBeNull();
    expect(parseActiveMatchResult({ match_result: { status: "active", outcomes: {} } })).toBeNull();
  });
});

describe("parseFeaturedMarketOdds", () => {
  it("retains odds only for featured fixtures", () => {
    const current = fixture();
    const parsed = parseFeaturedMarketOdds({ fixtures: [
      { date: current.date, home: current.home, away: current.away, polymarket: market() },
      { date: "2026-06-11", home: "Mexico", away: "South Africa", polymarket: market() },
    ] }, [current]);
    expect(parsed.size).toBe(1);
    expect([...parsed.values()][0].polymarket).not.toBeNull();
  });
});
