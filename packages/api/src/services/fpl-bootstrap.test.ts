import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FPL_BOOTSTRAP_URL,
  FPL_CACHE_TTL_MS,
  getFplBootstrap,
  mapFplBootstrap,
  resetFplBootstrapCacheForTests,
} from "./fpl-bootstrap";

const RAW = {
  events: [{ id: 8, is_current: true }, { id: 9, is_next: true }],
  teams: [{ id: 1, short_name: "ARS", name: "Arsenal" }, { id: 2, short_name: "CHE", name: "Chelsea" }],
  elements: [
    { id: 10, web_name: "Raya", team: 1, element_type: 1, now_cost: 55, status: "a", chance_of_playing_next_round: null,
      news: "", total_points: 40, form: "5.0", selected_by_percent: "20.1", photo: "x.jpg", ict_index: "9" },
    { id: 11, web_name: "Palmer", team: 2, element_type: 3, now_cost: null, status: "d", chance_of_playing_next_round: 50,
      news: "Knock", total_points: 60, form: "6.5", selected_by_percent: "40.0" },
    { id: 12, web_name: "Ghost", team: 99, element_type: 4, now_cost: 50 },
  ],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

let dir: string;
let cacheFile: string;

beforeEach(() => {
  resetFplBootstrapCacheForTests();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpl-test-"));
  cacheFile = path.join(dir, "bootstrap.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mapFplBootstrap", () => {
  it("trims to the builder's fields and never estimates a missing price", () => {
    const payload = mapFplBootstrap(RAW, "2026-10-23T00:00:00.000Z");
    expect(payload.gameweek).toBe(9);
    expect(payload.clubs).toEqual([{ code: "ARS", name: "Arsenal" }, { code: "CHE", name: "Chelsea" }]);
    expect(payload.players).toHaveLength(2); // unknown club dropped
    expect(payload.players[0]).toEqual({
      id: 10, name: "Raya", club: "ARS", clubName: "Arsenal", pos: "GK", price: 5.5, status: "a",
      chanceNextRound: null, news: null, totalPoints: 40, form: 5, selectedByPercent: 20.1,
    });
    expect(payload.players[1].price).toBeNull();
    expect(Object.keys(payload.players[0])).not.toContain("photo");
  });
});

describe("getFplBootstrap", () => {
  it("fetches with a normal UA and no key, then serves from cache for an hour", async () => {
    const fetchImpl = vi.fn(async () => okResponse(RAW));
    let now = 1_000_000;
    const first = await getFplBootstrap({ fetchImpl, now: () => now, cacheFile });
    expect(first).toMatchObject({ ok: true, cache: "miss" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FPL_BOOTSTRAP_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("authorization");

    now += FPL_CACHE_TTL_MS - 1;
    expect(await getFplBootstrap({ fetchImpl, now: () => now, cacheFile })).toMatchObject({ ok: true, cache: "hit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2;
    expect(await getFplBootstrap({ fetchImpl, now: () => now, cacheFile })).toMatchObject({ ok: true, cache: "miss" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves the last good payload marked stale when a refresh fails", async () => {
    let now = 0;
    await getFplBootstrap({ fetchImpl: async () => okResponse(RAW), now: () => now, cacheFile });
    now += FPL_CACHE_TTL_MS + 1;
    const result = await getFplBootstrap({
      fetchImpl: async () => new Response("blocked", { status: 403 }), now: () => now, cacheFile,
    });
    expect(result).toMatchObject({ ok: true, cache: "stale", error: "Player data source returned 403." });
    if (result.ok) expect(result.payload.players).toHaveLength(2);
  });

  it("never caches an error: the next request goes back to the source", async () => {
    const fail = vi.fn(async () => new Response("blocked", { status: 403 }));
    expect(await getFplBootstrap({ fetchImpl: fail, now: () => 0, cacheFile }))
      .toEqual({ ok: false, status: 502, error: "Player data source returned 403." });
    expect(fs.existsSync(cacheFile)).toBe(false);
    const ok = vi.fn(async () => okResponse(RAW));
    expect(await getFplBootstrap({ fetchImpl: ok, now: () => 1, cacheFile })).toMatchObject({ ok: true, cache: "miss" });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("treats a network failure or an empty player list as an error", async () => {
    expect(await getFplBootstrap({ fetchImpl: async () => { throw new Error("down"); }, now: () => 0, cacheFile }))
      .toEqual({ ok: false, status: 502, error: "Player data source is unavailable." });
    expect(await getFplBootstrap({ fetchImpl: async () => okResponse({ teams: [], elements: [] }), now: () => 0, cacheFile }))
      .toEqual({ ok: false, status: 502, error: "Player data source returned no players." });
  });

  it("survives a restart from the disk mirror without refetching", async () => {
    await getFplBootstrap({ fetchImpl: async () => okResponse(RAW), now: () => 0, cacheFile });
    resetFplBootstrapCacheForTests();
    const fetchImpl = vi.fn(async () => okResponse(RAW));
    expect(await getFplBootstrap({ fetchImpl, now: () => 10, cacheFile })).toMatchObject({ ok: true, cache: "hit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
