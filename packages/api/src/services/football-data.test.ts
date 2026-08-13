import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildFetchDateRange,
  deserialiseSeasonSchedule,
  getCachedSeasonSchedule,
  loadPersistedSeasonSchedule,
  nextSeasonScheduleCache,
  parseEvent,
  persistSeasonSchedule,
  premierLeagueSeasonWindow,
  replaceSeasonScheduleForTests,
  serialiseSeasonSchedule,
  seasonScheduleStatus,
  espnFetch,
  refreshFootballData,
  seasonScheduleRefreshDue,
  validateCompletePremierLeagueSchedule,
  type FootballMatch,
  type SeasonScheduleCache,
} from "./football-data";

const wcContext = { competitionId: "fifa.world", competitionName: "FIFA World Cup" };
const originalDataDir = process.env.PUNDIT_DATA_DIR;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
});

const seasonFixture: FootballMatch = {
  id: 401,
  competitionId: "eng.1",
  competition: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Liverpool",
  utcDate: "2026-08-20T14:00:00.000Z",
  status: "SCHEDULED",
  stage: null,
  matchday: null,
  group: null,
  score: null,
};

function completeLeagueSchedule(): FootballMatch[] {
  const teams = Array.from({ length: 20 }, (_, index) => `Team ${index + 1}`);
  let id = 1;
  return teams.flatMap((home) => teams
    .filter((away) => away !== home)
    .map((away) => ({
      ...seasonFixture,
      id: id++,
      homeTeam: home,
      awayTeam: away,
    })));
}

function stubRollingEspn(): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => url.includes("standings") ? { children: [] } : { events: [] },
    text: async () => "",
  } as Response)));
}

