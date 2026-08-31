import { describe, expect, it, vi } from "vitest";
import { ModelFixture, getModelFixtureKey } from "./model-data";
import {
  MARKET_ODDS_COLD_RETRY_MS,
  MARKET_ODDS_REFRESH_INTERVAL_MS,
  buildLedgerMarketComparisons,
  changedMarketSourceWarnings,
  getModelMarketOddsStatus,
  marketOddsRefreshDelay,
  marketOddsFixtureKey,
  publicModelFixture,
  refreshModelMarketOdds,
} from "./model-market-odds";
import { fetchAllMarketOdds, isSourceConfiguredForProfile } from "./fixture-market-sources";
import { getCachedModelData } from "./model-data";

// Only the network call is stubbed. The profile helpers are pure and carry the
// real per-competition source configuration, which is what the warning copy
// depends on.
vi.mock("./fixture-market-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fixture-market-sources")>();
  return {
    ...actual,
    fetchAllMarketOdds: vi.fn(),
    // Wrapped rather than replaced: it defaults to the real per-competition
    // configuration, and a test can override it to exercise the unconfigured
    // branch without depending on a source happening to be unwired today.
    isSourceConfiguredForProfile: vi.fn(actual.isSourceConfiguredForProfile),
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

  it("logs a disabled-source warning only when its status changes", () => {
    const disabled = "stake is disabled — known Cloudflare challenge";
    expect(changedMarketSourceWarnings({}, { stake: disabled })).toEqual([disabled]);
    expect(changedMarketSourceWarnings({ stake: disabled }, { stake: disabled })).toEqual([]);
    expect(changedMarketSourceWarnings(
      { stake: disabled },
      { stake: "stake request failed: unexpected failure" }
    )).toEqual(["stake request failed: unexpected failure"]);
  });

  it("maps available no-vig rows into timestamped ledger evidence", () => {
    const key = getModelFixtureKey(model);
    const comparisons = buildLedgerMarketComparisons(
      [model],
      new Map([[key, {
        stake: null,
        polymarket: null,
        kalshi: { pHome: 0.42, pDraw: 0.31, pAway: 0.27 },
      }]]),
      "2026-08-02T13:30:00.000Z"
    );
    expect(comparisons.get("eng.1:1")).toEqual([{
      source: "kalshi",
      sourceTimestamp: "2026-08-02T13:30:00.000Z",
      pHome: 0.42,
      pDraw: 0.31,
      pAway: 0.27,
    }]);
  });
});

