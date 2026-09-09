import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateScorers,
  buildClubFormRows,
  deskPosition,
  getClubFormSnapshot,
  lastLeagueForm,
  resultMarkForTeam,
} from "./club-form";
import {
  parseEvent,
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "./football-data";

const plContext = { competitionId: "eng.1", competitionName: "Premier League" };

function match(partial: Partial<FootballMatch> & Pick<FootballMatch, "id" | "homeTeam" | "awayTeam" | "utcDate" | "status">): FootballMatch {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    ...partial,
  };
}

afterEach(() => {
  replaceFootballDataForTests({
    byCompetition: {},
    upcoming: [],
    recent: [],
    standings: [],
    lastUpdated: null,
    error: null,
    competitionErrors: {},
  });
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "unknown",
    fixtures: [],
    lastUpdated: null,
    error: null,
    servingLastGood: false,
  });
});

describe("league form from ESPN results", () => {
  it("uses the last five finished league games, oldest to newest, and does not pad", () => {
    const fixtures: FootballMatch[] = [
      match({
        id: 1,
        homeTeam: "Hull",
        awayTeam: "Man United",
        utcDate: "2026-08-22T11:30:00Z",
        status: "FINISHED",
        score: { home: 2, away: 0 },
      }),
      match({
        id: 2,
        homeTeam: "Man United",
        awayTeam: "Ipswich",
        utcDate: "2026-08-30T14:00:00Z",
        status: "FINISHED",
        score: { home: 5, away: 2 },
      }),
      match({
        id: 3,
        homeTeam: "Everton",
        awayTeam: "Man United",
        utcDate: "2026-09-06T13:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 2 },
      }),
      match({
        id: 4,
        homeTeam: "Man United",
        awayTeam: "Man City",
        utcDate: "2026-09-13T15:30:00Z",
        status: "SCHEDULED",
      }),
    ];
    expect(lastLeagueForm("Man United", fixtures)).toEqual(["L", "W", "D"]);
    expect(lastLeagueForm("Manchester United", fixtures)).toEqual(["L", "W", "D"]);
    expect(resultMarkForTeam(fixtures[3], "Man United")).toBeNull();
  });

  it("keeps only the newest five results when more exist", () => {
    const fixtures: FootballMatch[] = [
      match({
        id: 1,
        homeTeam: "Man City",
        awayTeam: "Bournemouth",
        utcDate: "2026-08-01T14:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 0 },
      }),
      match({
        id: 2,
        homeTeam: "Man City",
        awayTeam: "Bournemouth",
        utcDate: "2026-08-23T14:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 1 },
      }),
      match({
        id: 3,
        homeTeam: "Crystal Palace",
        awayTeam: "Man City",
        utcDate: "2026-08-28T19:00:00Z",
        status: "FINISHED",
        score: { home: 1, away: 4 },
      }),
      match({
        id: 4,
        homeTeam: "Man City",
        awayTeam: "Coventry",
        utcDate: "2026-09-05T14:00:00Z",
        status: "FINISHED",
        score: { home: 1, away: 0 },
      }),
      match({
        id: 5,
        homeTeam: "Arsenal",
        awayTeam: "Man City",
        utcDate: "2026-05-16T14:00:00Z",
        status: "FINISHED",
        score: { home: 3, away: 0 },
      }),
      match({
        id: 6,
        homeTeam: "Man City",
        awayTeam: "Fulham",
        utcDate: "2026-08-10T14:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 0 },
      }),
    ];
    expect(lastLeagueForm("Man City", fixtures)).toEqual(["W", "W", "W", "W", "W"]);
  });
});

