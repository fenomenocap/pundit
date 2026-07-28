import { describe, expect, it } from "vitest";
import {
  isSeasonOutlookQuestion,
  remainingScheduledFixtures,
  simulateSeasonOutlook,
} from "./season-simulator";
import type { FootballMatch, FootballStanding } from "./football-data";

const standings: FootballStanding[] = [
  {
    competitionId: "eng.1",
    position: 1,
    team: "Arsenal",
    playedGames: 1,
    won: 1,
    draw: 0,
    lost: 0,
    points: 3,
    goalsFor: 2,
    goalsAgainst: 0,
    goalDifference: 2,
    group: null,
    advanced: false,
  },
  {
    competitionId: "eng.1",
    position: 2,
    team: "Liverpool",
    playedGames: 1,
    won: 0,
    draw: 1,
    lost: 0,
    points: 1,
    goalsFor: 1,
    goalsAgainst: 1,
    goalDifference: 0,
    group: null,
    advanced: false,
  },
];

const scheduled: FootballMatch[] = [
  {
    id: 201,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    utcDate: "2026-08-20T14:00:00.000Z",
    status: "SCHEDULED",
    stage: null,
    matchday: 2,
    group: null,
    score: null,
  },
];

describe("season simulator", () => {
  it("detects season outlook questions", () => {
    expect(isSeasonOutlookQuestion("Who will win the Premier League?")).toBe(true);
    expect(isSeasonOutlookQuestion("What does the table show?")).toBe(false);
  });

  it("filters remaining scheduled fixtures for a competition", () => {
    const fixtures = remainingScheduledFixtures([
      ...scheduled,
      {
        ...scheduled[0],
        id: 202,
        competitionId: "uefa.champions_qual",
        status: "SCHEDULED",
      },
      {
        ...scheduled[0],
        id: 203,
        status: "FINISHED",
        score: { home: 1, away: 0 },
      },
    ], "eng.1");
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].id).toBe(201);
  });

  it("produces title probabilities that sum to ~1", () => {
    const ratings = {
      "eng-clubs": new Map([
        ["Arsenal", 1850],
        ["Liverpool", 1840],
      ]),
    };
    let seed = 0;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const outlook = simulateSeasonOutlook(
      "eng.1",
      standings,
      scheduled,
      ratings,
      500,
      random
    );
    expect(outlook).not.toBeNull();
    const titleSum = outlook!.titleProbabilities.reduce((sum, row) => sum + row.probability, 0);
    expect(titleSum).toBeGreaterThan(0.95);
    expect(titleSum).toBeLessThanOrEqual(1.01);
    expect(outlook!.titleProbabilities[0].team).toMatch(/Arsenal|Liverpool/);
  });
});
