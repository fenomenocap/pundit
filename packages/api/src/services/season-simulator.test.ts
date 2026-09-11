import { describe, expect, it } from "vitest";
import {
  hasCompleteLeagueSchedule,
  isSeasonOutlookQuestion,
  reconcileRemainingToStandings,
  remainingScheduledFixtures,
  simulateSeasonOutlook,
} from "./season-simulator";
import type { FootballMatch, FootballStanding } from "./football-data";
import { computeMatchModel, eloToLambdas, simulateMatch } from "./dixon-coles";
import type { ForecastContributor } from "./model-contributors";

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

  // One question asked two ways used to land in two different tiers:
  // "Relegation battle?" got the outlook, "Who gets relegated?" got the
  // disclaiming general answer, because the cues were literal substrings.
  it.each([
    "Who gets relegated?",
    "Which teams are relegated this season?",
    "Which teams go down?",
    "Who goes down from the Premier League?",
    "Which clubs stay up?",
    "Who is going to finish first?",
    "Who finishes top?",
    "Who takes the title?",
  ])("treats %s as a season outlook question", (question) => {
    expect(isSeasonOutlookQuestion(question)).toBe(true);
  });

  // The narrow half of the same change: "down" and "top" are ordinary words in
  // match talk, and must not drag a match or general question into the outlook.
  it.each([
    "What does the table show?",
    "Will the odds go down before kickoff?",
    "Has the price dropped since this morning?",
    "Explain how a high defensive line works.",
    "Which side is the top scorer likely to come from?",
  ])("does not treat %s as a season outlook question", (question) => {
    expect(isSeasonOutlookQuestion(question)).toBe(false);
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

  it("keeps postponed fixtures as unplayed inputs and excludes cancellations", () => {
    const fixtures = remainingScheduledFixtures([
      { ...scheduled[0], id: 301, status: "POSTPONED" },
      { ...scheduled[0], id: 302, status: "CANCELLED" },
    ], "eng.1");
    expect(fixtures.map((fixture) => fixture.id)).toEqual([301]);
  });

  it("treats an in-play match as still remaining so a live kickoff cannot blank the outlook", () => {
    // Standings do not increment until full time. Dropping IN_PLAY from the
    // remaining set made expectedRemaining = 351 and actual = 350 whenever a
    // Premier League match was live, so title-race questions fell through to
    // the table.
    const fixtures = remainingScheduledFixtures([
      { ...scheduled[0], id: 201, status: "IN_PLAY" },
      { ...scheduled[0], id: 203, status: "FINISHED" },
    ], "eng.1");
    expect(fixtures.map((fixture) => fixture.id)).toEqual([201]);
  });

  it("keeps an in-play match when standings are still behind that result", () => {
    const now = new Date("2026-08-20T15:00:00.000Z");
    const live = { ...scheduled[0], id: 201, status: "IN_PLAY" as const };
    const reconciled = reconcileRemainingToStandings(standings, [live], now);
    expect(reconciled?.map((fixture) => fixture.id)).toEqual([201]);
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([["Arsenal", 1850], ["Liverpool", 1840]]),
      "uefa-clubs": new Map<string, number>(),
    };
    expect(simulateSeasonOutlook("eng.1", standings, [live], ratings, 20)).not.toBeNull();
  });

  it("drops surplus past-kickoff IN_PLAY oldest-first when standings have already absorbed the result", () => {
    const now = new Date("2026-08-20T15:00:00.000Z");
    const absorbed = { ...scheduled[0], id: 200, utcDate: "2026-08-10T14:00:00.000Z", status: "IN_PLAY" as const };
    const remaining = { ...scheduled[0], id: 201, utcDate: "2026-08-20T14:00:00.000Z", status: "SCHEDULED" as const };
    const reconciled = reconcileRemainingToStandings(standings, [absorbed, remaining], now);
    expect(reconciled?.map((fixture) => fixture.id)).toEqual([201]);
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([["Arsenal", 1850], ["Liverpool", 1840]]),
      "uefa-clubs": new Map<string, number>(),
    };
    const outlook = simulateSeasonOutlook("eng.1", standings, [absorbed, remaining], ratings, 20);
    expect(outlook).not.toBeNull();
    expect(outlook!.remainingFixtures).toBe(1);
  });

  it("drops surplus stuck SCHEDULED oldest-first when standings are ahead", () => {
    const now = new Date("2026-08-20T15:00:00.000Z");
    const oldestStuck = { ...scheduled[0], id: 198, utcDate: "2026-08-01T14:00:00.000Z", status: "SCHEDULED" as const };
    const newerStuck = { ...scheduled[0], id: 199, utcDate: "2026-08-08T14:00:00.000Z", status: "SCHEDULED" as const };
    const remaining = { ...scheduled[0], id: 201, utcDate: "2026-08-20T14:00:00.000Z", status: "SCHEDULED" as const };
    expect(reconcileRemainingToStandings(
      standings,
      [remaining, newerStuck, oldestStuck],
      now
    )?.map((fixture) => fixture.id)).toEqual([201]);
  });

  it("fails closed when surplus future fixtures cannot be reconciled", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const remaining = { ...scheduled[0], id: 201, utcDate: "2026-10-20T14:00:00.000Z", status: "SCHEDULED" as const };
    const extra = { ...scheduled[0], id: 202, utcDate: "2026-10-27T14:00:00.000Z", status: "SCHEDULED" as const };
    expect(reconcileRemainingToStandings(standings, [remaining, extra], now)).toBeNull();
    expect(hasCompleteLeagueSchedule(standings, [remaining, extra])).toBe(false);
    expect(simulateSeasonOutlook(
      "eng.1",
      standings,
      [remaining, extra],
      {
        world: new Map<string, number>(),
        "eng-clubs": new Map([["Arsenal", 1850], ["Liverpool", 1840]]),
        "uefa-clubs": new Map<string, number>(),
      },
      10
    )).toBeNull();
  });

  it("orders simultaneous remaining fixtures by stable source ID", () => {
    const fixtures = remainingScheduledFixtures([
      { ...scheduled[0], id: 302 },
      { ...scheduled[0], id: 301 },
    ], "eng.1");
    expect(fixtures.map((fixture) => fixture.id)).toEqual([301, 302]);
  });

  it("fails closed when the remaining league schedule is incomplete", () => {
    const preSeason = standings.map((row) => ({ ...row, playedGames: 0, points: 0 }));
    expect(hasCompleteLeagueSchedule(preSeason, scheduled)).toBe(false);
    expect(simulateSeasonOutlook(
      "eng.1",
      preSeason,
      scheduled,
      {
        world: new Map<string, number>(),
        "eng-clubs": new Map([
          ["Arsenal", 1850],
          ["Liverpool", 1840],
        ]),
        "uefa-clubs": new Map<string, number>(),
      },
      10
    )).toBeNull();
  });

  it("fails closed when any scheduled team rating is missing", () => {
    expect(simulateSeasonOutlook(
      "eng.1",
      standings,
      scheduled,
      {
        world: new Map<string, number>(),
        "eng-clubs": new Map([["Arsenal", 1850]]),
        "uefa-clubs": new Map<string, number>(),
      },
      10
    )).toBeNull();
  });

  it("produces title probabilities that sum to ~1", () => {
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([
        ["Arsenal", 1850],
        ["Liverpool", 1840],
      ]),
      "uefa-clubs": new Map<string, number>(),
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

  it("replays identical grounded season inputs deterministically by default", () => {
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([
        ["Arsenal", 1850],
        ["Liverpool", 1840],
      ]),
      "uefa-clubs": new Map<string, number>(),
    };
    const first = simulateSeasonOutlook("eng.1", standings, scheduled, ratings, 500);
    const second = simulateSeasonOutlook("eng.1", standings, scheduled, ratings, 500);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.titleProbabilities).toEqual(first!.titleProbabilities);
    expect(second!.topFourProbabilities).toEqual(first!.topFourProbabilities);
    expect(second!.remainingFixtures).toBe(first!.remainingFixtures);
  });

  it("keeps an explicitly injected RNG authoritative", () => {
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([
        ["Arsenal", 1850],
        ["Liverpool", 1840],
      ]),
      "uefa-clubs": new Map<string, number>(),
    };
    let calls = 0;
    const injected = () => {
      calls += 1;
      return 0.5;
    };

    const outlook = simulateSeasonOutlook("eng.1", standings, scheduled, ratings, 20, injected);

    expect(outlook).not.toBeNull();
    expect(calls).toBe(20);
  });

  it("preserves seeded season output and RNG consumption through the contributor boundary", () => {
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map(["Arsenal", "Liverpool"].map((team, index) =>
        [team, 1850 - index * 10] as const)),
      "uefa-clubs": new Map<string, number>(),
    };
    const legacy: ForecastContributor = {
      id: "legacy-equivalence-test",
      version: "1",
      methodId: "legacy-direct-functions",
      status: "challenger",
      forecast: ({ homeStrength, awayStrength, homeAdvantageElo }) =>
        computeMatchModel(homeStrength, awayStrength, homeAdvantageElo),
      sampleScore: ({ homeStrength, awayStrength, homeAdvantageElo }, random = Math.random) =>
        simulateMatch(...eloToLambdas(homeStrength, awayStrength, homeAdvantageElo), false, random),
    };
    const seeded = () => {
      let state = 123456789;
      let calls = 0;
      return {
        random: () => {
          calls += 1;
          state = (state * 1664525 + 1013904223) % 4294967296;
          return state / 4294967296;
        },
        calls: () => calls,
      };
    };
    const championRandom = seeded();
    const legacyRandom = seeded();
    const champion = simulateSeasonOutlook(
      "eng.1", standings, scheduled, ratings, 500, championRandom.random
    );
    const beforeBoundary = simulateSeasonOutlook(
      "eng.1", standings, scheduled, ratings, 500, legacyRandom.random, legacy
    );
    const { updatedAt: _championAt, ...championComparable } = champion!;
    const { updatedAt: _legacyAt, ...legacyComparable } = beforeBoundary!;
    expect(championComparable).toEqual(legacyComparable);
    expect(championRandom.calls()).toBe(legacyRandom.calls());
  });
});
