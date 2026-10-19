import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
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
  request.method = "POST";
  request.url = path;
  request.headers = {
    host: "localhost",
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
    ...headers,
  };
  const response = new ServerResponse(request);
  response.assignSocket(httpSocket);
  await new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
    app(request, response);
    request.emit("data", payload);
    request.emit("end");
  });
  const raw = Buffer.concat(chunks).toString("utf8");
  const jsonStart = raw.indexOf("\r\n\r\n") + 4;
  return {
    status: response.statusCode ?? 0,
    body: JSON.parse(raw.slice(jsonStart)),
  };
}

const ENV_KEYS = [
  "CHAT_EVAL_REMOTE_JUDGE_ENABLED",
  "CHAT_EVAL_INTERNAL_TOKEN",
  "OPENROUTER_API_KEY",
] as const;

describe("POST /internal/eval/judge", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("returns 404 when remote judge is disabled", async () => {
    delete process.env.CHAT_EVAL_REMOTE_JUDGE_ENABLED;
    process.env.CHAT_EVAL_INTERNAL_TOKEN = "secret";
    const result = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    }, { authorization: "Bearer secret" });
    expect(result.status).toBe(404);
  });

  it("returns 401 when token is missing or wrong", async () => {
    process.env.CHAT_EVAL_REMOTE_JUDGE_ENABLED = "true";
    process.env.CHAT_EVAL_INTERNAL_TOKEN = "expected-token";
    const missing = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    });
    expect(missing.status).toBe(401);
    const wrong = await postJson("/internal/eval/judge", {
      turns: [{ question: "Q?", answer: "A." }],
    }, { authorization: "Bearer wrong-token" });
    expect(wrong.status).toBe(401);
  });

  it("accepts a valid bearer token and returns judge payload shape", async () => {
    process.env.CHAT_EVAL_REMOTE_JUDGE_ENABLED = "true";
    process.env.CHAT_EVAL_INTERNAL_TOKEN = "expected-token";
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            personaStrength: 0.8,
            clearCall: 0.7,
            specificity: 0.75,
            variety: 0.6,
            citationCorrectness: 0.9,
            overall: 0.74,
            note: "ok",
          }),
        },
      }],
    }), { status: 200 })));
    const result = await postJson("/internal/eval/judge", {
      turns: [{ question: "Who wins?", answer: "Lean Chelsea." }],
      maxTurns: 1,
      paceMs: 0,
    }, { authorization: "Bearer expected-token" });
    expect(result.status).toBe(200);
    expect(result.body.scoredTurns).toBe(1);
    expect(result.body.averages).toMatchObject({ overall: 0.74 });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer openrouter-test-key");
    expect(String(init?.body)).not.toContain("openrouter-test-key");
  });
});
