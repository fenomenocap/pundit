import { describe, expect, it } from "vitest";
import {
  fitGloballyFeasibleDixonColes,
  forecastGloballyFeasibleDixonColes,
  forecastFittedDixonColes,
  globalPairObjectiveForResearch,
  globalPairObjectiveDifferenceForResearch,
  type FittedDixonColesTrainingRow,
} from "./dixon-coles-mle";

function syntheticRows(): FittedDixonColesTrainingRow[] {
  const clubs = ["Alpha", "Bravo", "Charlie", "Delta"];
  const elos = [1850, 1740, 1630, 1550];
  const rows: FittedDixonColesTrainingRow[] = [];
  for (let round = 0; round < 8; round += 1) for (let h = 0; h < 4; h += 1) {
    const a = (h + 1 + round % 3) % 4;
    const kickoff = new Date(Date.UTC(2024, 0, 2 + rows.length)).toISOString();
    rows.push({ sourceEventId: String(rows.length), competitionId: "eng.1", kickoff,
      homeCanonicalName: clubs[h], awayCanonicalName: clubs[a],
      homeGoals: (h + round) % 4, awayGoals: (a + round * 2) % 3,
      homeElo: elos[h], awayElo: elos[a],
      rankingDate: new Date(Date.parse(kickoff) - 86_400_000).toISOString().slice(0, 10) });
  }
  return rows;
}

const coordinates = [0.1, 0.17, -0.4, 0.2, 0.11, -0.04, 0.07, -0.14, 0.2];

