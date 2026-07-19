import { describe, expect, it, vi } from "vitest";
import { normalizedTeamPairKey } from "../lib/team-names";
import {
  getModelMarketOddsStatus,
  marketOddsFixtureKey,
  refreshModelMarketOdds,
} from "./model-market-odds";
import {
  fetchKalshiOdds,
  fetchPolymarketOdds,
  fetchStakeOdds,
} from "./fixture-market-sources";
import { getFeaturedFixtures } from "./featured-fixtures";

vi.mock("./fixture-market-sources", () => ({
  fetchStakeOdds: vi.fn(),
  fetchPolymarketOdds: vi.fn(),
  fetchKalshiOdds: vi.fn(),
}));
vi.mock("./featured-fixtures", () => ({
  getFeaturedFixtures: vi.fn(),
}));

describe("marketOddsFixtureKey", () => {
  it("is insensitive to team order and name variants", () => {
    expect(marketOddsFixtureKey("2026-07-19", "Spain", "Argentina"))
      .toBe(marketOddsFixtureKey("2026-07-19", "Argentina", "Spain"));
    expect(marketOddsFixtureKey("2026-07-19", "USA", "England"))
      .toBe(marketOddsFixtureKey("2026-07-19", "England", "United States"));
  });

  it("distinguishes the same pairing on different dates", () => {
    expect(marketOddsFixtureKey("2026-07-19", "Spain", "Argentina"))
      .not.toBe(marketOddsFixtureKey("2026-07-18", "Spain", "Argentina"));
  });
});

describe("refreshModelMarketOdds", () => {
  it("warns on thrown and silent-empty sources, and reports coverage", async () => {
    const model = { date: "2026-07-19", home: "Spain", away: "Argentina" };
    vi.mocked(getFeaturedFixtures).mockReturnValue([{ model }] as never);
    vi.mocked(fetchStakeOdds).mockRejectedValue(new Error("403: blocked"));
    vi.mocked(fetchPolymarketOdds).mockResolvedValue(new Map());
    vi.mocked(fetchKalshiOdds).mockResolvedValue(new Map([[
      normalizedTeamPairKey("Spain", "Argentina"),
      { pHome: 0.42, pDraw: 0.31, pAway: 0.27 },
    ]]));

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    expect(status.sourceWarnings.stake).toMatch(/fetch failed/);
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
    expect(status.sourceWarnings.kalshi).toBeNull();
    expect(status.coverage).toEqual({
      stake: { matched: 0, total: 1 },
      polymarket: { matched: 0, total: 1 },
      kalshi: { matched: 1, total: 1 },
    });
  });
});
