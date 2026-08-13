import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./index";
import {
  premierLeagueSeasonWindow,
  replaceSeasonScheduleForTests,
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

afterEach(() => replaceSeasonScheduleForTests({
  competitionId: "eng.1",
  seasonId: "unknown",
  fixtures: [],
  lastUpdated: null,
  error: null,
  servingLastGood: false,
}));

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
});