describe("publicModelFixture", () => {
  const observedAt = "2026-08-27T11:15:32.945Z";

  it("leaves stake fields null and oddsSources empty when the cache has nothing", () => {
    const published = publicModelFixture(model, null);
    expect(published.stakePHome).toBeNull();
    expect(published.oddsSources).toEqual([]);
    expect(published).not.toHaveProperty("scorelines");
  });

  it("fills stakeP* from Stake and lists Kalshi then Polymarket", () => {
    const published = publicModelFixture(model, {
      observedAt,
      stake: { pHome: 0.61, pDraw: 0.22, pAway: 0.17 },
      kalshi: { pHome: 0.58, pDraw: 0.24, pAway: 0.18 },
      polymarket: { pHome: 0.55, pDraw: 0.25, pAway: 0.20 },
    });
    expect(published.stakePHome).toBe(0.61);
    expect(published.stakePDraw).toBe(0.22);
    expect(published.stakePAway).toBe(0.17);
    expect(published.stakeObservedAt).toBe(observedAt);
    expect(published.oddsSources).toEqual([
      { source: "kalshi", observedAt, pHome: 0.58, pDraw: 0.24, pAway: 0.18 },
      { source: "polymarket", observedAt, pHome: 0.55, pDraw: 0.25, pAway: 0.20 },
    ]);
  });

  it("drops an incomplete 1X2 rather than publishing a partial market", () => {
    const published = publicModelFixture(model, {
      observedAt,
      stake: { pHome: 0.61, pDraw: Number.NaN, pAway: 0.17 },
      kalshi: null,
      polymarket: { pHome: 0.55, pDraw: 0.25, pAway: 0.20 },
    });
    expect(published.stakePHome).toBeNull();
    expect(published).not.toHaveProperty("stakeObservedAt");
    expect(published.oddsSources).toEqual([
      { source: "polymarket", observedAt, pHome: 0.55, pDraw: 0.25, pAway: 0.20 },
    ]);
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
      odds: {
        stake: new Map(),
        polymarket: new Map(),
        kalshi: new Map([[key, { pHome: 0.42, pDraw: 0.31, pAway: 0.27 }]]),
      },
      errors: { stake: null, polymarket: null, kalshi: null },
    });

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    // Stake is switched off, so it reports as deliberate rather than as a miss.
    expect(status.sourceWarnings.stake).toMatch(/disabled/);
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
    expect(status.sourceWarnings.kalshi).toBeNull();
    expect(status.coverage).toEqual({
      stake: { matched: 0, total: 1 },
      polymarket: { matched: 0, total: 1 },
      kalshi: { matched: 1, total: 1 },
    });
    expect(marketOddsRefreshDelay(status)).toBe(MARKET_ODDS_REFRESH_INTERVAL_MS);
  });

  it("separates a source whose request failed from one that matched nothing", async () => {
    vi.mocked(getCachedModelData).mockReturnValue({
      fixtures: [model],
      lastUpdated: new Date(),
      error: null,
    });
    vi.mocked(fetchAllMarketOdds).mockResolvedValue({
      odds: {
        stake: new Map(),
        polymarket: new Map(),
        kalshi: new Map(),
      },
      errors: { stake: null, polymarket: null, kalshi: "429: rate limited" },
    });

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    // Rejected outright, not a naming problem — the warning has to say so or it
    // sends the reader after the wrong bug.
    expect(status.sourceWarnings.kalshi).toMatch(/request failed/);
    expect(status.sourceWarnings.kalshi).toContain("429");
    expect(status.sourceWarnings.kalshi).not.toMatch(/no matching fixtures/);
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
  });

  it("separates a source with no configuration from one that queried and matched nothing", async () => {
    vi.mocked(getCachedModelData).mockReturnValue({
      fixtures: [model],
      lastUpdated: new Date(),
      error: null,
    });
    vi.mocked(fetchAllMarketOdds).mockResolvedValue({
      odds: {
        stake: new Map(),
        polymarket: new Map(),
        kalshi: new Map(),
      },
      errors: { stake: null, polymarket: null, kalshi: null },
    });
    vi.mocked(isSourceConfiguredForProfile).mockImplementation((source) => source !== "kalshi");

    await refreshModelMarketOdds();
    const status = getModelMarketOddsStatus();
    // A source with nothing configured for this competition is never queried,
    // so it must not be reported as a query that matched nothing.
    expect(status.sourceWarnings.kalshi).toMatch(/not configured for premier-league/);
    expect(status.sourceWarnings.kalshi).not.toMatch(/no matching fixtures/);
    // A source that did run keeps the empty-result wording.
    expect(status.sourceWarnings.polymarket).toMatch(/no matching fixtures \(0\/1\)/);
    vi.mocked(isSourceConfiguredForProfile).mockReset();
  });

  it("keeps a Kalshi series wired for both club competitions", async () => {
    // Regression guard against the real config table, not the test double:
    // both club profiles shipped with seriesTicker null, so fetchKalshiOdds
    // returned early and Kalshi was never queried in production.
    const actual = await vi.importActual<typeof import("./fixture-market-sources")>(
      "./fixture-market-sources"
    );
    expect(actual.isSourceConfiguredForProfile("kalshi", "premier-league")).toBe(true);
    expect(actual.isSourceConfiguredForProfile("kalshi", "uefa-champions-league")).toBe(true);
  });
});
