import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";
import { getInferenceStatus, resetInferenceStatus } from "./services/ask";
import { resetWebSearchStatus, searchWeb, withSearchQuestion } from "./services/web-search";
import {
  premierLeagueSeasonWindow,
  replaceSeasonScheduleForTests,
  SEASON_SCHEDULE_MAX_AGE_MS,
  type FootballMatch,
} from "./services/football-data";

function completeLeagueSchedule(): FootballMatch[] {
  const teams = Array.from({ length: 20 }, (_, index) => `Team ${index + 1}`);
  let id = 1;
  return teams.flatMap((home) => teams.filter((away) => away !== home).map((away) => ({
    id: id++,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: home,
    awayTeam: away,
    utcDate: "2026-08-20T14:00:00.000Z",
    status: "SCHEDULED",
    stage: null,
    matchday: null,
    group: null,
    score: null,
  })));
}

async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
  const httpSocket = socket as unknown as Socket;
  const request = new IncomingMessage(httpSocket);
  request.method = "GET";
  request.url = path;
  request.headers = { host: "localhost" };
  const response = new ServerResponse(request);
  response.assignSocket(httpSocket);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app(request, response);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    status: response.statusCode,
    body: JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)),
  };
}

afterEach(() => {
  vi.useRealTimers();
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "unknown",
    fixtures: [],
    lastUpdated: null,
    error: null,
    servingLastGood: false,
  });
});

describe("GET /ready season schedule", () => {
  it("reports the integrated current complete schedule status and deployment limiter scope", async () => {
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: premierLeagueSeasonWindow().seasonId,
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date(),
      error: null,
      servingLastGood: false,
    });
    const { body } = await getJson("/ready");
    expect(body.askRateLimit).toMatchObject({ scope: "deployment" });
    expect(body.seasonSchedule).toMatchObject({
      ready: true,
      fixtureCount: 380,
      error: null,
      servingLastGood: false,
    });
  });

  it("reports a failed last-good refresh as unavailable with age", async () => {
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: premierLeagueSeasonWindow().seasonId,
      fixtures: completeLeagueSchedule(),
      lastUpdated: new Date(),
      error: "timeout",
      servingLastGood: true,
    });
    const { body } = await getJson("/ready");
    expect(body.seasonSchedule).toMatchObject({
      ready: false,
      error: "timeout",
      servingLastGood: true,
      ageMinutes: expect.any(Number),
    });
  });

  it("uses the same strict six-hour boundary as production verification", async () => {
    const updatedAt = new Date("2026-08-13T00:24:00.000Z");
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: completeLeagueSchedule(),
      lastUpdated: updatedAt,
      error: null,
      servingLastGood: false,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(updatedAt.getTime() + SEASON_SCHEDULE_MAX_AGE_MS - 1));
    const beforeDeadline = await getJson("/ready");
    expect(beforeDeadline.body.seasonSchedule).toMatchObject({
      ready: true,
      ageMinutes: 359,
    });

    vi.setSystemTime(new Date(updatedAt.getTime() + SEASON_SCHEDULE_MAX_AGE_MS));
    const atDeadline = await getJson("/ready");
    expect(atDeadline.body.seasonSchedule).toMatchObject({
      ready: false,
      ageMinutes: 360,
    });
  });
});

/**
 * Search and inference share a vendor and, until this split, shared a key. An
 * operator reading Railway logs or /ready must be able to answer "which quota
 * ran out?" without reading answer text -- otherwise throttled retrieval is
 * indistinguishable from the model getting worse.
 */
