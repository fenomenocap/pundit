import { describe, expect, it } from "vitest";
import { scoreMatrix } from "./dixon-coles";
import { scoreGoalGrid, selectGoalCandidate, summarizeGoalPredictions, utcWeekOrigin,
  type HistoricalGoalPrediction } from "./historical-goal-evaluation";

const loss = (selection: number) => ({ scoreline: selection, oneXTwo: selection, totalsBrier: selection,
  bttsBrier: selection, totalsLog: selection, bttsLog: selection, selection });
const row = { sourceEventId: "1", kickoff: "2023-11-04T15:00:00Z", homeCanonicalName: "A",
  awayCanonicalName: "B", homeGoals: 2, awayGoals: 1 };

describe("historical calibration evaluation", () => {
  it("uses UTC Monday origins across year and Sunday boundaries", () => {
    expect(new Date(utcWeekOrigin("2023-01-01T23:59:00Z")).toISOString()).toBe("2022-12-26T00:00:00.000Z");
    expect(new Date(utcWeekOrigin("2023-01-02T00:00:00Z")).toISOString()).toBe("2023-01-02T00:00:00.000Z");
  });
  it("scores all delivered markets from a coherent full score grid", () => {
    const scores = scoreGoalGrid(scoreMatrix(1.5, 1.1), row);
    expect(scores.scoreline).toBeCloseTo(-Math.log(scoreMatrix(1.5, 1.1)[2][1]), 12);
    expect(scores.selection).toBeCloseTo(scores.scoreline + scores.oneXTwo + 2 * scores.totalsLog + scores.bttsLog, 12);
    expect(() => scoreGoalGrid([[1]], row)).toThrow(/outside/);
    expect(() => scoreGoalGrid([[0.5]], { ...row, homeGoals: 0, awayGoals: 0 })).toThrow(/Noncoherent/);
  });
  it("never selects using future, same-week, unavailable, stale or expired labels", () => {
    const origin = Date.parse("2023-11-06T00:00:00Z");
    const earlier = Array.from({ length: 60 }, () => ({ kickoff: "2023-10-28T15:00:00Z", freshRating: true,
      losses: [loss(3), loss(1), loss(2), loss(4), loss(5)] }));
    expect(selectGoalCandidate(earlier, origin).index).toBe(1);
    for (const bad of ["2023-11-06T15:00:00Z", "2023-11-05T15:00:00Z", "2022-01-01T15:00:00Z"]) {
      const poison = Array.from({ length: 100 }, () => ({ kickoff: bad, freshRating: true,
        losses: [loss(0), loss(100), loss(100), loss(100), loss(100)] }));
      expect(selectGoalCandidate([...earlier, ...poison], origin).index).toBe(1);
      expect(selectGoalCandidate(poison, origin).count).toBe(0);
    }
    expect(selectGoalCandidate(earlier.map((r) => ({ ...r, freshRating: false })), origin).index).toBe(0);
    expect(selectGoalCandidate(earlier.slice(1), origin).index).toBe(0);
  });
  it("uses paired week resampling and stable 95% endpoints", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ ...row, sourceEventId: String(i), seasonId: "2023-24",
      kickoff: `2023-11-${i < 10 ? "04" : i < 20 ? "11" : "18"}T15:00:00Z`,
      candidate: loss(1), champion: loss(2), candidateFallback: null, selectedIndex: 0,
      origin: "2023-10-30T00:00:00Z", freshRating: true, selectionCount: 60, selectionMeans: null,
      optionFallbacks: [null, null, null, null, null], lambdaHome: 1.5, lambdaAway: 1.1, rho: -0.1,
      pOver: 0.5, pBtts: 0.5, oneXTwo: [0.4, 0.3, 0.3], trainingCount: 100,
      allocationTrainingCount: 30, trainingThrough: "2023-10-28T15:00:00Z",
    } satisfies HistoricalGoalPrediction));
    const summary = summarizeGoalPredictions(rows);
    expect(summary.utcWeeks).toBe(3);
    expect(summary.metrics.scoreline).toEqual({ candidate: 1, champion: 2, delta: -1, interval95: [-1, -1] });
    expect(summarizeGoalPredictions(rows)).toEqual(summary);
  });
});
