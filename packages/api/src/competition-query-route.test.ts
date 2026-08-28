import type { Express } from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "./index";
import {
  replaceFootballDataForTests,
  type FootballMatch,
  type FootballStanding,
} from "./services/football-data";
import { fixture } from "./services/__fixtures__/model-fixture";
import type { ModelFixture } from "./services/model-data";

const ratingState = vi.hoisted(() => ({ ready: true }));
const modelState = vi.hoisted(() => ({
  fixtures: [] as ModelFixture[],
  lastUpdated: null as Date | null,
  error: null as string | null,
}));

vi.mock("./services/club-ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/club-ratings")>();
  return {
    ...actual,
    clubRatingsAreCurrent: vi.fn(() => ratingState.ready),
  };
});

vi.mock("./services/model-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/model-data")>();
  return {
    ...actual,
    getCachedModelData: vi.fn(() => ({
      fixtures: [...modelState.fixtures],
      lastUpdated: modelState.lastUpdated,
      error: modelState.error,
    })),
  };
});

const MATCH_ROUTES = [
  { path: "/api/matches/upcoming", key: "matches" },
  { path: "/api/matches/recent", key: "matches" },
  { path: "/api/matches/standings", key: "standings" },
] as const;

const MODEL_ROUTES = [
  "/api/model/active",
  "/api/model/fixtures",
] as const;

const FILTERED_ROUTES = [
  ...MATCH_ROUTES.map((route) => route.path),
  ...MODEL_ROUTES,
] as const;

type JsonBody = Record<string, unknown>;