describe("GET /ready provider observability", () => {
  const SEARCH_KEY = "search-key-must-not-appear";
  const INFERENCE_KEY = "inference-key-must-not-appear";
  const envKeys = [
    "MINIMAX_API_KEY",
    "MINIMAX_SEARCH_API_KEY",
    "MINIMAX_INFERENCE_API_KEY",
    "MINIMAX_INFERENCE_BASE_URL",
    "MINIMAX_BASE_URL",
    "BRAVE_SEARCH_API_KEY",
    "WEB_SEARCH_PROVIDER_ORDER",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    resetWebSearchStatus();
    resetInferenceStatus();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetWebSearchStatus();
    resetInferenceStatus();
  });

  it("reports search and inference health independently", async () => {
    process.env.MINIMAX_SEARCH_API_KEY = SEARCH_KEY;
    process.env.MINIMAX_INFERENCE_API_KEY = INFERENCE_KEY;
    const { body } = await getJson("/ready");
    expect(body.webSearch).toMatchObject({ primaryProvider: "minimax" });
    expect(body.inference).toMatchObject({
      configured: true,
      // The whole point of the split: inference is no longer on search's quota.
      dedicatedKey: true,
      keySource: "MINIMAX_INFERENCE_API_KEY",
      model: expect.any(String),
    });
  });

  it("flags inference still sharing the search credential", async () => {
    delete process.env.MINIMAX_INFERENCE_API_KEY;
    process.env.MINIMAX_API_KEY = SEARCH_KEY;
    const { body } = await getJson("/ready");
    expect(body.inference).toMatchObject({
      configured: true,
      dedicatedKey: false,
      keySource: "MINIMAX_API_KEY",
    });
  });

  it("accurately reports a throttled primary that is being covered by the fallback", async () => {
    process.env.MINIMAX_API_KEY = SEARCH_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "brave-key-must-not-appear";
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("brave.com")
        ? {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({
            web: { results: [{ title: "t", url: "https://b.example/1", description: "s" }] },
          }),
        }
        : { ok: false, status: 429, headers: new Headers(), text: async () => "" }));

    await withSearchQuestion(() => searchWeb("ready throttle check"));
    const { body } = await getJson("/ready");
    const webSearch = body.webSearch as Record<string, any>;
    // Serving, but not from the primary, and the reason is on the record.
    expect(webSearch.circuitOpen).toBe(false);
    expect(webSearch.usingFallback).toBe(true);
    expect(webSearch.lastGoodProvider).toBe("brave");
    expect(webSearch.providers.minimax.lastFailureReason).toBe("rate_limited");
    expect(webSearch.providers.minimax.lastThrottledAt).not.toBeNull();
  });

  it("reports a total search outage as degraded without failing readiness", async () => {
    process.env.MINIMAX_API_KEY = SEARCH_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 503, headers: new Headers(), text: async () => "",
    })));
    for (const question of ["a", "b", "c"]) {
      await withSearchQuestion(() => searchWeb(question));
    }
    const { body } = await getJson("/ready");
    const webSearch = body.webSearch as Record<string, any>;
    expect(webSearch.circuitOpen).toBe(true);
    expect(webSearch.lastDegradedReason).toBe("provider_unavailable");
    expect(webSearch.degradedSearches).toBe(3);
    // Search is degradable: answers keep their model grounding, so a search
    // outage must not put the service out of rotation. Readiness is decided by
    // the model and the football authority alone, and a total search outage
    // must leave that decision untouched.
    const { body: baseline } = await getJson("/ready");
    expect(body.status).toBe(baseline.status);
  });

  it("never puts a key in the readiness payload", async () => {
    process.env.MINIMAX_SEARCH_API_KEY = SEARCH_KEY;
    process.env.MINIMAX_INFERENCE_API_KEY = INFERENCE_KEY;
    process.env.BRAVE_SEARCH_API_KEY = "brave-key-must-not-appear";
    const { body } = await getJson("/ready");
    const serialized = JSON.stringify(body);
    for (const secret of [SEARCH_KEY, INFERENCE_KEY, "brave-key-must-not-appear"]) {
      expect(serialized).not.toContain(secret);
    }
    // Only the *name* of the variable and the host are reported.
    expect(getInferenceStatus().keySource).toBe("MINIMAX_INFERENCE_API_KEY");
    expect(serialized).toContain("MINIMAX_INFERENCE_API_KEY");
  });
});
