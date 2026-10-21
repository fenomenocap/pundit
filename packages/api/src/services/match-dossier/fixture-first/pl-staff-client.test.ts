import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapWithConcurrencyLimit,
  prefetchPlStaffForBuildPass,
  resetPlStaffCacheForTests,
} from "./pl-staff-client";
import { loadFplBootstrap841Recorded } from "../fpl-bootstrap-injuries";
import {
  resetPlFixturesCacheForTests,
  resolvePlCompSeasonIdFromRows,
  setPlBuildPassCompSeasonIdForTests,
} from "./pl-fixtures-client";

describe("pl-staff-client prefetch", () => {
  afterEach(() => {
    resetPlStaffCacheForTests();
    resetPlFixturesCacheForTests();
    vi.restoreAllMocks();
  });

  it("limits concurrent staff fetches to three and retries once per team", async () => {
    setPlBuildPassCompSeasonIdForTests(
      resolvePlCompSeasonIdFromRows(
        [{ id: 0, label: "English Premier League Season 2026/2027" }],
        new Date("2026-10-21T12:00:00.000Z"),
      )!,
    );
    const snapshot = loadFplBootstrap841Recorded();
    const sides = ["Arsenal", "Chelsea", "Tottenham", "Leeds", "Liverpool", "Man City"];
    let inFlight = 0;
    let maxInFlight = 0;
    const attempts = new Map<number, number>();

    const fetchFn = vi.fn(async (url: string) => {
      const match = /teams\/(\d+)\/compseasons/.exec(url);
      const pulseId = match ? Number(match[1]) : 0;
      attempts.set(pulseId, (attempts.get(pulseId) ?? 0) + 1);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      if (pulseId === 9 && attempts.get(pulseId) === 1) {
        throw new Error("AbortError: This operation was aborted");
      }
      return new Response(JSON.stringify({ players: [{ altIds: { opta: "p1" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await prefetchPlStaffForBuildPass(
      sides,
      snapshot,
      "2026-10-21T12:00:00.000Z",
      fetchFn as typeof fetch,
    );

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(attempts.get(9)).toBe(2);
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it("mapWithConcurrencyLimit preserves order", async () => {
    const out = await mapWithConcurrencyLimit([1, 2, 3, 4], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8]);
  });
});
