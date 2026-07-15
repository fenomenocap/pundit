import { describe, expect, it } from "vitest";
import { parseFixtures, parseTeams } from "./model-data";

const rawFixture = {
  date: "2026-06-11", group: "A", stage: "group", home: "Mexico", away: "South Africa",
  p_home: 0.7, p_draw: 0.2, p_away: 0.1, p_over_2_5: 0.6, p_under_2_5: 0.4,
  p_btts_yes: 0.45, p_btts_no: 0.55, top_scores: [["2-0", 0.14], ["1-0", 0.12]],
  stake_p_home: null, stake_p_draw: null, stake_p_away: null,
  result: { home_score: 2, away_score: 0, status: "FT", winner: "Mexico" },
};

describe("model data contract", () => {
  it("retains every fixture with analytical fields and completed results", () => {
    const parsed = parseFixtures([rawFixture, { ...rawFixture, date: "2026-06-12", result: null }]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      pOver2_5: 0.6,
      pBttsYes: 0.45,
      result: { winner: "Mexico" },
    });
    expect(parsed[0].topScores[0]).toEqual({ score: "2-0", probability: 0.14 });
  });

  it("preserves unavailable market values as null", () => {
    expect(parseTeams({ Mexico: {
      win_prob: 0.1, sf_prob: 0.2, qf_prob: 0.3, market_price: null, edge: null,
    } })[0]).toMatchObject({ marketPrice: null, edge: null });
  });

  it("rejects malformed probabilities instead of coercing them to zero", () => {
    expect(() => parseFixtures([{ ...rawFixture, p_home: "bad" }])).toThrow(/p_home/);
  });
});
