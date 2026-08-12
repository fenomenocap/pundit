import { describe, expect, it } from "vitest";
import { ActiveFixture } from "./active-fixtures";
import { ModelDataCache, ModelFixture } from "./model-data";
import { evaluateReadiness } from "./readiness";

const activeFixture = (id = 1): ActiveFixture => ({
  id,
  competitionId: "eng.1",
  competition: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  utcDate: "2026-08-02T15:00:00.000Z",
  status: "SCHEDULED",
  stage: null,
  matchday: null,
  group: null,
  score: null,
  featured: false,
});

const modelFixture = (fixtureId = 1): ModelFixture => ({
  competitionId: "eng.1",
  competition: "Premier League",
  fixtureId,
  utcDate: "2026-08-02T15:00:00.000Z",
  date: "2026-08-02",
  group: null,
  stage: "match",
  home: "Arsenal",
  away: "Chelsea",
  homeElo: 1800,
  awayElo: 1750,
  pHome: 0.4,
  pDraw: 0.3,
  pAway: 0.3,
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
});

const model = (overrides: Partial<ModelDataCache> = {}): ModelDataCache => ({
  fixtures: [],
  lastUpdated: null,
  error: null,
  ...overrides,
});

const football = { lastUpdated: new Date(), error: null };
const odds = { ready: true, lastUpdated: new Date(), error: null };

describe("evaluateReadiness", () => {
  it("fails closed when active fixtures exist but the model never initialized", () => {
    const state = evaluateReadiness(
      model({ error: "Club ratings are not ready" }),
      football,
      [activeFixture()],
      odds
    );
    expect(state).toMatchObject({ ready: false, modelReady: false });
  });

  it("accepts a successfully refreshed legitimate zero-fixture window", () => {
    const state = evaluateReadiness(
      model({ lastUpdated: new Date() }),
      football,
      [],
      odds
    );
    expect(state).toEqual({
      ready: true,
      modelReady: true,
      footballReady: true,
      marketOddsReady: true,
    });
  });

  it("accepts an exact retained last-good model but rejects a stale fixture set", () => {
    const retained = model({
      fixtures: [modelFixture(1)],
      lastUpdated: new Date(),
      error: "latest refresh failed",
    });
    expect(evaluateReadiness(retained, football, [activeFixture(1)], odds).modelReady)
      .toBe(true);
    expect(evaluateReadiness(retained, football, [activeFixture(2)], odds).modelReady)
      .toBe(false);
  });

  it("reports football and market dependency failures independently", () => {
    const currentModel = model({
      fixtures: [modelFixture()],
      lastUpdated: new Date(),
    });
    const footballFailure = evaluateReadiness(
      currentModel,
      { lastUpdated: new Date(), error: "All competition refreshes failed." },
      [activeFixture()],
      odds
    );
    expect(footballFailure).toMatchObject({
      ready: false,
      modelReady: true,
      footballReady: false,
      marketOddsReady: true,
    });

    const oddsFailure = evaluateReadiness(
      currentModel,
      football,
      [activeFixture()],
      { ready: false, lastUpdated: null, error: "Active model is not ready." }
    );
    expect(oddsFailure).toMatchObject({
      ready: true,
      modelReady: true,
      footballReady: true,
      marketOddsReady: false,
    });
  });
});