describe("ESPN scoring details", () => {
  it("extracts league goals and skips own goals and cards", () => {
    const parsed = parseEvent({
      id: "401879291",
      date: "2026-09-06T13:00Z",
      competitions: [{
        status: { type: { state: "post", completed: true, name: "STATUS_FULL_TIME" } },
        details: [
          {
            type: { text: "Yellow Card" },
            scoringPlay: false,
            ownGoal: false,
            team: { id: "368" },
            athletesInvolved: [{ id: "1", displayName: "Harrison Armstrong", position: "RM" }],
          },
          {
            type: { text: "Goal" },
            scoringPlay: true,
            ownGoal: false,
            team: { id: "360" },
            athletesInvolved: [{ id: "542645", displayName: "Bryan Mbeumo", position: "AM-R" }],
          },
          {
            type: { text: "Own Goal" },
            scoringPlay: true,
            ownGoal: true,
            team: { id: "368" },
            athletesInvolved: [{ id: "99", displayName: "Own Goal", position: "D" }],
          },
          {
            type: { text: "Goal" },
            scoringPlay: true,
            ownGoal: false,
            team: { id: "360" },
            athletesInvolved: [{ id: "468041", displayName: "Benjamin Sesko", position: "F" }],
          },
        ],
        competitors: [
          { homeAway: "home", team: { id: "368", displayName: "Everton" }, score: "2", winner: false },
          { homeAway: "away", team: { id: "360", displayName: "Manchester United" }, score: "2", winner: false },
        ],
      }],
    }, plContext);
    expect(parsed.scorers).toEqual([
      { playerId: "542645", name: "Bryan Mbeumo", team: "Man United", position: "AM-R" },
      { playerId: "468041", name: "Benjamin Sesko", team: "Man United", position: "F" },
    ]);
  });

  it("ranks recent scorers by league goals and maps ESPN positions", () => {
    expect(deskPosition("F")).toBe("FWD");
    expect(deskPosition("CF-L")).toBe("FWD");
    expect(deskPosition("AM-L")).toBe("MID");
    expect(deskPosition("CD-R")).toBe("DEF");
    const ranked = aggregateScorers([
      match({
        id: 1,
        homeTeam: "Man City",
        awayTeam: "Coventry",
        utcDate: "2026-09-05T14:00:00Z",
        status: "FINISHED",
        score: { home: 1, away: 0 },
        scorers: [
          { playerId: "haaland", name: "Erling Haaland", team: "Man City", position: "F" },
        ],
      }),
      match({
        id: 2,
        homeTeam: "Man City",
        awayTeam: "Bournemouth",
        utcDate: "2026-08-23T14:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 1 },
        scorers: [
          { playerId: "haaland", name: "Erling Haaland", team: "Man City", position: "F" },
          { playerId: "foden", name: "Phil Foden", team: "Man City", position: "AM" },
        ],
      }),
    ]);
    expect(ranked.get("Man City")?.map((row) => [row.name, row.goals, row.position])).toEqual([
      ["Erling Haaland", 2, "FWD"],
      ["Phil Foden", 1, "MID"],
    ]);
  });
});

describe("club form snapshot", () => {
  it("prefers the complete season schedule over the seven-day rolling window", () => {
    replaceFootballDataForTests({
      byCompetition: {
        "eng.1": {
          upcoming: [],
          recent: [
            match({
              id: 3,
              homeTeam: "Everton",
              awayTeam: "Man United",
              utcDate: "2026-09-06T13:00:00Z",
              status: "FINISHED",
              score: { home: 2, away: 2 },
            }),
          ],
          standings: [],
          error: null,
        },
      },
    });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      lastUpdated: new Date("2026-09-09T12:00:00Z"),
      error: null,
      servingLastGood: false,
      fixtures: [
        match({
          id: 1,
          homeTeam: "Hull",
          awayTeam: "Man United",
          utcDate: "2026-08-22T11:30:00Z",
          status: "FINISHED",
          score: { home: 2, away: 0 },
        }),
        match({
          id: 2,
          homeTeam: "Man United",
          awayTeam: "Ipswich",
          utcDate: "2026-08-30T14:00:00Z",
          status: "FINISHED",
          score: { home: 5, away: 2 },
          scorers: [
            { playerId: "bruno", name: "Bruno Fernandes", team: "Man United", position: "AM" },
          ],
        }),
        match({
          id: 3,
          homeTeam: "Everton",
          awayTeam: "Man United",
          utcDate: "2026-09-06T13:00:00Z",
          status: "FINISHED",
          score: { home: 2, away: 2 },
        }),
      ],
    });
    const snapshot = getClubFormSnapshot("eng.1");
    expect(snapshot.source).toBe("season-schedule");
    expect(snapshot.seasonId).toBe("2026-27");
    const united = snapshot.teams.find((row) => row.team === "Man United");
    expect(united?.form).toEqual(["L", "W", "D"]);
    expect(united?.scorers[0]).toMatchObject({ name: "Bruno Fernandes", goals: 1, position: "MID" });
  });

  it("does not invent a five-letter form when a side has played fewer games", () => {
    const rows = buildClubFormRows([
      match({
        id: 1,
        homeTeam: "Man United",
        awayTeam: "Ipswich",
        utcDate: "2026-08-30T14:00:00Z",
        status: "FINISHED",
        score: { home: 5, away: 2 },
      }),
    ], []);
    expect(rows.find((row) => row.team === "Man United")?.form).toEqual(["W"]);
  });
});
