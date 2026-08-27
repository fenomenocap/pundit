import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";
import { getActiveFixtures } from "./services/active-fixtures";
import type { ActiveFixture } from "./services/active-fixtures";
import { clubRatingsAreCurrent } from "./services/club-ratings";
import { getCachedModelData } from "./services/model-data";
import type { ModelDataCache, ModelFixture } from "./services/model-data";

vi.mock("./services/active-fixtures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/active-fixtures")>();
  return {
    ...actual,
    getActiveFixtures: vi.fn(),
  };
});

vi.mock("./services/club-ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/club-ratings")>();
  return {
    ...actual,
    clubRatingsAreCurrent: vi.fn(() => true),
  };
});

vi.mock("./services/model-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/model-data")>();
  return {
    ...actual,
    getCachedModelData: vi.fn(),
  };
});

const FIXED_LAST_UPDATED = new Date("2026-08-27T00:00:00.000Z");
const CACHED_ERROR = "one active fixture is unpriced";

function modelFixture(competitionId: string, fixtureId: number): ModelFixture {
  return {
    competitionId,
    competition: competitionId === "eng.1" ? "Premier League" : "UEFA Champions League",
    fixtureId,
    utcDate: "2026-08-28T15:00:00.000Z",
    date: "2026-08-28",
    group: null,
    stage: "regular-season",
    home: "Arsenal",
    away: "Coventry City",
    homeElo: 1850,
    awayElo: 1600,
    pHome: 0.55,
    pDraw: 0.25,
    pAway: 0.2,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: null,
  };
}

function activeFixture(competitionId: string, id: number): ActiveFixture {
  return {
    id,
    competitionId,
    competition: competitionId === "eng.1" ? "Premier League" : "UEFA Champions League",
    homeTeam: "Arsenal",
    awayTeam: "Coventry City",
    utcDate: "2026-08-28T15:00:00.000Z",
    status: "SCHEDULED",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    neutralVenue: false,
    featured: false,
  };
}

interface ModelRouteBody {
  fixtures: Array<{
    competitionId: string;
    fixtureId: number;
    pHome: number;
    oddsSources: unknown[];
  }>;
  lastUpdated: string | null;
  error: string | null;
}

async function getJson(path: string): Promise<{ status: number; body: ModelRouteBody }> {
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
    body: JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as ModelRouteBody,
  };
}

const currentPremierLeague = modelFixture("eng.1", 1);
const currentChampionsLeague = modelFixture("uefa.champions_qual", 2);
const stale = modelFixture("eng.1", 3);
const foreign = modelFixture("uefa.champions_qual", 1);
const cachedModel: ModelDataCache = {
  fixtures: [currentPremierLeague, currentChampionsLeague, stale, foreign],
  lastUpdated: FIXED_LAST_UPDATED,
  error: CACHED_ERROR,
};
const currentActive = [
  activeFixture("eng.1", 1),
  activeFixture("uefa.champions_qual", 2),
];

beforeEach(() => {
  vi.mocked(getCachedModelData).mockReturnValue(cachedModel);
  vi.mocked(getActiveFixtures).mockReturnValue(currentActive);
  vi.mocked(clubRatingsAreCurrent).mockReturnValue(true);
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/model projections", () => {
  it.each(["/api/model/active", "/api/model/fixtures"])(
    "projects current source identities before the optional competition filter (%s)",
    async (path) => {
      const response = await getJson(path);
      expect(response.status).toBe(200);
      expect(response.body.fixtures.map(({ competitionId, fixtureId }) => `${competitionId}:${fixtureId}`))
        .toEqual(["eng.1:1", "uefa.champions_qual:2"]);
      expect(response.body.fixtures[0]).toMatchObject({ pHome: 0.55, oddsSources: [] });
      expect(response.body.lastUpdated).toBe(FIXED_LAST_UPDATED.toISOString());
      expect(response.body.error).toBe(CACHED_ERROR);

      const scoped = await getJson(`${path}?competition=eng.1`);
      expect(scoped.status).toBe(200);
      expect(scoped.body.fixtures.map(({ competitionId, fixtureId }) => `${competitionId}:${fixtureId}`))
        .toEqual(["eng.1:1"]);
      expect(scoped.body.lastUpdated).toBe(FIXED_LAST_UPDATED.toISOString());
      expect(scoped.body.error).toBe(CACHED_ERROR);
    }
  );

  it("fails closed to an empty fixture projection when the active source is empty", async () => {
    vi.mocked(getActiveFixtures).mockReturnValue([]);

    const response = await getJson("/api/model/active");

    expect(response.status).toBe(200);
    expect(response.body.fixtures).toEqual([]);
    expect(response.body.lastUpdated).toBe(FIXED_LAST_UPDATED.toISOString());
    expect(response.body.error).toBe(CACHED_ERROR);
  });
});
