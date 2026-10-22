import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLUB_SEASON_DEDUPE_RULE_ID,
  compareClubSeasonRowPrecedence,
  migrateClubSeasonEvaluationArtifact,
  selectOnePerFixture,
  type ClubSeasonSnapshotFixture,
} from "./club-season-snapshots";

// Public /api/evaluation/club-season response captured from production on
// 22 Oct 2026 (112 stored rows, 92 fixtures; 20 EPL fixtures sealed twice:
// a v2 pre_kickoff_cached_fallback row and a v3 scheduled_window row).
// Bulky replay fields (score grids, market evidence) are stripped; they do not
// enter the 1X2 metrics.
const FIXTURE = path.join(__dirname, "__fixtures__/club-season-ledger-prod-2026-10-22.json");
const raw = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

describe("club-season one-per-fixture dedupe", () => {
  it("reproduces the double count: 104 official finished rows cover only 84 matches", () => {
    const parsed = raw();
    expect(parsed.fixtures).toHaveLength(112);
    const artifact = migrateClubSeasonEvaluationArtifact(parsed);
    expect(artifact.evaluation.dedupe).toEqual({
      ruleId: CLUB_SEASON_DEDUPE_RULE_ID,
      officialRows: 104,
      scoredRows: 84,
      collapsedDuplicates: 20,
    });
    expect(artifact.metrics.fixtureCount).toBe(84);
    expect(artifact.metrics.calibrationForecastCount).toBe(252);
    expect(artifact.metrics.brierScore).toBeCloseTo(0.6243, 4);
    expect(artifact.metrics.logLoss).toBeCloseTo(1.0514, 4);
    expect(artifact.metrics.winnerAccuracy).toBeCloseTo(0.4762, 4);
  });

  it("never mutates or drops stored ledger rows", () => {
    const parsed = raw();
    const before = JSON.stringify(parsed.fixtures);
    const artifact = migrateClubSeasonEvaluationArtifact(parsed);
    expect(artifact.fixtures).toHaveLength(112);
    expect(JSON.stringify(parsed.fixtures)).toBe(before);
  });

  it("keeps the scheduled_window v3 seal and drops the v2 cached fallback for every duplicated match", () => {
    const artifact = migrateClubSeasonEvaluationArtifact(raw());
    const kept = selectOnePerFixture(artifact.fixtures);
    const keys = kept.map((row) => `${row.competitionId}:${row.fixtureId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(kept.some((row) => row.checkpointReason === "pre_kickoff_cached_fallback")).toBe(false);
    const v3 = kept.filter((row) => row.modelVersion === "3");
    expect(v3).toHaveLength(20);
  });

  it("segments sum to the headline and EPL v3 matches the recomputed 20-match numbers", () => {
    const artifact = migrateClubSeasonEvaluationArtifact(raw());
    const segments = artifact.evaluation.segments;
    expect(segments.reduce((sum, s) => sum + s.sampleCount, 0)).toBe(artifact.metrics.fixtureCount);
    const v3 = segments.find((s) => s.modelVersion === "3" && s.competitionId === "eng.1");
    expect(v3?.sampleCount).toBe(20);
    expect(v3?.metrics.brierScore).toBeCloseTo(0.5046, 4);
    expect(v3?.metrics.logLoss).toBeCloseTo(0.8646, 4);
    const v2 = segments.find((s) => s.modelVersion === "2" && s.competitionId === "eng.1");
    expect(v2?.sampleCount).toBe(11);
  });

  it("precedence is deterministic and order-independent", () => {
    const artifact = migrateClubSeasonEvaluationArtifact(raw());
    const forward = selectOnePerFixture(artifact.fixtures);
    const reversed = selectOnePerFixture([...artifact.fixtures].reverse());
    const ids = (rows: ClubSeasonSnapshotFixture[]) => rows
      .map((r) => `${r.competitionId}:${r.fixtureId}:${r.modelVersion}:${r.checkpointReason}`).sort();
    expect(ids(reversed)).toEqual(ids(forward));
    const base = artifact.fixtures.find((r) => r.checkpointReason === "scheduled_window")!;
    const fallback = { ...base, checkpointReason: "pre_kickoff_cached_fallback" as const, modelVersion: "9" };
    expect(compareClubSeasonRowPrecedence(base, fallback)).toBeGreaterThan(0);
    const older = { ...base, modelVersion: "1" };
    expect(compareClubSeasonRowPrecedence({ ...base, modelVersion: "3" }, older)).toBeGreaterThan(0);
    const earlier = { ...base, forecastAt: new Date(Date.parse(base.forecastAt) - 60_000).toISOString() };
    expect(compareClubSeasonRowPrecedence(base, earlier)).toBeGreaterThan(0);
  });
});
