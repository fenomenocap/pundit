import { describe, expect, it } from "vitest";
import type { FootballMatch } from "../services/football-data";
import {
  buildFreshnessSnapshot,
  FOOTBALL_REFRESH_LIVE_MS,
  FOOTBALL_REFRESH_MATCHDAY_MS,
  FOOTBALL_REFRESH_NORMAL_MS,
  MARKET_ODDS_REFRESH_LIVE_MS,
} from "./freshness-policy";

function match(partial: Partial<FootballMatch> & Pick<FootballMatch, "status" | "utcDate">): FootballMatch {
  return {
    id: 1,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    ...partial,
  };
}

describe("buildFreshnessSnapshot", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");

  it("uses live intervals when any fixture is in play", () => {
    const snapshot = buildFreshnessSnapshot([
      match({ status: "IN_PLAY", utcDate: "2026-09-09T12:00:00.000Z" }),
    ], now);
    expect(snapshot.tier).toBe("live");
    expect(snapshot.footballRefreshMs).toBe(FOOTBALL_REFRESH_LIVE_MS);
    expect(snapshot.marketOddsRefreshMs).toBe(MARKET_ODDS_REFRESH_LIVE_MS);
  });

  it("uses matchday intervals for kickoffs within 24 hours", () => {
    const snapshot = buildFreshnessSnapshot([
      match({ status: "SCHEDULED", utcDate: "2026-09-09T20:00:00.000Z" }),
    ], now);
    expect(snapshot.tier).toBe("matchday");
    expect(snapshot.footballRefreshMs).toBe(FOOTBALL_REFRESH_MATCHDAY_MS);
  });

  it("uses normal intervals when nothing is live or imminent", () => {
    const snapshot = buildFreshnessSnapshot([
      match({ status: "SCHEDULED", utcDate: "2026-09-15T15:00:00.000Z" }),
    ], now);
    expect(snapshot.tier).toBe("normal");
    expect(snapshot.footballRefreshMs).toBe(FOOTBALL_REFRESH_NORMAL_MS);
  });
});
