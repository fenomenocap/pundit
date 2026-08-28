import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import type { NextFunction, Request, Response } from "express";
import * as askService from "../services/ask";
import { AppError, errorHandler } from "../middleware";
import askRouter, {
  askRateLimitConfig,
  askRateLimitKey,
  createAskRateLimiter,
  parseFixtureContext,
  parseHistory,
  parseQuestion,
  parseTeamContext,
  resolveAskRateLimitConfig,
} from "./ask";

const successfulAnswer = {
  answer: "A completed answer.",
  grounding: null,
  verification: { status: "not-required" as const, supportedClaimCount: 0, removedClaimCount: 0 },
};

interface JsonAskInvocation {
  request: IncomingMessage;
  response: ServerResponse;
  socket: Duplex;
  finished: Promise<void>;
  output: () => string;
}

async function startJsonAsk(body: Record<string, unknown>): Promise<JsonAskInvocation> {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
  const request = new IncomingMessage(socket as unknown as Socket);
  request.method = "POST";
  request.url = "/";
  request.headers = { host: "localhost" };
  (request as Request).body = body;
  const response = new ServerResponse(request);
  response.assignSocket(socket as unknown as Socket);
  const finished = new Promise<void>((resolve, reject) => {
    response.once("finish", resolve);
    response.once("error", reject);
  });
  const app = express();
  app.use(askRouter);
  app.use(errorHandler);
  app(request, response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    request,
    response,
    socket,
    finished,
    output: () => Buffer.concat(chunks).toString("utf8"),
  };
}

