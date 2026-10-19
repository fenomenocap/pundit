import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "../persistent-store";

const SNAPSHOT_DIR = "data-layer-snapshots";

function snapshotRoot(): string {
  return path.join(getDataDir(), SNAPSHOT_DIR);
}

export function dataLayerSnapshotPath(fixtureId: string, asOf: string): string {
  const safeFixture = fixtureId.replace(/[^a-zA-Z0-9:_-]+/g, "_");
  const safeAsOf = asOf.replace(/[:.]/g, "-");
  return path.join(snapshotRoot(), safeFixture, `${safeAsOf}.json`);
}

export interface StoredDataLayerSnapshot {
  fixtureId: string;
  asOf: string;
  capturedAt: string;
  payload: unknown;
}

export function writeDataLayerSnapshot(
  fixtureId: string,
  asOf: string,
  payload: unknown,
  now = new Date(),
): StoredDataLayerSnapshot {
  const file = dataLayerSnapshotPath(fixtureId, asOf);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record: StoredDataLayerSnapshot = {
    fixtureId,
    asOf,
    capturedAt: now.toISOString(),
    payload,
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function readDataLayerSnapshot(
  fixtureId: string,
  asOf: string,
): StoredDataLayerSnapshot | null {
  const file = dataLayerSnapshotPath(fixtureId, asOf);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredDataLayerSnapshot;
    if (parsed.fixtureId !== fixtureId || parsed.asOf !== asOf) return null;
    return parsed;
  } catch {
    return null;
  }
}
