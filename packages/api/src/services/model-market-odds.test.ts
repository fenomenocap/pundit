import { describe, expect, it, vi } from "vitest";
import { ModelFixture, getModelFixtureKey } from "./model-data";
import {
  getModelMarketOddsStatus,
  marketOddsFixtureKey,
  refreshModelMarketOdds,
} from "./model-market-odds";
import { fetchAllMarketOdds } from "./fixture-market-sources";
import { getCachedModelData } from "./model-data";

vi.mock("./fixture-market-sources", () => ({
  fetchAllMarketOdds: vi.fn(),
}));
vi.mock("./model-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model-data")>();
  return {
    ...actual,
    getCachedModelData: vi.fn(),
  };
});

const model: ModelFixture = {
  competitionId: "eng.1",
  competition: "Premier League",
  fixtureId: 1,
  utcDate: "2026-08-02T15:00:00.000Z",
  date: "2026-08-02",
  group: null,
  stage: "match",
  home: "Arsenal",
  away: "Coventry City",
  homeElo: 1800,
  awayElo: 1600,
  pHome: 0.5,
  pDraw: 0.25,
  pAway: 0.25,
  pOver2_5: 0.5,
  pUnder2_5: 0.5,
  pBttsYes: 0.5,
  pBttsNo: 0.5,
  topScores: [],
  scorelines: [],
  stakePHome: null,
  stakePDraw: null,
  stakePAway: null,
  result: null,
};

describe("marketOddsFixtureKey", () => {
  it("uses the competition-aware fixture key", () => {
    expect(marketOddsFixtureKey(model)).toContain("eng.1");
    expect(marketOddsFixtureKey(model)).toContain("2026-08-02");
  });
});

describe("refreshModelMarketOdds", () => {
  it("warns on silent-empty sources and reports coverage", async () => {
    vi.mocked(getCachedModelData).mockReturnValue({
      fixtures: [model],
      lastUpdated: new Date(),
      error: null,
    });
    const key = getModelFixtureKey(model);
    vi.mocked(fetchAllMarketOdds).mockResolvedValue({
      stake: new Map(),
      polymarket: new Map(),
      kalshi: new Map([[key, { pHome: 0.42, pDraw: 0.31, pAway: 0.27 }]]),
    });

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    expect(status.sourceWarnings.stake).toMatch(/no matching fixtures \(0\/1\)/);
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
    expect(status.sourceWarnings.kalshi).toBeNull();
    expect(status.coverage).toEqual({
      stake: { matched: 0, total: 1 },
      polymarket: { matched: 0, total: 1 },
      kalshi: { matched: 1, total: 1 },
    });
  });
});
