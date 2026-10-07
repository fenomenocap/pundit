import { describe, expect, it } from "vitest";
import { fitHistoricalGoalRates, forecastHistoricalGoalRates, HistoricalGoalRow } from "./historical-goal-calibration";

function corpus(): HistoricalGoalRow[] {
  let state = 20261007;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 2 ** 32; };
  const poisson = (rate: number) => {
    let p = 1, n = 0;
    do { p *= random(); n += 1; } while (p > Math.exp(-rate));
    return n - 1;
  };
  const clubs = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
  return Array.from({ length: 300 }, (_, i) => {
    const home = i % 6, away = (home + 1 + Math.floor(i / 6) % 5) % 6;
    const day = new Date(Date.UTC(2020, 0, 1 + i));
    const ratingDate = new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
    const total = home < 2 || away < 2 ? 3.4 : 2.4;
    const share = 1 / (1 + Math.exp(-((home - away) / 4 + 0.2)));
    return { sourceEventId: `game-${i}`, kickoff: day.toISOString(),
      homeCanonicalName: clubs[home], awayCanonicalName: clubs[away],
      homeGoals: poisson(total * share), awayGoals: poisson(total * (1 - share)),
      homeElo: 1700 + home * 45, awayElo: 1700 + away * 45, ratingDate };
  });
}

describe("historical goal calibration integrity", () => {
  const options = { decayDays: 180, teamPrecision: 100 };
  const origin = "2020-11-01T00:00:00Z";

  it("fits a coherent distribution, with fixture-specific scoring styles separate from strength", () => {
    const rows = corpus(), fit = fitHistoricalGoalRates(rows, origin, options);
    expect(fit.converged).toBe(true);
    expect(fit.gradientNorm).toBeLessThanOrEqual(1e-7);
    const output = forecastHistoricalGoalRates(fit, { ...rows[0], kickoff: "2020-11-05T12:00:00Z" });
    expect(output.matrix.flat().every((p) => Number.isFinite(p) && p >= 0)).toBe(true);
    expect(output.matrix.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(output.oneXTwo.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(output.overUnder[0] + output.overUnder[1]).toBeCloseTo(1, 12);
    expect(output.btts[0] + output.btts[1]).toBeCloseTo(1, 12);
    expect(new Set(Object.values(fit.teamEffects).map((v) => v.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("does not use the target match result and replays deterministically", () => {
    const rows = corpus(), fit = fitHistoricalGoalRates(rows, origin, options);
    expect(fitHistoricalGoalRates([...rows].reverse(), origin, options)).toEqual(fit);
    const target = { ...rows[0], kickoff: "2020-11-05T12:00:00Z" };
    expect(forecastHistoricalGoalRates(fit, { ...target, homeGoals: 10, awayGoals: 8 }))
      .toEqual(forecastHistoricalGoalRates(fit, { ...target, homeGoals: 0, awayGoals: 0 }));
  });

  it("rejects duplicate, unavailable, malformed and same-day-rating training inputs", () => {
    const rows = corpus();
    expect(() => fitHistoricalGoalRates([...rows, rows[0]], origin, options)).toThrow(/Duplicate/);
    expect(() => fitHistoricalGoalRates([{ ...rows[0], kickoff: origin }, ...rows.slice(1)], origin, options))
      .toThrow(/unavailable/);
    expect(() => fitHistoricalGoalRates([{ ...rows[0], homeGoals: -1 }, ...rows.slice(1)], origin, options))
      .toThrow(/Invalid/);
    expect(() => fitHistoricalGoalRates([{ ...rows[0], ratingDate: rows[0].kickoff.slice(0, 10) }, ...rows.slice(1)], origin, options))
      .toThrow(/post-kickoff/);
    expect(() => fitHistoricalGoalRates(rows, origin, { ...options, teamPrecision: 0 })).toThrow(/options/);
  });

  it("fails closed for nonconvergence, missing dated ratings and a forecast before its origin", () => {
    const rows = corpus(), fit = fitHistoricalGoalRates(rows, origin, options);
    const target = { ...rows[0], kickoff: "2020-11-05T12:00:00Z" };
    expect(() => forecastHistoricalGoalRates({ ...fit, converged: false }, target)).toThrow(/Unconverged/);
    expect(() => forecastHistoricalGoalRates(fit, { ...target, homeElo: undefined })).toThrow(/rating/);
    expect(() => forecastHistoricalGoalRates(fit, rows[0])).toThrow(/post-outcome/);
  });
});