function responseBody(invocation: JsonAskInvocation): Record<string, unknown> {
  const raw = invocation.output();
  return JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4)) as Record<string, unknown>;
}
function expectJsonAskCleanup(invocation: JsonAskInvocation): void {
  expect(invocation.request.listenerCount("aborted")).toBe(0);
  expect(invocation.response.listenerCount("close")).toBe(0);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JSON ask request deadline", () => {
  it("returns the timeout envelope when the route deadline aborts generation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new AppError(502, "Analysis generation failed. Please try again.")), { once: true });
      });
    });

    const invocation = await startJsonAsk({ question: "Will this time out?", stream: false });
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      await invocation.finished;
      expect(signal.aborted).toBe(true);
      expect(invocation.response.statusCode).toBe(504);
      expect(responseBody(invocation)).toEqual({
        error: "Analysis service timed out. Please try again.",
      });
      expectJsonAskCleanup(invocation);
    } finally {
      if (!invocation.response.writableEnded) invocation.response.end();
      invocation.socket.destroy();
    }
  });

  it("rejects a successful provider result that arrives after the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    let resolveProvider!: (value: typeof successfulAnswer) => void;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return new Promise<typeof successfulAnswer>((resolve) => { resolveProvider = resolve; });
    });

    const invocation = await startJsonAsk({ question: "Return late.", stream: false });
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      expect(signal.aborted).toBe(true);
      resolveProvider(successfulAnswer);
      await invocation.finished;
      expect(invocation.response.statusCode).toBe(504);
      expect(responseBody(invocation)).toEqual({
        error: "Analysis service timed out. Please try again.",
      });
      expectJsonAskCleanup(invocation);
    } finally {
      if (!invocation.response.writableEnded) invocation.response.end();
      invocation.socket.destroy();
    }
  });

  it("lets a client disconnect win over a later deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    let resolveProvider!: (value: typeof successfulAnswer) => void;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return new Promise<typeof successfulAnswer>((resolve) => { resolveProvider = resolve; });
    });

    const invocation = await startJsonAsk({ question: "Disconnect first.", stream: false });
    try {
      await Promise.resolve();
      invocation.response.emit("close");
      expect(signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(90_000);
      resolveProvider(successfulAnswer);
      await Promise.resolve();
      await Promise.resolve();
      expect(invocation.output()).toBe("");
      expect(invocation.response.writableEnded).toBe(false);
    } finally {
      invocation.socket.destroy();
    }
  });

  it("suppresses a late provider rejection after client disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    let rejectProvider!: (reason?: unknown) => void;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return new Promise<typeof successfulAnswer>((_resolve, reject) => { rejectProvider = reject; });
    });

    const invocation = await startJsonAsk({ question: "Reject after disconnect.", stream: false });
    try {
      invocation.response.emit("close");
      expect(signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(90_000);
      rejectProvider(new AppError(502, "Analysis generation failed. Please try again."));
      await Promise.resolve();
      await Promise.resolve();
      expect(invocation.output()).toBe("");
      expect(invocation.response.writableEnded).toBe(false);
      expectJsonAskCleanup(invocation);
    } finally {
      invocation.socket.destroy();
    }
  });

  it("suppresses a late rejection when the deadline precedes disconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    let rejectProvider!: (reason?: unknown) => void;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return new Promise<typeof successfulAnswer>((_resolve, reject) => { rejectProvider = reject; });
    });

    const invocation = await startJsonAsk({ question: "Close after deadline.", stream: false });
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      expect(signal.aborted).toBe(true);
      invocation.response.emit("close");
      rejectProvider(new AppError(502, "Analysis generation failed. Please try again."));
      await Promise.resolve();
      await Promise.resolve();
      expect(invocation.output()).toBe("");
      expect(invocation.response.writableEnded).toBe(false);
      expectJsonAskCleanup(invocation);
    } finally {
      invocation.socket.destroy();
    }
  });

  it("cleans up the JSON request deadline after success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal!: AbortSignal;
    vi.spyOn(askService, "answerQuestion").mockImplementation(async (
      _question, _history, _teams, requestSignal
    ) => {
      signal = requestSignal!;
      return successfulAnswer;
    });

    const invocation = await startJsonAsk({ question: "Complete normally.", stream: false });
    try {
      await invocation.finished;
      expect(invocation.response.statusCode).toBe(200);
      expect(responseBody(invocation)).toEqual(successfulAnswer);
      expectJsonAskCleanup(invocation);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(signal.aborted).toBe(false);
    } finally {
      if (!invocation.response.writableEnded) invocation.response.end();
      invocation.socket.destroy();
    }
  });

  it("preserves an ordinary provider failure", async () => {
    vi.spyOn(askService, "answerQuestion").mockRejectedValue(new AppError(502, "Analysis generation failed. Please try again."));
    const invocation = await startJsonAsk({ question: "Keep ordinary failure.", stream: false });
    try {
      await invocation.finished;
      expect(invocation.response.statusCode).toBe(502);
      expect(responseBody(invocation)).toEqual({ error: "Analysis generation failed. Please try again." });
      expectJsonAskCleanup(invocation);
    } finally {
      if (!invocation.response.writableEnded) invocation.response.end();
      invocation.socket.destroy();
    }
  });

  it("preserves a preexisting AppError envelope", async () => {
    const providerError = new AppError(429, "Provider is busy.", "provider_busy");
    vi.spyOn(askService, "answerQuestion").mockRejectedValue(providerError);
    const invocation = await startJsonAsk({ question: "Keep this error.", stream: false });
    try {
      await invocation.finished;
      expect(invocation.response.statusCode).toBe(429);
      expect(responseBody(invocation)).toEqual({
        error: "Provider is busy.",
        code: "provider_busy",
      });
      expectJsonAskCleanup(invocation);
    } finally {
      if (!invocation.response.writableEnded) invocation.response.end();
      invocation.socket.destroy();
    }
  });
});

