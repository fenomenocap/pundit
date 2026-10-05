import { describe, expect, it } from "vitest";
import { selectFixtureTotalsOptions } from "./fixture-totals-development";
import type { FittedDixonColesTrainingRow } from "./dixon-coles-mle";

function rows(n: number): FittedDixonColesTrainingRow[] {
  return Array.from({ length: n }, (_, i) => {
    const kickoff = new Date(Date.UTC(2024, 0, 2 + i)).toISOString();
    return { sourceEventId: String(i), competitionId: "eng.1", kickoff,
      homeCanonicalName: i % 2 ? "Bravo" : "Alpha", awayCanonicalName: i % 2 ? "Alpha" : "Bravo",
      homeGoals: i % 4, awayGoals: i % 3, homeElo: i % 2 ? 1700 : 1800, awayElo: i % 2 ? 1800 : 1700,
      rankingDate: new Date(Date.parse(kickoff) - 86_400_000).toISOString().slice(0, 10) };
  });
}

describe("train-only fixture totals development selection", () => {
  it("labels short history unselected rather than claiming a holdout-selected option", () => {
    const selection = selectFixtureTotalsOptions(rows(20), "2024-01-23T00:00:00Z");
    expect(selection.selected).toBe(false);
    expect(selection.reason).toBe("insufficient-inner-history");
    expect(selection.options).toEqual({ timeDecayXi: 0.0065, clubEloPriorStrength: 8 });
    expect(selection.productionEligible).toBe(false);
  });

  it.each(["bad", "2024-02-01T00:00:00Z"])("blocks unavailable outer results before selection: %s", (origin) => {
    expect(() => selectFixtureTotalsOptions(rows(160), origin)).toThrow(/unavailable or future/);
  });

  it("preserves complete option/fold denominators and chronological disjoint event IDs", () => {
    const data = rows(160), byId = new Map(data.map((row) => [row.sourceEventId, row]));
    const selectionAt = "2024-06-12T00:00:00Z";
    const selection = selectFixtureTotalsOptions(data, selectionAt);
    expect(selection.attempts).toHaveLength(4);
    expect(selection.folds).toHaveLength(3);
    for (const fold of selection.folds) {
      const train = new Set(fold.trainEventIds);
      for (const id of fold.validationEventIds) {
        expect(train.has(id)).toBe(false);
        expect(Date.parse(byId.get(id)!.kickoff)).toBeLessThan(Date.parse(selectionAt) - 86_400_000);
        expect(Date.parse(byId.get(id)!.kickoff)).toBeGreaterThanOrEqual(Date.parse(fold.origin));
      }
      for (const id of fold.trainEventIds) {
        expect(Date.parse(byId.get(id)!.kickoff)).toBeLessThanOrEqual(Date.parse(fold.origin) - 86_400_000);
      }
    }
    for (const attempt of selection.attempts) {
      const denominator = attempt.folds.reduce((n, fold) => n + fold.validationN, 0);
      expect(attempt.accepted + attempt.rejected).toBe(denominator);
      if (attempt.eligible) expect(attempt.rejected).toBe(0);
    }
    expect(selection.exposedDevelopment).toBe(true);
    expect(selection.productionEligible).toBe(false);
  });

  it.each([{ homeGoals: -1 }, { awayGoals: 0.5 }, { homeElo: NaN }, { awayElo: Infinity },
    { rankingDate: "2024-06-12" }, { competitionId: "foreign" }])(
    "eagerly rejects malformed inner-validation rows: %j", (change) => {
      const data = rows(160); data[159] = { ...data[159], ...change };
      expect(() => selectFixtureTotalsOptions(data, "2024-06-12T00:00:00Z")).toThrow(/Invalid or lookahead/);
    }
  );

  it("rejects duplicate IDs in the validation portion too", () => {
    const data = rows(160); data[159] = { ...data[159], sourceEventId: data[158].sourceEventId };
    expect(() => selectFixtureTotalsOptions(data, "2024-06-12T00:00:00Z")).toThrow(/Invalid or lookahead/);
  });

  it("does not accept an appended future outcome even when only its goals differ", () => {
    const data = rows(100), future = { ...data[0], sourceEventId: "future", kickoff: "2024-12-01T00:00:00Z" };
    expect(() => selectFixtureTotalsOptions([...data, future], "2024-04-15T00:00:00Z")).toThrow(/future results/);
  });
});