async function getJson(
  target: Express,
  path: string
): Promise<{ status: number; body: JsonBody }> {
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
    target(request, response);
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    status: response.statusCode,
    body: JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as JsonBody,
  };
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function pastDate(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function footballMatch(overrides: Partial<FootballMatch> = {}): FootballMatch {
  return {
    id: 101,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
    utcDate: futureDate(1),
    status: "SCHEDULED",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    ...overrides,
  };
}

function footballStanding(competitionId: string, team: string, position: number): FootballStanding {
  return {
    competitionId,
    position,
    team,
    playedGames: 1,
    won: 1,
    draw: 0,
    lost: 0,
    points: 3,
    goalsFor: 2,
    goalsAgainst: 0,
    goalDifference: 2,
    group: null,
    advanced: false,
  };
}

function modelFixture(match: FootballMatch): ModelFixture {
  return fixture(match.homeTeam, match.awayTeam, {
    competitionId: match.competitionId,
    competition: match.competition,
    fixtureId: match.id,
    utcDate: match.utcDate,
    date: match.utcDate.slice(0, 10),
    group: match.group,
  });
}

function installTestData(): void {
  const premierUpcoming = footballMatch({
    id: 101,
    competitionId: "eng.1",
    competition: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Liverpool",
  });
  const championsUpcoming = footballMatch({
    id: 201,
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifiers",
    homeTeam: "Celtic",
    awayTeam: "Fenerbahce",
  });
  const premierRecent = footballMatch({
    id: 102,
    utcDate: pastDate(1),
    status: "FINISHED",
    score: { home: 2, away: 1 },
  });
  const championsRecent = footballMatch({
    id: 202,
    competitionId: "uefa.champions_qual",
    competition: "UEFA Champions League Qualifiers",
    homeTeam: "Celtic",
    awayTeam: "Fenerbahce",
    utcDate: pastDate(2),
    status: "FINISHED",
    score: { home: 1, away: 0 },
  });

  replaceFootballDataForTests({
    byCompetition: {
      "eng.1": {
        upcoming: [premierUpcoming],
        recent: [premierRecent],
        standings: [footballStanding("eng.1", "Arsenal", 1)],
        error: null,
      },
      "uefa.champions_qual": {
        upcoming: [championsUpcoming],
        recent: [championsRecent],
        standings: [footballStanding("uefa.champions_qual", "Celtic", 1)],
        error: null,
      },
    },
    upcoming: [premierUpcoming, championsUpcoming],
    recent: [premierRecent, championsRecent],
    standings: [
      footballStanding("eng.1", "Arsenal", 1),
      footballStanding("uefa.champions_qual", "Celtic", 1),
    ],
    lastUpdated: new Date("2026-08-28T00:00:00.000Z"),
    error: null,
    competitionErrors: {},
  });

  modelState.fixtures = [modelFixture(premierUpcoming), modelFixture(championsUpcoming)];
  modelState.lastUpdated = new Date("2026-08-28T00:00:00.000Z");
  modelState.error = null;
}

function rows(body: JsonBody, key: string): Array<Record<string, unknown>> {
  const value = body[key];
  if (!Array.isArray(value)) throw new Error(`Expected ${key} to be an array.`);
  return value as Array<Record<string, unknown>>;
}

beforeEach(() => {
  ratingState.ready = true;
  installTestData();
});

afterEach(() => {
  ratingState.ready = true;
  modelState.fixtures = [];
  modelState.lastUpdated = null;
  modelState.error = null;
  replaceFootballDataForTests({
    byCompetition: {},
    upcoming: [],
    recent: [],
    standings: [],
    lastUpdated: null,
    error: null,
    competitionErrors: {},
  });
});

describe("competition query validation", () => {
  it.each(FILTERED_ROUTES)("rejects repeated competition values on %s", async (path) => {
    const response = await getJson(
      app,
      `${path}?competition=eng.1&competition=uefa.champions_qual`
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The competition filter is invalid." });
  });

  it.each(FILTERED_ROUTES)("rejects structured competition values on %s", async (path) => {
    const response = await getJson(
      app,
      `${path}?competition%5Bvalue%5D=eng.1`
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The competition filter is invalid." });
  });

  it.each(MATCH_ROUTES)("preserves scoped scalar filtering on $path", async ({ path, key }) => {
    const response = await getJson(app, `${path}?competition=%20eng.1%20`);
    expect(response.status).toBe(200);
    expect(rows(response.body, key).map((row) => row.competitionId)).toEqual(["eng.1"]);
  });

  it.each(MATCH_ROUTES)("preserves omitted and blank filters on $path", async ({ path, key }) => {
    for (const suffix of ["", "?competition=", "?competition=%20%20"]) {
      const response = await getJson(app, `${path}${suffix}`);
      expect(response.status).toBe(200);
      expect(rows(response.body, key)).toHaveLength(2);
    }
  });

  it.each(MATCH_ROUTES)("preserves empty results for unknown and disabled IDs on $path", async ({ path, key }) => {
    for (const competition of ["unknown.competition", "fifa.world"]) {
      const response = await getJson(app, `${path}?competition=${competition}`);
      expect(response.status).toBe(200);
      expect(rows(response.body, key)).toEqual([]);
    }
  });

  it.each(MODEL_ROUTES)("preserves scoped scalar filtering on %s", async (path) => {
    ratingState.ready = true;
    const response = await getJson(app, `${path}?competition=%20eng.1%20`);
    expect(response.status).toBe(200);
    expect(rows(response.body, "fixtures").map((row) => row.competitionId)).toEqual(["eng.1"]);
  });

  it.each(MODEL_ROUTES)("preserves omitted and blank filters on %s", async (path) => {
    ratingState.ready = true;
    for (const suffix of ["", "?competition=", "?competition=%20%20"]) {
      const response = await getJson(app, `${path}${suffix}`);
      expect(response.status).toBe(200);
      expect(rows(response.body, "fixtures")).toHaveLength(2);
    }
  });

  it.each(MODEL_ROUTES)("preserves empty results for unknown and disabled IDs on %s", async (path) => {
    ratingState.ready = true;
    for (const competition of ["unknown.competition", "fifa.world"]) {
      const response = await getJson(app, `${path}?competition=${competition}`);
      expect(response.status).toBe(200);
      expect(rows(response.body, "fixtures")).toEqual([]);
    }
  });

  it.each(MODEL_ROUTES)("rejects malformed filters before an unavailable model response on %s", async (path) => {
    ratingState.ready = false;
    const response = await getJson(
      app,
      `${path}?competition=eng.1&competition=uefa.champions_qual`
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "The competition filter is invalid." });
  });

  it.each(MODEL_ROUTES)("preserves the 503 envelope for valid filters while unavailable on %s", async (path) => {
    ratingState.ready = false;
    const response = await getJson(app, `${path}?competition=eng.1`);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Pundit's match model is temporarily unavailable.",
      code: "MODEL_UNAVAILABLE",
    });
  });
});
