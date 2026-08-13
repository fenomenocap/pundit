import { describe, expect, it } from "vitest";
import {
  HistoricalFixture,
  HistoricalSeasonSpec,
  parseHistoricalScoreboard,
  validateHistoricalSeason,
} from "./club-history-corpus";

const leagueSpec: HistoricalSeasonSpec = {
  competitionId: "eng.1",
  competition: "Premier League",
  seasonId: "test",
  eventSeasonYear: 2024,
  dateRange: "20240801-20250630",
  completenessMode: "league-round-robin",
  expectedFixtureCount: 2,
  expectedTeamCount: 2,
  expectedMatchesPerTeam: 2,
};

function fixture(id: string, homeId: string, awayId: string): HistoricalFixture {
  return {
    source: "espn",
    sourceEventId: id,
    sourceEventUid: `event:${id}`,
    competitionId: "eng.1",
    seasonId: "test",
    eventSeasonYear: 2024,
    kickoff: `2024-08-${id.padStart(2, "0")}T15:00:00Z`,
    home: { sourceTeamId: homeId, sourceName: homeId, canonicalName: homeId },
    away: { sourceTeamId: awayId, sourceName: awayId, canonicalName: awayId },
    homeGoals: 1,
    awayGoals: 0,
    finalStatusName: "STATUS_FULL_TIME",
    finalStatusDetail: "FT",
    regulationTimeScore: true,
    trainingEligible: true,
    wasSuspended: null,
    neutralSite: null,
    venue: { sourceVenueId: null, name: null },
  };
}

describe("club history corpus", () => {
  it("passes a complete home-and-away league schedule", () => {
    const validation = validateHistoricalSeason([
      fixture("1", "A", "B"),
      fixture("2", "B", "A"),
    ], leagueSpec);
    expect(validation.status).toBe("pass");
    expect(validation.errors).toEqual([]);
  });

  it("fails duplicate and incomplete league evidence", () => {
    const validation = validateHistoricalSeason([
      fixture("1", "A", "B"),
      fixture("1", "A", "B"),
    ], leagueSpec);
    expect(validation.status).toBe("fail");
    expect(validation.duplicateEventIds).toEqual(["1"]);
    expect(validation.errors).toContain("Home/away round-robin pairing is incomplete.");
  });

  it("marks qualifying coverage inconclusive and excludes non-regulation scores", () => {
    const spec = { ...leagueSpec, competitionId: "uefa.champions_qual" as const,
      completenessMode: "structural-only" as const, expectedFixtureCount: null,
      expectedTeamCount: null, expectedMatchesPerTeam: null };
    const aet = { ...fixture("1", "A", "B"), competitionId: spec.competitionId,
      finalStatusName: "STATUS_FINAL_AET", regulationTimeScore: false,
      trainingEligible: false };
    const validation = validateHistoricalSeason([aet], spec);
    expect(validation.status).toBe("inconclusive");
    expect(validation.trainingEligibleCount).toBe(0);
    expect(validation.nonRegulationFinalCount).toBe(1);
  });

  it("uses event-level season metadata and records a misleading top-level season", () => {
    const raw = JSON.stringify({
      leagues: [{ season: { year: 2026, displayName: "2026-27" } }],
      events: [{
        id: "10",
        uid: "event:10",
        date: "2024-08-10T15:00:00Z",
        season: { year: 2024 },
        competitions: [{
          status: { type: { completed: true, name: "STATUS_FULL_TIME", detail: "FT" } },
          competitors: [
            { id: "A", homeAway: "home", score: "2", team: { id: "A", displayName: "A" } },
            { id: "B", homeAway: "away", score: "1", team: { id: "B", displayName: "B" } },
          ],
        }],
      }],
    });
    const parsed = parseHistoricalScoreboard(raw, leagueSpec);
    expect(parsed.fixtures[0].eventSeasonYear).toBe(2024);
    expect(parsed.sourceWarnings[0]).toMatch(/top-level season metadata/);
  });
});
