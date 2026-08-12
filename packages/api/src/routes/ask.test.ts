import { describe, expect, it } from "vitest";
import { parseHistory, askRateLimitConfig, parseFixtureContext } from "./ask";

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
      .toThrow(/complete user\/assistant/);
    const large = "x".repeat(3_001);
    expect(() => parseHistory(Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: large,
    })))).toThrow(/12000/);
  });
});

describe("parseFixtureContext", () => {
  it("accepts a stable fixture identity", () => {
    expect(parseFixtureContext({ fixtureId: "espn:eng.1:401" }))
      .toEqual({ fixtureId: "espn:eng.1:401" });
  });

  it.each([null, {}, { fixtureId: "" }, { fixtureId: 401 }])(
    "rejects malformed fixture context %#",
    (value) => expect(() => parseFixtureContext(value)).toThrow(/fixtureContext/)
  );
});
