import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildActiveModelFixtures, buildModelFixtureFromActive, type ModelFixture } from "./model-data";
import { buildMatchContext } from "./match-context";
import { buildGrounding } from "./ask";
import { composeMatchResponse } from "./response-composer";
import { computeMatchModel, matrixTo1x2, matrixToTotals, matrixToBtts } from "./dixon-coles";
import { buildPunditConsensus } from "./pundit-consensus";
import { EPL_GOAL_CALIBRATION_ARTIFACT_SHA256 } from "./epl-goal-calibration-artifact";
import type { ActiveFixture } from "./active-fixtures";

// Independent golden calculations from the pinned artifact and captured fixtures.
const goldens = [
  {
    "input": {
      "fixtureId": 401879268,
      "home": "Arsenal",
      "away": "Leeds",
      "competitionId": "eng.1",
      "kickoff": "2026-10-10T11:30Z",
      "homeAdvantageElo": 42,
      "homeStrength": 2040.320763777506,
      "awayStrength": 1816.5033321509707
    },
    "pHome": 0.7668270808067384,
    "pDraw": 0.17475109617005988,
    "pAway": 0.05842182302320201,
    "pOver": 0.515994926954298,
    "pBtts": 0.41902162354219263,
    "expectedHomeGoals": 2.134320669766317,
    "expectedAwayGoals": 0.5897471707547812
  },
  {
    "input": {
      "fixtureId": 401878776,
      "home": "Aston Villa",
      "away": "Brentford",
      "competitionId": "eng.1",
      "kickoff": "2026-10-10T14:00Z",
      "homeAdvantageElo": 42,
      "homeStrength": 1894.7287510348706,
      "awayStrength": 1861.9340912388507
    },
    "pHome": 0.49539048432530763,
    "pDraw": 0.26947316117021225,
    "pAway": 0.23513635450448028,
    "pOver": 0.5411513086718236,
    "pBtts": 0.5744848359145648,
    "expectedHomeGoals": 1.701863823974528,
    "expectedAwayGoals": 1.145340183185047
  },
  {
    "input": {
      "fixtureId": 401878775,
      "home": "Chelsea",
      "away": "Bournemouth",
      "competitionId": "eng.1",
      "kickoff": "2026-10-10T14:00Z",
      "homeAdvantageElo": 42,
      "homeStrength": 1881.0555865862013,
      "awayStrength": 1860.6221017944276
    },
    "pHome": 0.47288763036489045,
    "pDraw": 0.2733507800458428,
    "pAway": 0.2537615895892668,
    "pOver": 0.5628587931714776,
    "pBtts": 0.5987786937066211,
    "expectedHomeGoals": 1.7124522917240073,
    "expectedAwayGoals": 1.2333173290176251
  }
];
const rounded = (value: number) => Math.round(value * 10_000) / 10_000;
function row(index = 0): ModelFixture {
  const input = goldens[index].input;
  const active: ActiveFixture = { id: input.fixtureId, competitionId: "eng.1", competition: "Premier League", homeTeam: input.home, awayTeam: input.away, utcDate: input.kickoff, status: "SCHEDULED", neutralVenue: false, stage: null, matchday: null, group: null, score: null, featured: false };
  const ratings = { world: new Map<string, number>(), "eng-clubs": new Map([[input.home, input.homeStrength], [input.away, input.awayStrength]]), "uefa-clubs": new Map<string, number>() };
  return buildModelFixtureFromActive(active, ratings)!;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-07T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("calibrated EPL delivery", () => {
  it.each([0, 1, 2])("replays independently calculated real-fixture golden %s through cache and chat", index => {
    const golden = goldens[index]; const fixture = row(index);
    expect(fixture.goalCalibration?.artifactSha256).toBe(EPL_GOAL_CALIBRATION_ARTIFACT_SHA256);
    const baseline = computeMatchModel(golden.input.homeStrength, golden.input.awayStrength, 42);
    for (const key of ["pHome", "pDraw", "pAway"] as const) {
      expect(fixture[key]).toBe(rounded(golden[key]));
      expect(fixture[key]).toBe(rounded(baseline[key]));
    }
    expect(fixture.pOver2_5).toBe(rounded(golden.pOver));
    expect(fixture.pBttsYes).toBe(rounded(golden.pBtts));
    expect(fixture.expectedHomeGoals).toBeCloseTo(golden.expectedHomeGoals, 12);
    expect(fixture.expectedAwayGoals).toBeCloseTo(golden.expectedAwayGoals, 12);
    const context = buildMatchContext(fixture);
    expect(context.totalXg).toBeCloseTo(golden.expectedHomeGoals + golden.expectedAwayGoals, 12);
    const grounding = buildGrounding(fixture);
    expect(grounding.scoreGrid).toEqual(fixture.scoreGrid);
    expect(grounding.goalCalibration).toEqual(fixture.goalCalibration);
    const answer = composeMatchResponse("Over and under 2.5 odds: why do the probabilities sum to one?", grounding);
    expect(answer).toContain((fixture.pOver2_5 * 100).toFixed(1) + "%");
    expect(answer).toContain("historical scoring patterns and team ratings");
    expect(answer).toContain("probabilities sum to one");
    expect(answer).not.toContain("fixed total-goals assumption");
  });
  it("retains neutral and UCL coverage when the EPL artifact expires", () => {
    const fixture: ActiveFixture = { id: 1, competitionId: "eng.1", competition: "Premier League", homeTeam: "Arsenal", awayTeam: "Leeds", utcDate: "2026-11-10T12:00:00Z", status: "SCHEDULED", neutralVenue: false, stage: null, matchday: null, group: null, score: null, featured: false };
    const profile = new Map([["Arsenal", 2040.3], ["Leeds", 1816.5]]);
    const ratings = { world: new Map<string, number>(), "eng-clubs": profile, "uefa-clubs": profile };
    const rows = buildActiveModelFixtures([fixture, { ...fixture, id: 2, neutralVenue: true }, { ...fixture, id: 3, competitionId: "uefa.champions_qual" }], ratings, { forecastAt: new Date("2026-11-08T00:00:00Z") });
    expect(rows.map(row => row.fixtureId)).toEqual([2, 3]);
    expect(rows.every(row => !row.goalCalibration)).toBe(true);
  });
  it("changes totals by matchup rather than publishing a shared fixed total", () => {
    expect(new Set([0, 1, 2].map(index => row(index).pOver2_5)).size).toBe(3);
  });
  it.each(["identity", "inputs", "grid", "means", "both-metadata"]) ("rejects a corrupted calibrated %s instead of silently rebuilding the baseline", corruption => {
    const fixture = row();
    if (corruption === "identity") fixture.goalCalibration!.artifactSha256 = "b".repeat(64);
    if (corruption === "inputs") fixture.forecastInputs!.homeStrength += 0.001;
    if (corruption === "grid") fixture.scoreGrid![0][0] += 0.001;
    if (corruption === "means") fixture.expectedHomeGoals! += 0.001;
    if (corruption === "both-metadata") { delete fixture.forecastInputs; delete fixture.goalCalibration; }
    expect(() => buildMatchContext(fixture)).toThrow();
    expect(() => buildGrounding(fixture)).toThrow();
  });
  it("uses one coherent calibrated grid for the labelled market blend", () => {
    const fixture = row();
    const consensus = buildPunditConsensus({ fundamental: fixture, fundamentalGrid: fixture.scoreGrid, market: { source: "kalshi", observedAt: "2026-10-07T00:00:00Z", pHome: 0.6, pDraw: 0.25, pAway: 0.15 } })!;
    expect(consensus.methodId).toBe("labelled-1x2-shrink-outcome-anchor");
    expect(consensus.totalXg).not.toBe(2.7);
    const grid = fixture.scoreGrid!;
    const base = matrixTo1x2(grid);
    const target = [consensus.shrunkTarget.pHome, consensus.shrunkTarget.pDraw, consensus.shrunkTarget.pAway];
    const independentlyBlended = grid.map((line, h) => line.map((p, a) => p * target[h > a ? 0 : h === a ? 1 : 2] / base[h > a ? 0 : h === a ? 1 : 2]));
    expect(matrixToTotals(independentlyBlended, 2.5)[0]).toBeCloseTo(consensus.pOver2_5, 10);
    expect(matrixToBtts(independentlyBlended)[0]).toBeCloseTo(consensus.pBttsYes, 10);
  });
});
