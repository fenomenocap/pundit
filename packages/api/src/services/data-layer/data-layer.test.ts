import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFixtures } from "./getFixtures";
import {
  readDataLayerSnapshot,
  writeDataLayerSnapshot,
} from "./snapshot-store";

describe("data layer", () => {
  const prior = process.env.PUNDIT_DATA_DIR;

  afterEach(() => {
    if (prior === undefined) delete process.env.PUNDIT_DATA_DIR;
    else process.env.PUNDIT_DATA_DIR = prior;
  });

  it("returns fixtures with sources and asOf", () => {
    const result = getFixtures({ competitionId: "eng.1" });
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.asOf).toBeTruthy();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it("persists point-in-time snapshots keyed by fixture and asOf", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-dl-"));
    process.env.PUNDIT_DATA_DIR = dir;
    writeDataLayerSnapshot("espn:eng.1:1", "2026-10-16T12:00:00.000Z", { pHome: 0.4 });
    const read = readDataLayerSnapshot("espn:eng.1:1", "2026-10-16T12:00:00.000Z");
    expect(read?.payload).toEqual({ pHome: 0.4 });
  });
});
