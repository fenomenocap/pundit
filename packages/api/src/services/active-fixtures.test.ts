import { describe, expect, it } from "vitest";
import { FootballMatch } from "./football-data";
import {
  ACTIVE_FIXTURE_HORIZON_MS,
  isActiveFootballMatch,
  selectActiveFixtures,
} from "./active-fixtures";

const baseMatch = (overrides: Partial<FootballMatch>): FootballMatch => ({
  id: 1,
  competitionId: "eng.1",
  competition: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  utcDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  status: "SCHEDULED",
  stage: null,
  matchday: null,
  group: null,
  score: null,
  ...overrides,
});

describe("active fixtures", () => {
  it("accepts scheduled fixtures with known teams inside the horizon", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const match = baseMatch({ utcDate: "2026-08-01T15:00:00.000Z" });
    expect(isActiveFootballMatch(match, now)).toBe(true);
  });

  it("rejects placeholder teams and fixtures outside the horizon", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    expect(isActiveFootballMatch(baseMatch({ homeTeam: "TBD" }), now)).toBe(false);
    expect(isActiveFootballMatch(
      baseMatch({ utcDate: "2026-08-30T15:00:00.000Z" }),
      now,
      ACTIVE_FIXTURE_HORIZON_MS
    )).toBe(false);
  });

  it("keeps in-play fixtures even when kickoff is in the past", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const match = baseMatch({
      status: "IN_PLAY",
      utcDate: "2026-07-28T11:00:00.000Z",
      score: { home: 1, away: 0 },
    });
    expect(isActiveFootballMatch(match, now)).toBe(true);
  });

  it("filters to enabled competitions and sorts by kickoff", () => {
    const fixtures = selectActiveFixtures([
      baseMatch({ id: 2, competitionId: "uefa.champions_qual", utcDate: "2026-08-03T15:00:00.000Z" }),
      baseMatch({ id: 1, utcDate: "2026-08-01T15:00:00.000Z" }),
      baseMatch({ id: 3, competitionId: "fifa.world", utcDate: "2026-08-02T15:00:00.000Z" }),
    ], new Set(["eng.1", "uefa.champions_qual"]), Date.parse("2026-07-28T12:00:00.000Z"));
    expect(fixtures.map((fixture) => fixture.id)).toEqual([1, 2]);
  });
});
