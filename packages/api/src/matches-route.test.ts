import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./index";
import {
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "./services/football-data";

function match(
  partial: Partial<FootballMatch> & Pick<FootballMatch, "id" | "homeTeam" | "awayTeam" | "utcDate" | "status">,
): FootballMatch {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    stage: null,
    matchday: null,
    group: null,
    score: null,
    ...partial,
  };
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
  replaceFootballDataForTests({
    byCompetition: {},
    upcoming: [],
    recent: [],
    standings: [],
    lastUpdated: null,
    error: null,
    competitionErrors: {},
  });
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "unknown",
    fixtures: [],
    lastUpdated: null,
    error: null,
    servingLastGood: false,
  });
});

describe("GET /api/matches/recent clubForm", () => {
  it("attaches ESPN-derived form to the existing recent payload", async () => {
    const fixtures = [
      match({
        id: 1,
        homeTeam: "Hull",
        awayTeam: "Man United",
        utcDate: "2026-08-22T11:30:00Z",
        status: "FINISHED",
        score: { home: 2, away: 0 },
      }),
      match({
        id: 2,
        homeTeam: "Man United",
        awayTeam: "Ipswich",
        utcDate: "2026-08-30T14:00:00Z",
        status: "FINISHED",
        score: { home: 5, away: 2 },
        scorers: [
          { playerId: "bruno", name: "Bruno Fernandes", team: "Man United", position: "AM" },
        ],
      }),
      match({
        id: 3,
        homeTeam: "Everton",
        awayTeam: "Man United",
        utcDate: "2026-09-06T13:00:00Z",
        status: "FINISHED",
        score: { home: 2, away: 2 },
      }),
    ];
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      lastUpdated: new Date("2026-09-09T12:00:00Z"),
      error: null,
      servingLastGood: false,
      fixtures,
    });

    const { status, body } = await getJson("/api/matches/recent?competition=eng.1");
    expect(status).toBe(200);
    const clubForm = body.clubForm as {
      source: string;
      teams: { team: string; form: string[]; scorers: { name: string; goals: number }[] }[];
    };
    expect(clubForm.source).toBe("season-schedule");
    const united = clubForm.teams.find((row) => row.team === "Man United");
    expect(united?.form).toEqual(["L", "W", "D"]);
    expect(united?.scorers[0]).toMatchObject({ name: "Bruno Fernandes", goals: 1 });
  });
});
