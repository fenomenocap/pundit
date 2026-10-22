import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTrackRecord, fixtureKey, onePerFixture, type TrackRecordRow } from "./track-record.ts";

const snapshot = JSON.parse(readFileSync(new URL("./__fixtures__/club-season-2026-10-22.json", import.meta.url), "utf8")) as {
  fixtures: TrackRecordRow[];
};

const round = (value: number | null) => (value === null ? null : Math.round(value * 10_000) / 10_000);

test("production ledger: no match is counted twice", () => {
  const record = buildTrackRecord(snapshot.fixtures);
  const keys = record.counted.map(fixtureKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(snapshot.fixtures.length, 112);
  assert.equal(record.counted.length, 84);
  assert.equal(record.ledgerRows - record.notCounted - record.duplicatesRemoved, 84);
});

test("production ledger: current EPL version matches the offline recompute", () => {
  const { current } = buildTrackRecord(snapshot.fixtures);
  assert.equal(current.version, "3");
  assert.equal(current.scores.n, 20);
  assert.equal(round(current.scores.brier), 0.5046);
  assert.equal(round(current.scores.logLoss), 0.8646);
  assert.equal(round(current.scores.hitRate), 0.65);
  assert.equal(current.calibration.reduce((sum, bucket) => sum + bucket.count, 0), 60);
});

test("production ledger: earlier versions stay separate", () => {
  const { segments } = buildTrackRecord(snapshot.fixtures);
  const epl = Object.fromEntries(segments.filter((s) => s.competitionId === "eng.1").map((s) => [s.modelVersion, s.scores]));
  assert.equal(epl["1"].n, 39);
  assert.equal(round(epl["1"].brier), 0.6949);
  assert.equal(epl["2"].n, 11);
  assert.equal(round(epl["2"].brier), 0.6049);
});

test("a duplicated match keeps one row even when both rows are scheduled-window", () => {
  const base: TrackRecordRow = {
    competitionId: "eng.1", fixtureId: 1, utcDate: "2026-10-10T14:00Z", home: "A", away: "B",
    pHome: 0.5, pDraw: 0.3, pAway: 0.2, result: { homeScore: 1, awayScore: 0, winner: "home" },
    forecastAt: "2026-10-10T13:00:00Z", checkpointReason: "scheduled_window", modelVersion: "3",
  };
  const later = { ...base, forecastAt: "2026-10-10T13:30:00Z", pHome: 0.6, pDraw: 0.25, pAway: 0.15 };
  const fallback = { ...base, forecastAt: "2026-09-21T00:00:00Z", checkpointReason: "pre_kickoff_cached_fallback" };
  const afterKickoff = { ...base, fixtureId: 2, forecastAt: "2026-10-10T14:05:00Z" };
  const rows = onePerFixture([base, later, fallback, afterKickoff]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pHome, 0.6);
});
