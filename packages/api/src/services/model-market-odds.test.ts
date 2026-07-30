import { describe, expect, it, vi } from "vitest";
import { ModelFixture, getModelFixtureKey } from "./model-data";
import {
  MARKET_ODDS_COLD_RETRY_MS,
  MARKET_ODDS_REFRESH_INTERVAL_MS,
  getModelMarketOddsStatus,
  marketOddsRefreshDelay,
  marketOddsFixtureKey,
  refreshModelMarketOdds,
} from "./model-market-odds";
import { fetchAllMarketOdds } from "./fixture-market-sources";
import { getCachedModelData } from "./model-data";

// Only the network call is stubbed. The profile helpers are pure and carry the
// real per-competition source configuration, which is what the warning copy
// depends on.
vi.mock("./fixture-market-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fixture-market-sources")>();
  return {
    ...actual,
    fetchAllMarketOdds: vi.fn(),
  };
});
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
  it("stays unready and skips sources when the model never initialized", async () => {
    vi.mocked(getCachedModelData).mockReturnValue({
      fixtures: [],
      lastUpdated: null,
      error: "Club ratings are not ready",
    });
    vi.mocked(fetchAllMarketOdds).mockClear();

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();

    expect(fetchAllMarketOdds).not.toHaveBeenCalled();
    expect(status.ready).toBe(false);
    expect(status.lastUpdated).toBeNull();
    expect(status.error).toBe("Active model is not ready.");
    expect(marketOddsRefreshDelay(status)).toBe(MARKET_ODDS_COLD_RETRY_MS);
  });

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
    expect(marketOddsRefreshDelay(status)).toBe(MARKET_ODDS_REFRESH_INTERVAL_MS);
  });

  it("separates a source with no configuration from one that queried and matched nothing", async () => {
    vi.mocked(getCachedModelData).mockReturnValue({
      fixtures: [model],
      lastUpdated: new Date(),
      error: null,
    });
    vi.mocked(fetchAllMarketOdds).mockResolvedValue({
      stake: new Map(),
      polymarket: new Map(),
      kalshi: new Map(),
    });

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    // Kalshi has no series ticker for a club competition, so no request is made.
    expect(status.sourceWarnings.kalshi).toMatch(/not configured for premier-league/);
    expect(status.sourceWarnings.kalshi).not.toMatch(/no matching fixtures/);
    // Stake and Polymarket were queried and genuinely matched nothing.
    expect(status.sourceWarnings.stake).toMatch(/no matching fixtures \(0\/1\)/);
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
  });
});