describe("globally feasible offline candidate", () => {
  it.each([coordinates, [0.4, 0.3, 1.2, 0.26, -0.13, 0.07, 0.17, -0.08, 0.04],
    [-1.2, -0.2, -2, 0.2, 0.11, -0.04, 0.07, -0.14, 0.2]].map((x) => ({ x })))(
    "includes global rate-bound chain derivatives in its analytic gradient",
    ({ x }) => {
      const rows = syntheticRows();
      const analytic = globalPairObjectiveForResearch(rows, x);
      expect(Number.isFinite(analytic.value)).toBe(true);
      for (let i = 0; i < x.length; i += 1) {
        const plus = [...x], minus = [...x]; plus[i] += 1e-5; minus[i] -= 1e-5;
        const numeric = (globalPairObjectiveForResearch(rows, plus).value
          - globalPairObjectiveForResearch(rows, minus).value) / 2e-5;
        expect(Math.abs(analytic.grad[i] - numeric) / Math.max(1, Math.abs(numeric))).toBeLessThan(1e-6);
      }
    }
  );

  it("computes an equivalent stable likelihood increment away from cancellation", () => {
    const rows = syntheticRows();
    for (const scale of [0.02, -0.01, 0.0001]) {
      const after = coordinates.map((v, i) => v + scale * (i + 1));
      const stable = globalPairObjectiveDifferenceForResearch(rows, coordinates, after);
      const naive = globalPairObjectiveForResearch(rows, after).value - globalPairObjectiveForResearch(rows, coordinates).value;
      expect(stable).toBeCloseTo(naive, 11);
      expect(globalPairObjectiveDifferenceForResearch(rows, after, coordinates)).toBeCloseTo(-stable, 11);
    }
  });

  it("preserves a genuine small prior improvement when large clipped likelihood totals round to the same value", () => {
    const rows = syntheticRows(), before = [9, 0.1, -0.4, 0, 0, 0, 0, 0, 0], after = [...before];
    after[3] += 1e-12;
    const analytic = globalPairObjectiveForResearch(rows, before);
    const stable = globalPairObjectiveDifferenceForResearch(rows, before, after);
    expect(globalPairObjectiveForResearch(rows, after).value).toBe(analytic.value);
    expect(stable).toBeGreaterThan(0);
    expect(stable / 1e-12).toBeCloseTo(analytic.grad[3], 8);
    expect(globalPairObjectiveDifferenceForResearch(rows, after, before)).toBeCloseTo(-stable, 15);
  });

  it("makes an unobserved fitted-club pair admissible where a training-only rho could fail", () => {
    const rows = syntheticRows().filter((r) => (r.homeCanonicalName === "Alpha" && r.awayCanonicalName === "Charlie")
      || (r.homeCanonicalName === "Charlie" && r.awayCanonicalName === "Bravo"));
    const x = [0, 0.2, -8, 0.7, -0.2, -0.2, 0.5];
    const rho = globalPairObjectiveForResearch(rows, x).rho;
    const params = { intercept: 0, homeAdvantage: 0.2, rho: -0.3, timeDecayXi: 0, clubEloPriorStrength: 8,
      attack: { Alpha: 0.7, Bravo: -0.2, Charlie: -0.5 }, defence: { Alpha: -0.2, Bravo: 0.5, Charlie: -0.3 } };
    expect(forecastFittedDixonColes(params, "Alpha", "Charlie")).not.toBeNull();
    expect(forecastFittedDixonColes(params, "Charlie", "Bravo")).not.toBeNull();
    expect(forecastFittedDixonColes(params, "Alpha", "Bravo")).toBeNull();
    expect(rows.some((r) => r.homeCanonicalName === "Alpha" && r.awayCanonicalName === "Bravo")).toBe(false);
    for (const home of Object.keys(params.attack)) for (const away of Object.keys(params.attack)) {
      if (home !== away) expect(forecastFittedDixonColes({ ...params, rho }, home, away)).not.toBeNull();
    }
  });

  it("checks max-bound ties on smooth shared coordinates without asserting a nonexistent club-coordinate derivative", () => {
    const rows = syntheticRows(), x = [0.4, 0.3, -0.4, 0, 0, 0, 0, 0, 0];
    const analytic = globalPairObjectiveForResearch(rows, x);
    for (const i of [0, 1, 2]) {
      const plus = [...x], minus = [...x]; plus[i] += 1e-5; minus[i] -= 1e-5;
      const numeric = (globalPairObjectiveForResearch(rows, plus).value
        - globalPairObjectiveForResearch(rows, minus).value) / 2e-5;
      expect(analytic.grad[i]).toBeCloseTo(numeric, 6);
    }
    // Club perturbations can change which pair controls the max. The mapping
    // remains finite; a tie has directional derivatives, not one unique gradient.
    for (let i = 3; i < x.length; i += 1) for (const sign of [-1, 1]) {
      const next = [...x]; next[i] += sign * 1e-5;
      const candidate = globalPairObjectiveForResearch(rows, next);
      expect(Number.isFinite(candidate.value)).toBe(true);
      expect(Number.isFinite(candidate.rho)).toBe(true);
    }
  });

  it("converges with explicit diagnostics and gives distinct totals across all fitted pairings", () => {
    const fit = fitGloballyFeasibleDixonColes(syntheticRows(), { timeDecayXi: 0 });
    expect(fit.converged).toBe(true);
    expect(fit.diagnostics.stopReason).toBe("gradient-converged");
    expect(fit.diagnostics.gradientNorm).toBeLessThanOrEqual(1e-6);
    expect(fit.iterations).toBeGreaterThan(0);
    expect(fit.diagnostics.allFittedPairCount).toBe(12);
    expect(fit.diagnostics.minimumCorrection).toBeGreaterThan(0);
    const clubs = Object.keys(fit.params.attack), totals: number[] = [];
    for (const home of clubs) for (const away of clubs) {
      if (home === away) continue;
      const f = forecastGloballyFeasibleDixonColes(fit, home, away)!;
      expect(f).not.toBeNull();
      expect(f.pHome + f.pDraw + f.pAway).toBeCloseTo(1, 12);
      expect(f.pOver2_5 + f.pUnder2_5).toBeCloseTo(1, 12);
      expect(f.pBttsYes + f.pBttsNo).toBeCloseTo(1, 12);
      totals.push(f.totalXg);
    }
    expect(Math.max(...totals) - Math.min(...totals)).toBeGreaterThan(0.1);
  });

  it("does not treat an exhausted zero-step budget as an accepted forecast", () => {
    const fit = fitGloballyFeasibleDixonColes(syntheticRows(), { maxIterations: 0 });
    expect(fit.converged).toBe(false);
    expect(fit.diagnostics.stopReason).toBe("iteration-budget");
    expect(forecastGloballyFeasibleDixonColes(fit, "Alpha", "Bravo")).toBeNull();
    expect(forecastFittedDixonColes(fit.params, "Alpha", "Bravo")).not.toBeNull();
  });

  it("sorts training rows before decay weights and does not mutate caller rows", () => {
    const rows = syntheticRows(), reversed = [...rows].reverse();
    const before = JSON.stringify(reversed);
    const a = fitGloballyFeasibleDixonColes(rows), b = fitGloballyFeasibleDixonColes(reversed);
    expect(a.params).toEqual(b.params);
    expect(JSON.stringify(reversed)).toBe(before);
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite raw forecast globals: %s", (intercept) => {
    const fit = fitGloballyFeasibleDixonColes(syntheticRows(), { timeDecayXi: 0 });
    expect(forecastGloballyFeasibleDixonColes({ ...fit, params: { ...fit.params, intercept } }, "Alpha", "Bravo")).toBeNull();
  });

  it.each([
    { homeElo: NaN }, { awayElo: Infinity }, { homeGoals: -1 }, { awayGoals: 0.5 },
    { rankingDate: "2025-01-01" }, { kickoff: "bad" }, { competitionId: "foreign" },
    { homeCanonicalName: "Bravo", awayCanonicalName: "Bravo" },
  ])("rejects invalid/lookahead rows before optimization: %j", (change) => {
    const rows = syntheticRows(); rows[0] = { ...rows[0], ...change };
    expect(() => fitGloballyFeasibleDixonColes(rows)).toThrow(/Invalid or lookahead/);
  });

  it("rejects duplicate outcome IDs", () => {
    const rows = syntheticRows(); rows[1] = { ...rows[1], sourceEventId: rows[0].sourceEventId };
    expect(() => fitGloballyFeasibleDixonColes(rows)).toThrow(/Invalid or lookahead/);
  });

  it.each([{ timeDecayXi: NaN }, { clubEloPriorStrength: -1 }, { maxIterations: 0.5 }])(
    "rejects invalid fit options: %j", (options) => {
      expect(() => fitGloballyFeasibleDixonColes(syntheticRows(), options)).toThrow(/Invalid globally feasible/);
    }
  );
});
