import { describe, expect, it } from "vitest";
import { CLUB_STRENGTH_MAX_AGE_MS } from "./club-strength-artifact";
import { EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN, EPL_GOAL_CALIBRATION_MAX_AGE_MS } from "./epl-goal-calibration-artifact";
import { modelArtifactExpiryReport, modelPinExpiry } from "./model-artifact-expiry";

const calibration = { id: "epl-goal-calibration", issuedAt: EPL_GOAL_CALIBRATION_ACTIVATION_ORIGIN, maxAgeMs: EPL_GOAL_CALIBRATION_MAX_AGE_MS };
const clubelo = { id: "clubelo-pin", issuedAt: "2026-10-20T11:52:31.100Z", maxAgeMs: CLUB_STRENGTH_MAX_AGE_MS };

describe("model pin expiry alarm", () => {
  it("computes the current calibration expiry as Fri 6 Nov 08:00 SGT", () => {
    expect(modelPinExpiry(calibration, new Date("2026-10-22T15:00:00Z")).expiresAt).toBe("2026-11-06T00:00:00.000Z");
  });
  it("stays quiet more than 7 days out and alerts from 7 days before", () => {
    expect(modelPinExpiry(calibration, new Date("2026-10-29T23:59:00Z")).alert).toBe(false);
    expect(modelPinExpiry(calibration, new Date("2026-10-30T00:00:00Z")).alert).toBe(true);
    expect(modelPinExpiry(calibration, new Date("2026-11-07T00:00:00Z")).alert).toBe(true);
  });
  it("alerts on the ClubElo pin 7 days before ~19 Nov", () => {
    expect(modelPinExpiry(clubelo, new Date("2026-11-12T11:00:00Z")).alert).toBe(false);
    expect(modelPinExpiry(clubelo, new Date("2026-11-12T12:00:00Z")).alert).toBe(true);
    expect(modelPinExpiry(clubelo, new Date("2026-10-22T00:00:00Z")).expiresAt).toBe("2026-11-19T11:52:31.100Z");
  });
  it("reports alert when any pin is inside the window and rejects bad timestamps", () => {
    const report = modelArtifactExpiryReport([calibration, clubelo], new Date("2026-11-01T00:00:00Z"));
    expect(report.alert).toBe(true);
    expect(report.pins.map((p) => p.alert)).toEqual([true, false]);
    expect(() => modelPinExpiry({ id: "x", issuedAt: "", maxAgeMs: 1 }, new Date())).toThrow();
  });
});
