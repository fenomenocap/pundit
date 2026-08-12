import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecognizedFixture } from "./fixture-registry";
import {
  appendFriendlyShadowForecast,
  appendFriendlyShadowResult,
  buildFriendlyShadowForecast,
  friendlyShadowMetrics,
} from "./friendly-shadow-forecasts";

const fixture: RecognizedFixture = {
  fixtureId: "official-club:friendly-2026-01",
  primarySource: "official-club",
  primarySourceFixtureId: "friendly-2026-01",
  homeTeam: { id: "arsenal", name: "Arsenal" },
  awayTeam: { id: "ac-milan", name: "AC Milan" },
  kickoff: "2026-08-20T12:00:00.000Z",
  venue: "National Stadium",
  neutralVenue: true,
  competition: { id: "club.friendly", name: "Club Friendly", category: "club-friendly" },
  status: "scheduled",
  recognition: "authoritative",
  observedSources: [{
    source: "official-club",
    sourceFixtureId: "friendly-2026-01",
    authority: "authoritative",
    observedAt: "2026-08-13T00:00:00.000Z",
  }],
  observationHistory: [{
    source: "official-club",
    sourceFixtureId: "friendly-2026-01",
    observedAt: "2026-08-13T00:00:00.000Z",
    kickoff: "2026-08-20T12:00:00.000Z",
    venue: "National Stadium",
    neutralVenue: true,
    status: "scheduled",
  }],
};

const context = {
  homeRating: 1800,
  awayRating: 1750,
  ratingSnapshotAt: "2026-08-12T00:00:00.000Z",
  expectedSquadEvidenceIds: ["S2", "S1", "S1"],
  rotationAssessment: "high" as const,
  substitutionLimit: 6,
  observedAt: "2026-08-13T00:00:00.000Z",
};

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-friendly-shadow-"));
  process.env.PUNDIT_DATA_DIR = directory;
  delete process.env.FRIENDLY_SHADOW_ENABLED;
});