describe("ESPN model inputs", () => {
  it("carries ESPN's authoritative penalty winner and canonical team names", () => {
    const match = parseEvent({
      id: "1",
      date: "2026-07-01T19:00Z",
      season: { slug: "round-of-32" },
      competitions: [{
        status: { type: { state: "post", completed: true } },
        competitors: [
          { homeAway: "home", team: { displayName: "Türkiye" }, score: "1", winner: false },
          { homeAway: "away", team: { displayName: "United States" }, score: "1", winner: true },
        ],
      }],
    }, wcContext);
    expect(match).toMatchObject({
      competitionId: "fifa.world",
      homeTeam: "Turkey",
      awayTeam: "USA",
      stage: "round-of-32",
      score: { home: 1, away: 1 },
      winner: "USA",
    });
  });

  it("keeps live scores while a match is in play", () => {
    const match = parseEvent({
      id: "2",
      date: "2026-07-14T19:00Z",
      season: { slug: "semifinals" },
      competitions: [{
        status: { type: { state: "in", completed: false } },
        competitors: [
          { homeAway: "home", team: { displayName: "England" }, score: "2", winner: false },
          { homeAway: "away", team: { displayName: "France" }, score: "1", winner: false },
        ],
      }],
    }, wcContext);
    expect(match).toMatchObject({
      status: "IN_PLAY",
      score: { home: 2, away: 1 },
      winner: null,
    });
  });

  it.each([
    ["STATUS_CANCELED", "CANCELLED"],
    ["STATUS_POSTPONED", "POSTPONED"],
  ])("preserves exact ESPN %s status instead of treating state=post as finished", (
    statusName,
    expected
  ) => {
    const match = parseEvent({
      id: "3",
      date: "2026-08-18T19:00Z",
      competitions: [{
        status: { type: { state: "post", completed: false, name: statusName } },
        competitors: [
          { homeAway: "home", team: { displayName: "Arsenal" } },
          { homeAway: "away", team: { displayName: "Liverpool" } },
        ],
      }],
    }, wcContext);
    expect(match.status).toBe(expected);
  });

  it("preserves ESPN venue and neutral-site metadata for fixture recognition", () => {
    const match = parseEvent({
      id: "4",
      date: "2026-08-18T19:00Z",
      competitions: [{
        neutralSite: true,
        venue: { fullName: "National Stadium" },
        status: { type: { state: "pre", completed: false } },
        competitors: [
          { homeAway: "home", team: { displayName: "Arsenal" } },
          { homeAway: "away", team: { displayName: "Liverpool" } },
        ],
      }],
    }, wcContext);
    expect(match).toMatchObject({ venue: "National Stadium", neutralVenue: true });
  });

  it("normalizes ESPN's omitted neutral flag only for validated model competitions", () => {
    const event = {
      id: "5",
      date: "2026-08-22T14:00Z",
      competitions: [{
        venue: { fullName: "Emirates Stadium" },
        status: { type: { state: "pre", completed: false } },
        competitors: [
          { homeAway: "home", team: { displayName: "Arsenal" } },
          { homeAway: "away", team: { displayName: "Liverpool" } },
        ],
      }],
    };
    expect(parseEvent(event, {
      competitionId: "eng.1",
      competitionName: "Premier League",
    }).neutralVenue).toBe(false);
    expect(parseEvent(event, wcContext).neutralVenue).toBeNull();
  });

  it("builds rolling fetch windows for club competitions", () => {
    const range = buildFetchDateRange({
      id: "eng.1",
      name: "Premier League",
      espnScoreboardPath: "eng.1",
      fetchDaysPast: 7,
      fetchDaysFuture: 14,
      type: "league",
      enabled: true,
      priority: 1,
      ratingProfile: "eng-clubs",
      marketProfile: "premier-league",
      homeFieldAdvantage: true,
    });
    expect(range).toMatch(/^\d{8}-\d{8}$/);
  });

  it("builds a complete season-aware Premier League window", () => {
    expect(premierLeagueSeasonWindow(new Date("2026-08-13T00:00:00Z"))).toEqual({
      seasonId: "2026-27",
      dateRange: "20260701-20270630",
    });
    expect(premierLeagueSeasonWindow(new Date("2027-01-01T00:00:00Z"))).toEqual({
      seasonId: "2026-27",
      dateRange: "20260701-20270630",
    });
  });

  it("refreshes the large season payload only when its six-hour cache is due", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    expect(seasonScheduleRefreshDue({ seasonId: "2026-27", lastUpdated: null }, now)).toBe(true);
    expect(seasonScheduleRefreshDue({
      seasonId: "2026-27",
      lastUpdated: new Date("2026-08-13T07:00:01Z"),
    }, now)).toBe(false);
    expect(seasonScheduleRefreshDue({
      seasonId: "2026-27",
      lastUpdated: new Date("2026-08-13T06:00:00Z"),
    }, now)).toBe(true);
    expect(seasonScheduleRefreshDue({
      seasonId: "2025-26",
      lastUpdated: new Date("2026-08-13T11:59:00Z"),
    }, now)).toBe(true);
  });

  it("integrates the six-hour skip and due decisions into the refresh", async () => {
    stubRollingEspn();
    const seasonFetch = vi.fn(async () => ({
      seasonId: premierLeagueSeasonWindow().seasonId,
      fixtures: completeLeagueSchedule(),
    }));
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: premierLeagueSeasonWindow().seasonId,
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date(),
      error: null,
      servingLastGood: false,
    });
    await refreshFootballData({ fetchSeason: seasonFetch });
    expect(seasonFetch).not.toHaveBeenCalled();

    replaceSeasonScheduleForTests({
      ...getCachedSeasonSchedule(),
      lastUpdated: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });
    await refreshFootballData({ fetchSeason: seasonFetch });
    expect(seasonFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds a never-settling ESPN request and keeps last-good usable", async () => {
    const neverSettlingFetch = (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    vi.stubGlobal("fetch", vi.fn(neverSettlingFetch));
    await expect(espnFetch("https://example.test/never", 5)).rejects.toBeTruthy();

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://example.test/never") return neverSettlingFetch(url, init);
      return {
        ok: true,
        status: 200,
        json: async () => url.includes("standings") ? { children: [] } : { events: [] },
        text: async () => "",
      } as Response;
    }));
    const prior = completeLeagueSchedule();
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: premierLeagueSeasonWindow().seasonId,
      fixtures: prior,
      lastUpdated: new Date(Date.now() - 7 * 60 * 60 * 1000),
      error: null,
      servingLastGood: false,
    });
    await refreshFootballData({
      fetchSeason: async () => espnFetch("https://example.test/never", 5),
    });
    const retained = getCachedSeasonSchedule();
    expect(retained.fixtures).toEqual(prior);
    expect(retained.error).toBeTruthy();
    expect(retained.servingLastGood).toBe(true);
  });

  it("accepts only a complete 380-fixture directed round robin", () => {
    const complete = completeLeagueSchedule();
    expect(() => validateCompletePremierLeagueSchedule(complete)).not.toThrow();
    expect(() => validateCompletePremierLeagueSchedule(complete.slice(0, 379)))
      .toThrow(/380-fixture/);
    expect(() => validateCompletePremierLeagueSchedule([
      ...complete.slice(0, 379),
      { ...complete[0], id: 999 },
    ])).toThrow(/380-fixture/);
  });

  it("does not replace last-good after a truncated schedule fails validation", () => {
    const complete = completeLeagueSchedule();
    const prior: SeasonScheduleCache = {
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: complete,
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
      servingLastGood: false,
    };
    let reason: Error | null = null;
    try {
      validateCompletePremierLeagueSchedule(complete.slice(0, 379));
    } catch (error) {
      reason = error as Error;
    }
    const retained = nextSeasonScheduleCache(prior, { status: "rejected", reason });
    expect(retained.fixtures).toEqual(complete);
    expect(retained.lastUpdated).toEqual(prior.lastUpdated);
    expect(retained.error).toMatch(/380-fixture/);
  });

  it("retains the last-good complete schedule on refresh failure", () => {
    const prior: SeasonScheduleCache = {
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: [seasonFixture],
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
      servingLastGood: false,
    };
    const failed = nextSeasonScheduleCache(prior, {
      status: "rejected",
      reason: new Error("ESPN timeout"),
    }, new Date("2026-08-14T00:00:00Z"));
    expect(failed.fixtures).toEqual([seasonFixture]);
    expect(failed.lastUpdated).toEqual(prior.lastUpdated);
    expect(failed.error).toBe("ESPN timeout");
  });

  it("round-trips and validates the persisted season schedule", () => {
    const state: SeasonScheduleCache = {
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
      servingLastGood: false,
    };
    const persisted = serialiseSeasonSchedule(state)!;
    expect(deserialiseSeasonSchedule(persisted)).toMatchObject({
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
    });
    expect(deserialiseSeasonSchedule({ ...persisted, fixtures: [] })).toBeNull();
    expect(deserialiseSeasonSchedule({
      ...persisted,
      fixtures: [{ ...seasonFixture, competitionId: "uefa.champions_qual" }],
    })).toBeNull();
  });

  it("reports only a fresh current-season error-free schedule ready", () => {
    const now = new Date("2026-08-13T12:00:00Z");
    const healthy: SeasonScheduleCache = {
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date("2026-08-13T11:00:00Z"),
      error: null,
      servingLastGood: false,
    };
    expect(seasonScheduleStatus(healthy, now)).toMatchObject({
      ready: true, ageMinutes: 60, servingLastGood: false,
    });
    expect(seasonScheduleStatus({ ...healthy, seasonId: "2025-26" }, now).ready).toBe(false);
    expect(seasonScheduleStatus({ ...healthy, error: "timeout", servingLastGood: true }, now))
      .toMatchObject({ ready: false, servingLastGood: true });
    expect(seasonScheduleStatus({
      ...healthy, lastUpdated: new Date("2026-08-13T05:00:00Z"),
    }, now).ready).toBe(false);
  });

  it("preserves the previous generation when installing the new primary fails", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-season-write-"));
    process.env.PUNDIT_DATA_DIR = dataDir;
    const oldState: SeasonScheduleCache = {
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
      servingLastGood: false,
    };
    persistSeasonSchedule(oldState);
    const newState = {
      ...oldState,
      fixtures: oldState.fixtures.map((fixture) => ({
        ...fixture,
        utcDate: "2026-08-21T14:00:00.000Z",
      })),
      lastUpdated: new Date("2026-08-14T00:00:00Z"),
    };
    const primaryPath = path.join(dataDir, "cache", "eng-1-season-schedule.json");
    const recoveryPath = path.join(dataDir, "cache", "eng-1-season-schedule.last-good.json");
    persistSeasonSchedule(newState, (target, value) => {
      if (target === primaryPath) throw new Error("primary install failed");
      fs.writeFileSync(target, JSON.stringify(value), "utf8");
    });
    const primary = JSON.parse(fs.readFileSync(primaryPath, "utf8"));
    const recovery = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
    expect(primary.lastUpdated).toBe("2026-08-13T00:00:00.000Z");
    expect(recovery.lastUpdated).toBe("2026-08-13T00:00:00.000Z");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("recovers from a corrupt primary using the atomic last-good copy", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-season-"));
    process.env.PUNDIT_DATA_DIR = dataDir;
    const persisted = serialiseSeasonSchedule({
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date("2026-08-13T00:00:00Z"),
      error: null,
      servingLastGood: false,
    })!;
    const cacheDir = path.join(dataDir, "cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "eng-1-season-schedule.json"), "{ corrupt", "utf8");
    fs.writeFileSync(
      path.join(cacheDir, "eng-1-season-schedule.last-good.json"),
      JSON.stringify(persisted),
      "utf8"
    );
    expect(loadPersistedSeasonSchedule()).toBe(true);
    expect(getCachedSeasonSchedule().fixtures).toHaveLength(380);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
