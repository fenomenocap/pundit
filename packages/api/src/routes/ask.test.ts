import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  askRateLimitConfig,
  askRateLimitKey,
  createAskRateLimiter,
  parseFixtureContext,
  parseHistory,
  parseQuestion,
  parseTeamContext,
  parseUserLine,
  resolveAskRateLimitConfig,
} from "./ask";

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

describe("parseUserLine", () => {
  it("accepts a 1X2 outcome with decimal odds above 1", () => {
    expect(parseUserLine({ outcome: "away", decimalOdds: 7 }))
      .toEqual({ outcome: "away", decimalOdds: 7 });
  });

  it.each([
    null,
    {},
    { outcome: "away" },
    { outcome: "away", decimalOdds: 1 },
    { outcome: "winner", decimalOdds: 7 },
    { outcome: "away", decimalOdds: "7" },
  ])("rejects a malformed price line %#", (value) => {
    expect(() => parseUserLine(value)).toThrow(/price line is invalid/i);
    try {
      parseUserLine(value);
    } catch (error) {
      expect((error as Error).message).not.toMatch(/userLine|decimalOdds|outcome/i);
    }
  });
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