afterEach(() => {
  delete process.env.PUNDIT_DATA_DIR;
  delete process.env.FRIENDLY_SHADOW_ENABLED;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("private friendly shadow forecasts", () => {
  it("is disabled by default and fails closed on neutral venue and rotation inputs", () => {
    expect(buildFriendlyShadowForecast(fixture, context)).toEqual({ ok: false, reason: "policy-disabled" });
    expect(buildFriendlyShadowForecast({ ...fixture, neutralVenue: null }, context, { enabled: true }))
      .toEqual({ ok: false, reason: "neutral-venue-unknown" });
    expect(buildFriendlyShadowForecast(fixture, { ...context, expectedSquadEvidenceIds: [] }, { enabled: true }))
      .toEqual({ ok: false, reason: "rotation-context-missing" });
  });

  it("uses a separate zero-HFA policy with wider 1X2 uncertainty", () => {
    const built = buildFriendlyShadowForecast(fixture, context, { enabled: true });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.forecast.visibility).toBe("private-shadow");
    expect(built.forecast.homeFieldAdvantageElo).toBe(0);
    expect(built.forecast.uncertaintyShrinkage).toBe(0.2);
    expect(built.forecast.expectedSquadEvidenceIds).toEqual(["S1", "S2"]);
    expect(built.forecast).toMatchObject({
      homeRating: 1800,
      awayRating: 1750,
      modelVersion: "dixon-coles-club-v1",
    });
    expect(built.forecast.pHome + built.forecast.pDraw + built.forecast.pAway).toBeCloseTo(1, 3);
    expect(Math.max(built.forecast.pHome, built.forecast.pDraw, built.forecast.pAway)).toBeLessThan(0.5);
  });

  it("persists forecasts atomically and idempotently, then appends results without changing inputs", () => {
    const built = buildFriendlyShadowForecast(fixture, context, { enabled: true });
    if (!built.ok) throw new Error("fixture should build");
    const inserted = appendFriendlyShadowForecast(built.forecast, new Date("2026-08-13T00:01:00Z"));
    expect(inserted.inserted).toBe(true);
    expect(appendFriendlyShadowForecast(built.forecast)).toMatchObject({ inserted: false, conflict: false });
    expect(appendFriendlyShadowForecast({ ...built.forecast, pHome: 0.99 }))
      .toMatchObject({ inserted: false, conflict: true });
    const before = { ...inserted.ledger.forecasts[0], result: null };
    const result = {
      homeScore: 1,
      awayScore: 1,
      observedAt: "2026-08-20T14:00:00.000Z",
      source: "official-club",
      sourceFixtureId: "friendly-2026-01",
      fixtureStatus: "finished" as const,
    };
    const updated = appendFriendlyShadowResult(built.forecast.forecastId, result, new Date("2026-08-20T15:00:00Z"));
    expect(updated.updated).toBe(true);
    expect({ ...updated.ledger.forecasts[0], result: null }).toEqual(before);
    expect(appendFriendlyShadowResult(built.forecast.forecastId, result).updated).toBe(false);
    expect(appendFriendlyShadowResult("missing", {
      homeScore: 1,
      awayScore: 0,
      observedAt: "2026-08-19T14:00:00.000Z",
      source: "official-club",
      sourceFixtureId: "friendly-2026-01",
      fixtureStatus: "finished",
    }, new Date("2026-08-20T15:00:00Z")).updated).toBe(false);

    const secondCheckpoint = buildFriendlyShadowForecast(fixture, {
      ...context,
      observedAt: "2026-08-14T00:00:00.000Z",
    }, { enabled: true });
    if (!secondCheckpoint.ok) throw new Error("second checkpoint should build");
    expect(appendFriendlyShadowForecast(secondCheckpoint.forecast))
      .toMatchObject({ inserted: false, conflict: true });
  });

  it("keeps zero-sample metrics null and reports chronological completed evidence", () => {
    const built = buildFriendlyShadowForecast(fixture, context, { enabled: true });
    if (!built.ok) throw new Error("fixture should build");
    const empty = appendFriendlyShadowForecast(built.forecast).ledger;
    expect(friendlyShadowMetrics(empty)).toMatchObject({ sampleCount: 0, brier: null, logLoss: null });
    const completed = appendFriendlyShadowResult(built.forecast.forecastId, {
      homeScore: 1,
      awayScore: 1,
      observedAt: "2026-08-20T14:00:00.000Z",
      source: "official-club",
      sourceFixtureId: "friendly-2026-01",
      fixtureStatus: "finished",
    }, new Date("2026-08-20T15:00:00Z")).ledger;
    const metrics = friendlyShadowMetrics(completed);
    expect(metrics.sampleCount).toBe(1);
    expect(metrics.brier).toBeTypeOf("number");
    expect(metrics.logLoss).toBeTypeOf("number");
    expect(metrics.calibration).toHaveLength(1);
    expect(metrics.segments).toEqual([{ neutralVenue: true, rotationAssessment: "high", sampleCount: 1 }]);
  });

  it("recovers from the last-good copy and rejects future or unconfirmed results", () => {
    const built = buildFriendlyShadowForecast(fixture, context, { enabled: true });
    if (!built.ok) throw new Error("fixture should build");
    appendFriendlyShadowForecast(built.forecast);
    fs.writeFileSync(path.join(directory, "evaluation/friendly-shadow-v1.json"), "{broken", "utf8");
    expect(appendFriendlyShadowForecast(built.forecast))
      .toMatchObject({ inserted: false, conflict: false });

    expect(appendFriendlyShadowResult(built.forecast.forecastId, {
      homeScore: 2,
      awayScore: 1,
      observedAt: "2026-08-21T00:00:00.000Z",
      source: "official-club",
      sourceFixtureId: "friendly-2026-01",
      fixtureStatus: "finished",
    }, new Date("2026-08-20T15:00:00Z")).updated).toBe(false);
  });
});
