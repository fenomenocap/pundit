import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveFixture } from "./active-fixtures";

const A502 = "a502e436d89d84e73647602117060a1ee2c824435ebd05a3ad6f93b859f627c7";
const active: ActiveFixture = { id: 401879268, competitionId: "eng.1", competition: "Premier League", homeTeam: "Arsenal",
  awayTeam: "Leeds", utcDate: "2026-10-10T11:30Z", status: "SCHEDULED", neutralVenue: false, stage: null, matchday: null,
  group: null, score: null, featured: false };
const ratings = () => ({ world: new Map<string, number>(),
  "eng-clubs": new Map([["Arsenal", 2040.320763777506], ["Leeds", 1816.5033321509707]]), "uefa-clubs": new Map<string, number>() });

afterEach(() => { vi.useRealTimers(); vi.doUnmock("./epl-goal-calibration-artifact"); vi.resetModules(); });

describe("a cached a502e436 forecast after a re-pin", () => {
  it("still builds chat context and a complete ledger snapshot", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T09:43:45Z"));
    const { buildModelFixtureFromActive } = await import("./model-data");
    const fixture = buildModelFixtureFromActive(active, ratings())!;
    expect(fixture.goalCalibration?.artifactSha256).toBe(A502);
    // Give the row the rating provenance a production row carries, so completeness turns on calibration alone.
    fixture.forecastProvenance!.ratingSnapshotAt = fixture.forecastInputs!.ratingSnapshotAt = "2026-10-05T16:48:10.899Z";
    fixture.forecastProvenance!.ratingSourceState = "live";
    const { buildSnapshotFromModel: controlSnapshot } = await import("./club-season-snapshots");
    expect(controlSnapshot(fixture, "2026-10-10T10:03:52.375Z").provenanceCompleteness).toBe("complete");

    vi.resetModules();
    vi.doMock("./epl-goal-calibration-artifact", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./epl-goal-calibration-artifact")>();
      return { ...actual, EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN: "2026-10-22T00:00:00.000Z",
        EPL_GOAL_CALIBRATION_ARTIFACT_SHA256: "c".repeat(64),
        EPL_GOAL_CALIBRATION_PINS: [{ sha256: "c".repeat(64), activationOrigin: "2026-10-22T00:00:00.000Z" },
          { sha256: A502, activationOrigin: "2026-10-07T00:00:00.000Z" }] };
    });
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
    const { buildMatchContext } = await import("./match-context");
    const { buildSnapshotFromModel } = await import("./club-season-snapshots");
    const context = buildMatchContext(fixture);
    expect(context.totalXg).toBeCloseTo(fixture.expectedHomeGoals! + fixture.expectedAwayGoals!, 12);
    const snapshot = buildSnapshotFromModel(fixture, "2026-10-10T10:03:52.375Z");
    expect(snapshot.provenanceCompleteness).toBe("complete");

    const tampered = { ...fixture, goalCalibration: { ...fixture.goalCalibration!, artifactSha256: "b".repeat(64) } };
    expect(() => buildMatchContext(tampered)).toThrow();
  });
});
