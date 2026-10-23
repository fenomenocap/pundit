import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { replayCarriedScoreModel, resolveActiveScoreModel } from "./active-score-model";
import { migrateClubSeasonEvaluationArtifact, selectOnePerFixture } from "./club-season-snapshots";
import { EPL_GOAL_CALIBRATION_PINS } from "./epl-goal-calibration-artifact";

// Every stored production ledger row that carries a goal calibration (a502e436 pin,
// kickoffs 10-19 Oct 2026), captured from the live evaluation API on 22 Oct 2026.
const stored = JSON.parse(readFileSync(resolve(__dirname, "__fixtures__/club-season-calibrated-rows-2026-10-07-to-22.json"), "utf8"));
const rows: any[] = stored.fixtures;
const A502 = "a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7";
// A hypothetical later pin. The retired-pin path never needs its file.
const REPINNED = [
  { sha256: "c".repeat(64), activationOrigin: "2026-10-22T00:00:00.000Z" },
  { sha256: A502, activationOrigin: "2026-10-07T00:00:00.000Z" },
];
const KEYS = ["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"] as const;
const input = (row: any) => ({ competitionId: row.competitionId, home: row.home, away: row.away, kickoff: row.utcDate,
  homeStrength: row.forecastInputs.homeStrength, awayStrength: row.forecastInputs.awayStrength,
  homeAdvantageElo: row.forecastInputs.homeAdvantageElo });
function reproduces(row: any, model: ReturnType<typeof replayCarriedScoreModel>) {
  return model.artifactSha256 === row.goalCalibration.artifactSha256
    && KEYS.every((key) => Math.round(model[key] * 10_000) / 10_000 === row[key])
    && row.scoreGrid.every((line: number[], h: number) => line.every((p, a) => Math.abs(p - model.matrix[h][a]) <= 1e-12))
    && Math.abs(model.expectedHomeGoals - row.expectedHomeGoals) <= 1e-10
    && Math.abs(model.expectedAwayGoals - row.expectedAwayGoals) <= 1e-10;
}

describe("stored 7–22 Oct calibrated forecast rows", () => {
  it("are the 20 a502e436 rows with full carried inputs", () => {
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row.goalCalibration.artifactSha256).toBe(A502);
      expect(row.forecastInputs.goalCalibrationArtifactSha256).toBe(A502);
      expect(Date.parse(row.utcDate)).toBeGreaterThanOrEqual(Date.parse("2026-10-07T00:00:00Z"));
      expect(Date.parse(row.utcDate)).toBeLessThan(Date.parse("2026-10-22T00:00:00Z"));
    }
  });

  it("load into the ledger and score as official rows", () => {
    const artifact = migrateClubSeasonEvaluationArtifact({ fixtures: rows } as never);
    expect(artifact.evaluation.exclusions.total).toBe(0);
    expect(selectOnePerFixture(artifact.fixtures)).toHaveLength(20);
    const numbers = JSON.stringify(artifact.metrics).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((value) => Number.isFinite(Number(value)))).toBe(true);
  });

  it("replay exactly against the current registry", () => {
    for (const row of rows) {
      expect(reproduces(row, replayCarriedScoreModel(input(row), row.goalCalibration.artifactSha256,
        { now: new Date(row.forecastAt), forecastAt: new Date(row.forecastAt) }))).toBe(true);
    }
  });

  it("still replay exactly after a re-pin retires a502e436 and moves the activation origin", () => {
    for (const row of rows) {
      const model = replayCarriedScoreModel(input(row), A502,
        { now: new Date("2026-10-23T00:00:00Z"), forecastAt: new Date(row.forecastAt), pins: REPINNED });
      expect(reproduces(row, model)).toBe(true);
    }
  });

  it("would not reproduce through the pre-fix path once the origin moves (the old throw)", () => {
    // Before the fix, replay always used the current pin: with the origin moved past these
    // kickoffs that path yields the uncalibrated baseline, which the caller rejected.
    const row = rows[0];
    const model = resolveActiveScoreModel(input(row), null, new Date(row.forecastAt), { activationOrigin: REPINNED[0].activationOrigin });
    expect(model.method).toBe("baseline");
    expect(reproduces(row, model)).toBe(false);
  });

  it("still rejects an artifact that was never pinned, and a retired pin without a forecast time", () => {
    const row = rows[0];
    expect(() => replayCarriedScoreModel(input(row), "b".repeat(64), { pins: REPINNED, forecastAt: new Date(row.forecastAt) })).toThrow(/never pinned/);
    expect(() => replayCarriedScoreModel(input(row), "b".repeat(64), { forecastAt: new Date(row.forecastAt) })).toThrow();
    expect(() => replayCarriedScoreModel(input(row), A502, { pins: REPINNED })).toThrow(/forecast time/);
  });

  it("keeps the current pin first in the registry", () => {
    expect(EPL_GOAL_CALIBRATION_PINS[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(EPL_GOAL_CALIBRATION_PINS.map((pin) => pin.sha256)).size).toBe(EPL_GOAL_CALIBRATION_PINS.length);
  });
});
