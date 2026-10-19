import type { Fixture } from "./data/fixtures";

export function settledWithCapturedForecast(rows: readonly Fixture[]): Fixture[] {
  return rows.filter((row) => typeof row.modelHit === "boolean");
}
