import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGrounding } from "../ask";
import { buildMatchContext } from "../match-context";
import { buildModelFixtureFromActive, type ModelFixture } from "../model-data";
import type { ActiveFixture } from "../active-fixtures";
import { matrixToBtts } from "../dixon-coles";
import { buildGoalReasonPoints } from "./take-plan-helpers";
import { buildPunditTakePlan } from "./take-plan";
import { renderTakeProseDeterministic } from "./take-prose";

const villaBrentfordGolden = {
  input: {
    fixtureId: 401878776,
    home: "Aston Villa",
    away: "Brentford",
    competitionId: "eng.1",
    kickoff: "2026-10-25T14:00Z",
    homeAdvantageElo: 42,
    homeStrength: 1894.7287510348706,
    awayStrength: 1861.9340912388507,
  },
  pBtts: 0.5739513575595379,
  expectedHomeGoals: 1.704390779201309,
  expectedAwayGoals: 1.146372902973552,
};

function calibratedRow(): ModelFixture {
  const input = villaBrentfordGolden.input;
  const active: ActiveFixture = {
    id: input.fixtureId,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: input.home,
    awayTeam: input.away,
    utcDate: input.kickoff,
    status: "SCHEDULED",
    neutralVenue: false,
    stage: null,
    matchday: null,
    group: null,
    score: null,
    featured: false,
  };
  const ratings = {
    world: new Map<string, number>(),
    "eng-clubs": new Map([[input.home, input.homeStrength], [input.away, input.awayStrength]]),
    "uefa-clubs": new Map<string, number>(),
  };
  return buildModelFixtureFromActive(active, ratings)!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("take goal copy matches calibrated row", () => {
  it("uses expectedHomeGoals/expectedAwayGoals with pBTTS from the same fixture row", () => {
    const fixture = calibratedRow();
    expect(fixture.goalCalibration).toBeTruthy();
    const context = buildMatchContext(fixture);
    expect(context.lambdaHome).toBeCloseTo(villaBrentfordGolden.expectedHomeGoals, 8);
    expect(context.lambdaAway).toBeCloseTo(villaBrentfordGolden.expectedAwayGoals, 8);

    const grounding = buildGrounding(fixture);
    expect(grounding.pBttsYes).toBe(fixture.pBttsYes);
    if (grounding.scoreGrid) {
      const [pYes] = matrixToBtts(grounding.scoreGrid);
      expect(grounding.pBttsYes).toBeCloseTo(pYes, 4);
    }

    const goalPoints = buildGoalReasonPoints(grounding, null, "Villa", "Brentford");
    expect(goalPoints.length).toBeGreaterThan(0);
    expect(goalPoints.some((p) => /expects (about|close to|around)/i.test(p.text))).toBe(true); // plan seeds unchanged
    expect(goalPoints.some((p) => p.text.includes("score grid"))).toBe(false);

    const plan = buildPunditTakePlan(grounding, null, { marketKind: "btts" });
    expect(plan.gridCall?.modelPctInt).toBe(Math.round(grounding.pBttsYes * 100));

    const prose = renderTakeProseDeterministic(plan);
    expect(prose).toMatch(/BTTS yes at 57\.4%/);
    expect(prose).toMatch(/I expect (about|close to|around)/i);
    expect(prose).not.toMatch(/1\.85|0\.85|score grid/i);
  });

  it("omits xG sentences when the row has no goal calibration", () => {
    const fixture = calibratedRow();
    const grounding = buildGrounding(fixture);
    delete (grounding as { goalCalibration?: unknown }).goalCalibration;
    grounding.lambdaHome = 1.85;
    grounding.lambdaAway = 0.85;
    const points = buildGoalReasonPoints(grounding, null, "Villa", "Brentford");
    expect(points).toEqual([]);
  });
});
