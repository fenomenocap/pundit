import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "./index";
import {
  recognizeEspnFixture,
  replaceFixtureRegistryForTests,
} from "./services/fixture-registry";

afterEach(() => replaceFixtureRegistryForTests([]));

describe("GET /api/fixtures/recognized", () => {
  it("serves approved identities and capabilities without candidates", async () => {
    const fixture = recognizeEspnFixture({
      id: 991,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      utcDate: "2026-08-18T19:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      venue: "National Stadium",
      neutralVenue: true,
      score: null,
    });
    fixture.competition.category = "club-friendly";
    replaceFixtureRegistryForTests([fixture]);

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
    request.url = "/api/fixtures/recognized";
    request.headers = { host: "localhost" };
    const response = new ServerResponse(request);
    response.assignSocket(httpSocket);
    await new Promise<void>((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
      app(request, response);
    });
    const raw = Buffer.concat(chunks).toString("utf8");
    const payload = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    expect(response.statusCode).toBe(200);
    expect(response.getHeader("cache-control")).toBe("no-store");
    const body = JSON.parse(payload) as {
      fixtures: Array<{ fixture: { fixtureId: string }; capability: { status: string; reason: string } }>;
    };
    expect(body.fixtures).toEqual([expect.objectContaining({
      fixture: expect.objectContaining({ fixtureId: fixture.fixtureId }),
      capability: {
        status: "outside-coverage",
        reason: "friendly-policy-disabled",
      },
    })]);
    expect(JSON.stringify(body)).not.toMatch(/candidate|search/i);
  });
});