describe("askRateLimitConfig", () => {
  it("divides the intended global budget across replicas", () => {
    // express-rate-limit counts per process, so the per-instance budget has to
    // be the global one divided by replica count. Production runs two: with a
    // flat limit of 10 each, a 20-request burst split 10/10 and nothing was
    // throttled at all on an endpoint that spends LLM quota per call.
    expect(askRateLimitConfig.perInstance)
      .toBe(Math.floor(askRateLimitConfig.perMinute / askRateLimitConfig.replicas));
  });

  it("never drops below one request per instance", () => {
    // A replica count above the limit would otherwise floor to zero and refuse
    // every request.
    expect(askRateLimitConfig.perInstance).toBeGreaterThanOrEqual(1);
    expect(askRateLimitConfig.replicas).toBeGreaterThanOrEqual(1);
  });

  it("uses one deployment bucket across unrelated client IPs", () => {
    expect(askRateLimitKey()).toBe("deployment");
    expect(askRateLimitKey()).toBe(askRateLimitKey());
  });

  it("jointly limits requests from two client IPs against the process budget", async () => {
    const limiter = createAskRateLimiter({
      scope: "deployment", perMinute: 2, replicas: 1, perInstance: 2,
    });
    const invoke = async (ip: string): Promise<number> => {
      let status = 200;
      let nextCalled = false;
      const req = {
        ip,
        headers: { "x-forwarded-for": ip },
        app: { get: () => 1 },
      } as unknown as Request;
      const response = {
        statusCode: 200,
        setHeader: () => undefined,
        getHeader: () => undefined,
        status(code: number) { status = code; response.statusCode = code; return response; },
        send() { return response; },
      };
      const res = response as unknown as Response;
      await new Promise<void>((resolve, reject) => {
        const next: NextFunction = (error?: unknown) => {
          if (error) reject(error);
          else { nextCalled = true; resolve(); }
        };
        void Promise.resolve(limiter(req, res, next)).then(() => {
          if (!nextCalled) {
            status = res.statusCode;
            resolve();
          }
        }, reject);
      });
      return status;
    };

    expect(await invoke("203.0.113.10")).toBe(200);
    expect(await invoke("198.51.100.20")).toBe(200);
    expect(await invoke("203.0.113.10")).toBe(429);
  });

  it("rejects invalid or impossible deployment configuration", () => {
    for (const env of [
      { ASK_RATE_LIMIT_PER_MINUTE: "0", API_REPLICAS: "1" },
      { ASK_RATE_LIMIT_PER_MINUTE: "ten", API_REPLICAS: "1" },
      { ASK_RATE_LIMIT_PER_MINUTE: "10", API_REPLICAS: "0" },
      { ASK_RATE_LIMIT_PER_MINUTE: "2", API_REPLICAS: "3" },
    ]) {
      expect(() => resolveAskRateLimitConfig(env)).toThrow();
    }
    expect(resolveAskRateLimitConfig({
      ASK_RATE_LIMIT_PER_MINUTE: "10",
      API_REPLICAS: "2",
    })).toEqual({ scope: "deployment", perMinute: 10, replicas: 2, perInstance: 5 });
  });
});

describe("parseHistory", () => {
  it("accepts complete user/assistant exchanges", () => {
    expect(parseHistory([
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ])).toHaveLength(2);
  });

  it("rejects dangling turns and oversized total history", () => {
    expect(() => parseHistory([{ role: "user", content: "Question" }]))
      .toThrow(/conversation context is invalid/i);
    const large = "x".repeat(3_001);
    expect(() => parseHistory(Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: large,
    })))).toThrow(/conversation context is too long/i);
  });

  it.each([
    null,
    {},
    [{ role: "system", content: "x" }],
    [{ role: "user", content: "" }, { role: "assistant", content: "x" }],
  ])("does not expose history schema details for malformed value %#", (value) => {
    expect(() => parseHistory(value)).toThrow(/conversation context/i);
    try {
      parseHistory(value);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/\bhistory\b|role|assistant|4000|12000/i);
    }
  });
});

describe("parseFixtureContext", () => {
  it("accepts a stable fixture identity", () => {
    expect(parseFixtureContext({ fixtureId: "espn:eng.1:401" }))
      .toEqual({ fixtureId: "espn:eng.1:401" });
  });

  it.each([null, {}, { fixtureId: "" }, { fixtureId: 401 }])(
    "rejects malformed fixture context %#",
    (value) => {
      expect(() => parseFixtureContext(value)).toThrow(/selected match context is invalid/i);
      try {
        parseFixtureContext(value);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/fixtureContext|fixtureId/i);
      }
    }
  );
});

describe("generic ask validation", () => {
  it.each([null, [], ["Arsenal"], ["Arsenal", ""]])(
    "does not expose team context schema for malformed value %#",
    (value) => {
      expect(() => parseTeamContext(value)).toThrow(/selected match context is invalid/i);
      try {
        parseTeamContext(value);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/teamContext|exactly two/i);
      }
    }
  );

  it("uses user-facing question validation without request-field names", () => {
    expect(() => parseQuestion(undefined)).toThrow("Please enter a question.");
    expect(() => parseQuestion("x".repeat(501))).toThrow(/question is too long/i);
    for (const value of [undefined, "x".repeat(501)]) {
      try {
        parseQuestion(value);
      } catch (error) {
        expect((error as Error).message).not.toMatch(/request body|500 characters|'question'/i);
      }
    }
  });
});
