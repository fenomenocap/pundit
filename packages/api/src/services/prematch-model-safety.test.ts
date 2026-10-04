import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ActiveFixture } from "./active-fixtures";
import { buildGrounding, prepareAsk, sanitizeFixtureCoverageAnswer } from "./ask";
import { getCachedMatches, replaceFootballDataForTests } from "./football-data";
import {
  evaluateFixtureCapability,
  getRecognizedFixtures,
  recognizeEspnFixture,
  replaceFixtureRegistryForTests,
} from "./fixture-registry";
import {
  buildModelFixtureFromActive,
  findModelFixtureByTeams,
  getCachedModelData,
  getModelFixtureKey,
  modelDataCoversActiveFixtures,
  replaceModelDataForTests,
} from "./model-data";
import {
  getCachedFixtureMarketOdds,
  publicModelFixtures,
  refreshModelMarketOdds,
} from "./model-market-odds";
import { fetchAllMarketOdds } from "./fixture-market-sources";

vi.mock("./fixture-market-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fixture-market-sources")>();
  return { ...actual, fetchAllMarketOdds: vi.fn() };
});

const originalDataDir = process.env.PUNDIT_DATA_DIR;
const originalRegistryEnabled = process.env.FIXTURE_REGISTRY_ENABLED;
const initialFootball = getCachedMatches();
const initialModel = getCachedModelData();
const initialRegistry = getRecognizedFixtures();
let testDataDir: string;
const scheduled: ActiveFixture = {
  id: 401879268,
  competitionId: "eng.1",
  competition: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Leeds",
  utcDate: "2026-10-10T11:30:00Z",
  status: "SCHEDULED",
  stage: null,
  matchday: null,
  group: null,
  score: null,
  neutralVenue: false,
  featured: false,
};
const inPlay: ActiveFixture = { ...scheduled, status: "IN_PLAY", score: { home: 0, away: 4 } };
const ratings = {
  world: new Map<string, number>(),
  "eng-clubs": new Map([["Arsenal", 2040.3], ["Leeds", 1816.5]]),
  "uefa-clubs": new Map<string, number>(),
};
const model = buildModelFixtureFromActive(scheduled, ratings)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-prematch-safety-"));
  process.env.PUNDIT_DATA_DIR = testDataDir;
  process.env.FIXTURE_REGISTRY_ENABLED = "false";
  replaceFootballDataForTests({ upcoming: [scheduled], recent: [] });
  replaceFixtureRegistryForTests([recognizeEspnFixture(scheduled)]);
  replaceModelDataForTests({ fixtures: [model], lastUpdated: new Date() });
  vi.mocked(fetchAllMarketOdds).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  replaceFootballDataForTests(initialFootball);
  replaceFixtureRegistryForTests(initialRegistry);
  replaceModelDataForTests(initialModel);
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
  if (originalRegistryEnabled === undefined) delete process.env.FIXTURE_REGISTRY_ENABLED;
  else process.env.FIXTURE_REGISTRY_ENABLED = originalRegistryEnabled;
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe("pre-match forecast safety", () => {
  it("does not give a 0–4 live match a pre-match under-2.5 probability", () => {
    expect(model.pUnder2_5).toBeGreaterThan(0);
    expect(buildModelFixtureFromActive(inPlay, ratings)).toBeNull();
  });

  it("retains recognized in-play identity while rejecting an injected scheduled model row", () => {
    const recognized = recognizeEspnFixture(inPlay);
    expect(recognized.fixtureId).toBe("espn:eng.1:401879268");
    expect(evaluateFixtureCapability(recognized, {
      modelFixture: model,
      modelInitialized: true,
      ratingsAvailable: true,
    })).toEqual({ status: "outside-coverage", reason: "in-play-model-unavailable" });
    const grounding = {
      kind: "fixture" as const,
      fixture: recognized,
      capability: { status: "outside-coverage" as const, reason: "in-play-model-unavailable" as const },
    };
    expect(sanitizeFixtureCoverageAnswer("Arsenal will win", grounding)).toMatch(/This match.*underway/i);
    expect(sanitizeFixtureCoverageAnswer("Arsenal will win", grounding)).toContain("I don’t have a live match forecast");
  });

  it("suppresses a cached forecast as soon as ESPN changes to in-play, before registry/model refresh", () => {
    expect(getCachedModelData().fixtures).toHaveLength(1);
    replaceFootballDataForTests({ upcoming: [], recent: [inPlay] });
    expect(getCachedModelData().fixtures).toEqual([]);
    expect(findModelFixtureByTeams("Arsenal", "Leeds")).toBeUndefined();
    expect(publicModelFixtures([model])).toEqual([]);
  });

  it("also suppresses a cached forecast when recognition advances ahead of the scoreboard", () => {
    replaceFixtureRegistryForTests([recognizeEspnFixture(inPlay)]);
    expect(getCachedModelData().fixtures).toEqual([]);
    expect(publicModelFixtures([model])).toEqual([]);
  });

  it("does not join cached pre-match market odds after the match starts", async () => {
    vi.mocked(fetchAllMarketOdds).mockResolvedValue({
      odds: {
        stake: new Map(),
        polymarket: new Map(),
        kalshi: new Map([[getModelFixtureKey(model), { pHome: 0.7, pDraw: 0.2, pAway: 0.1 }]]),
      },
      errors: { stake: null, polymarket: null, kalshi: null },
    });
    await refreshModelMarketOdds();
    expect(getCachedFixtureMarketOdds(model)?.kalshi?.pHome).toBe(0.7);
    replaceFootballDataForTests({ upcoming: [inPlay] });
    expect(getCachedFixtureMarketOdds(model)).toBeNull();
    expect(publicModelFixtures([model])).toEqual([]);
  });

  it("withholds a cached grid at kickoff even when the ESPN status is still scheduled", () => {
    vi.setSystemTime(new Date(scheduled.utcDate));
    expect(getCachedModelData().fixtures).toEqual([]);
    expect(publicModelFixtures([model])).toEqual([]);
    expect(getCachedFixtureMarketOdds(model)).toBeNull();
    const prepared = prepareAsk("Give me Arsenal vs Leeds probabilities", []);
    expect(prepared.candidateUnrecognized).toBe(false);
    expect(prepared.grounding).toMatchObject({
      kind: "fixture",
      fixture: { fixtureId: "espn:eng.1:401879268" },
      capability: { status: "outside-coverage", reason: "in-play-model-unavailable" },
    });
  });

  it.each(["false", "true"])("keeps the underway identity when ESPN advances before recognition (registry=%s)", (enabled) => {
    process.env.FIXTURE_REGISTRY_ENABLED = enabled;
    replaceFootballDataForTests({ upcoming: [], recent: [inPlay] });
    const prepared = prepareAsk("Give me Arsenal vs Leeds probabilities", []);
    expect(prepared.candidateUnrecognized).toBe(false);
    expect(prepared.grounding).toMatchObject({
      kind: "fixture",
      fixture: { fixtureId: "espn:eng.1:401879268", status: "in-play" },
      capability: { status: "outside-coverage", reason: "in-play-model-unavailable" },
    });
  });

  it("does not retry model coverage merely because an in-play fixture cannot be priced", () => {
    expect(modelDataCoversActiveFixtures({ fixtures: [], lastUpdated: new Date() }, [inPlay])).toBe(true);
  });

  it.each([true, false])("reports the home advantage actually used when neutralVenue=%s", (neutralVenue) => {
    const forecast = buildModelFixtureFromActive({ ...scheduled, neutralVenue }, ratings)!;
    expect(forecast.forecastProvenance?.homeAdvantageElo).toBe(neutralVenue ? 0 : 42);
    expect(buildGrounding(forecast).homeFieldAdvantage).toBe(!neutralVenue);
  });
});
