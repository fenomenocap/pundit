import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWebSearchStatus,
  normalizeSearchDate,
  resetWebSearchStatus,
  searchWeb,
  searchWebBatch,
  withSearchQuestion,
} from "./web-search";

const NOW = new Date("2026-08-11T12:00:00Z");

const MINIMAX_RESULT = {
  title: "Arsenal team news",
  link: "https://example.com/a",
  snippet: "Timber returns",
  date: "12 Apr 2026",
};

const BRAVE_RESULT = {
  title: "Brave: Arsenal team news",
  url: "https://brave.example.com/a",
  description: "Timber returns",
  page_age: "2026-04-12T00:00:00Z",
};

/** A fetch Response stand-in, with the headers surface the code reads. */
function httpOk(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) };
}

function httpError(status: number, headers: Record<string, string> = {}) {
  return { ok: false, status, headers: new Headers(headers), text: async () => "" };
}

const minimaxBody = (results: Array<Record<string, unknown>>) => httpOk({ organic: results });
const braveBody = (results: Array<Record<string, unknown>>) => httpOk({ web: { results } });

/** Routes a mocked fetch by host, so a two-provider chain can be driven. */
function routed(handlers: {
  minimax: () => unknown;
  brave: () => unknown;
}) {
  return (url: string) =>
    String(url).includes("brave.com") ? handlers.brave() : handlers.minimax();
}

describe("normalizeSearchDate", () => {
  it("converts relative dates against the time of the search", () => {
    expect(normalizeSearchDate("19 hours ago", NOW)).toBe("2026-08-10");
    expect(normalizeSearchDate("2 days ago", NOW)).toBe("2026-08-09");
  });

  it("normalises absolute dates to ISO", () => {
    expect(normalizeSearchDate("12 Apr 2026", NOW)).toBe("2026-04-12");
    expect(normalizeSearchDate("2026-04-12", NOW)).toBe("2026-04-12");
    expect(normalizeSearchDate("2026-08-10T00:00:00Z", NOW)).toBe("2026-08-10");
  });

  it("keeps a calendar date on its own day regardless of server timezone", () => {
    // A date with no time parses as local midnight, so formatting it as UTC
    // moved it to the previous day anywhere east of Greenwich.
    const originalTz = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
        process.env.TZ = tz;
        expect(normalizeSearchDate("12 Apr 2026", NOW)).toBe("2026-04-12");
        expect(normalizeSearchDate("2026-04-12", NOW)).toBe("2026-04-12");
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("returns empty rather than guessing when there is no usable date", () => {
    // A wrong date is a fabricated citation; an absent one only makes the
    // model hedge, which is the safer failure.
    expect(normalizeSearchDate("", NOW)).toBe("");
    expect(normalizeSearchDate("recently", NOW)).toBe("");
    expect(normalizeSearchDate("last season", NOW)).toBe("");
    expect(normalizeSearchDate("2026-08-13", NOW)).toBe("");
  });
});

/** Restores every environment variable the suite touches. */
function withCleanEnv() {
  const keys = [
    "MINIMAX_API_KEY",
    "MINIMAX_SEARCH_API_KEY",
    "MINIMAX_SEARCH_URL",
    "BRAVE_SEARCH_API_KEY",
    "BRAVE_SEARCH_URL",
    "WEB_SEARCH_PROVIDER_ORDER",
    "WEB_SEARCH_CONCURRENCY",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

describe("searchWeb result handling", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.WEB_SEARCH_PROVIDER_ORDER;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("uses MiniMax first and reports it as the serving provider", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const outcome = await searchWeb("arsenal team news");
    expect(outcome.status).toBe("ok");
    expect(outcome.provider).toBe("minimax");
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.results).toEqual([{
      title: "Arsenal team news",
      link: "https://example.com/a",
      snippet: "Timber returns",
      date: "2026-04-12",
    }]);
    expect(getWebSearchStatus().lastGoodProvider).toBe("minimax");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops entries missing a title or link", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([
      { title: "", link: "https://example.com/x", snippet: "s", date: "" },
      { title: "Real", link: "", snippet: "s", date: "" },
      MINIMAX_RESULT,
    ]));
    const outcome = await searchWeb("arsenal");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].title).toBe("Arsenal team news");
  });

  it("caps results so a long payload cannot flood the turn", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody(
      Array.from({ length: 20 }, (_, i) => ({
        title: `r${i}`, link: `https://example.com/${i}`, snippet: "s", date: "",
      }))
    ));
    expect((await searchWeb("arsenal")).results).toHaveLength(6);
  });

  it("rejects unsafe URLs and bounds untrusted fields", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([
      { title: "unsafe", link: "javascript:alert(1)", snippet: "x", date: "" },
      { title: "t".repeat(300), link: "https://example.com/ok", snippet: "s".repeat(800), date: "" },
    ]));
    const { results } = await searchWeb("bounds");
    expect(results).toHaveLength(1);
    expect(results[0].title).toHaveLength(200);
    expect(results[0].snippet).toHaveLength(600);
  });

  it("coalesces concurrent searches and serves the cache", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const [first, second] = await Promise.all([
      searchWeb("same query"),
      searchWeb("SAME QUERY"),
    ]);
    expect(first.results).toEqual(second.results);
    expect((await searchWeb("same query")).results).toEqual(first.results);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Team news and form move on a news cycle; prices move constantly. One
  // five-minute TTL for both meant every question re-ran every search.
  it("keeps a team-news search past the window a price search expires in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));

    await searchWeb("hull man united team news injuries");
    await searchWeb("hull man united betting odds over 2.5");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    await searchWeb("hull man united team news injuries");
    expect(fetchMock).toHaveBeenCalledTimes(2); // still cached

    await searchWeb("hull man united betting odds over 2.5");
    expect(fetchMock).toHaveBeenCalledTimes(3); // price search refetched
  });
});

describe("search cancellation isolation", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("isolates aborts between different signal-bearing callers", async () => {
    const pending: Array<{ resolve: (response: ReturnType<typeof httpOk>) => void }> = [];
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<ReturnType<typeof httpOk>>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = (): void => {
          signal?.removeEventListener("abort", onAbort);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        pending.push({
          resolve: (response) => {
            signal?.removeEventListener("abort", onAbort);
            resolve(response);
          },
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    });

    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = withSearchQuestion(() => searchWeb("same query", firstController.signal));
    const second = withSearchQuestion(() => searchWeb("SAME QUERY", secondController.signal));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    firstController.abort();
    await expect(first).rejects.toThrow();
    expect(getWebSearchStatus().providers.minimax.failures).toBe(0);
    expect(getWebSearchStatus().consecutiveFailures).toBe(0);

    pending[1].resolve(minimaxBody([MINIMAX_RESULT]));
    await expect(second).resolves.toMatchObject({ status: "ok", provider: "minimax" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getWebSearchStatus().providers.minimax.failures).toBe(0);
  });

  it("coalesces same-signal callers inside the same logical question", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const controller = new AbortController();
    const [first, second] = await withSearchQuestion(() => Promise.all([
      searchWeb("same query", controller.signal),
      searchWeb("SAME QUERY", controller.signal),
    ]));

    expect(first.results).toEqual(second.results);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share one signal across independent question scopes", async () => {
    fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));
    const controller = new AbortController();
    const first = withSearchQuestion(() => searchWeb("same query", controller.signal));
    const second = withSearchQuestion(() => searchWeb("same query", controller.signal));

    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a late provider result after caller cancellation", async () => {
    let resolveLate: ((response: ReturnType<typeof httpOk>) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<ReturnType<typeof httpOk>>((resolve) => {
      resolveLate = resolve;
    }));

    const controller = new AbortController();
    const cancelled = searchWeb("late result query", controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(resolveLate).toBeTypeOf("function");
    controller.abort();
    resolveLate!(minimaxBody([MINIMAX_RESULT]));
    await expect(cancelled).rejects.toThrow();

    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    await expect(searchWeb("late result query")).resolves.toMatchObject({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels a queued waiter promptly and removes its in-flight entry", async () => {
    process.env.WEB_SEARCH_CONCURRENCY = "1";
    const pending: Array<(response: ReturnType<typeof minimaxBody>) => void> = [];
    fetchMock.mockImplementation(() =>
      new Promise<ReturnType<typeof minimaxBody>>((resolve) => pending.push(resolve))
    );

    const holding = searchWeb("holding query");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const queued = searchWeb("queued query", controller.signal);
    let queuedState = "pending";
    const queuedSettled = queued.then(
      () => { queuedState = "resolved"; },
      () => { queuedState = "rejected"; },
    );
    controller.abort();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(queuedState).toBe("rejected");
    await queuedSettled;

    // The canceled entry is gone even while the first provider call still
    // owns the only slot, so a fresh caller can register its own work.
    const retry = searchWeb("queued query");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending[0](minimaxBody([MINIMAX_RESULT]));
    await expect(holding).resolves.toMatchObject({ status: "ok" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pending[1](minimaxBody([MINIMAX_RESULT]));
    await expect(retry).resolves.toMatchObject({ status: "ok" });
  });
});

/**
 * The distinction the whole redesign exists for. `[]` used to mean four
 * different things; a reader could not tell a quiet news day from an outage,
 * and neither could an operator.
 */
describe("genuine emptiness versus infrastructure failure", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("reports a genuine zero-result search as empty, not degraded", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([]));
    const outcome = await searchWeb("a query nobody has written about");
    expect(outcome.status).toBe("empty");
    expect(outcome.reason).toBeNull();
    expect(outcome.results).toEqual([]);
    // A healthy provider that found nothing is healthy.
    expect(getWebSearchStatus().providers.minimax.failures).toBe(0);
    expect(getWebSearchStatus().degradedSearches).toBe(0);
  });

  it.each([
    ["rate_limited", () => httpError(429)],
    ["provider_unavailable", () => httpError(503)],
    ["not_configured", () => httpError(401)],
  ] as const)("reports HTTP %s as its own degraded reason", async (reason, response) => {
    fetchMock.mockResolvedValue(response());
    const outcome = await searchWeb(`q-${reason}`);
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe(reason);
    expect(outcome.results).toEqual([]);
  });

  it("reports a network timeout as a timeout", async () => {
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    const outcome = await searchWeb("timing out");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("timeout");
  });

  it("reports an unparseable body as a malformed response, and does not retry it", async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), text: async () => "<html>nope</html>",
    });
    const outcome = await searchWeb("garbage payload");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("malformed_response");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops reading an oversized body instead of buffering all of it first", async () => {
    // The cap used to be checked on an already-buffered `text()`, which cannot
    // prevent anything: the whole body is in memory by the time the length is
    // measured. Reading has to stop at the limit, so an endpoint that streams
    // far more than the cap is abandoned partway rather than absorbed.
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let chunksServed = 0;
    let cancelled = false;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            chunksServed += 1;
            // Far past the 256KB cap: a correct reader never asks for them all.
            return chunksServed > 1_000
              ? { done: true, value: undefined }
              : { done: false, value: chunk };
          },
          cancel: async () => { cancelled = true; },
        }),
      },
    });
    const outcome = await searchWeb("oversized body");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("malformed_response");
    // 256KB of 64KB chunks is five reads: four to reach the cap and one to
    // cross it. Anything near 1,000 means the body was swallowed whole.
    expect(chunksServed).toBeLessThanOrEqual(6);
    expect(cancelled).toBe(true);
  });

  it("treats a structurally valid but wrongly shaped payload as empty, not evidence", async () => {
    // `organic: "nope"` parses; it just carries nothing usable.
    fetchMock.mockResolvedValueOnce(httpOk({ organic: "nope" }));
    const outcome = await searchWeb("shape drift");
    expect(outcome.results).toEqual([]);
    expect(outcome.status).toBe("empty");
  });

  it("reports circuit_open once every enabled provider's breaker is open", async () => {
    fetchMock.mockResolvedValue(httpError(404));
    for (const question of ["q1", "q2", "q3"]) {
      await withSearchQuestion(() => searchWeb(question));
    }
    expect(getWebSearchStatus().providers.minimax.circuitOpen).toBe(true);
    const outcome = await searchWeb("blocked while open");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("circuit_open");
  });

  it("reports not_configured when no provider has a key at all", async () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_SEARCH_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    const outcome = await searchWeb("unconfigured");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports providers_exhausted when both configured providers fail", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    fetchMock.mockResolvedValue(httpError(404));
    const outcome = await searchWeb("everything is down");
    expect(outcome.status).toBe("degraded");
    expect(outcome.reason).toBe("providers_exhausted");
    expect(outcome.attempts.map((a) => a.provider)).toEqual(["minimax", "brave"]);
    expect(outcome.attempts.every((a) => a.outcome === "failed")).toBe(true);
  });

  it("does not report an empty query as an infrastructure failure", async () => {
    const outcome = await searchWeb("   ");
    expect(outcome.status).toBe("empty");
    expect(outcome.reason).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("provider failover", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    delete process.env.WEB_SEARCH_PROVIDER_ORDER;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("falls back to Brave when MiniMax is rate limited, and still delivers evidence", async () => {
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(httpError(429)),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    const outcome = await searchWeb("arsenal team news");
    // The answer is not thin: a throttled primary cost nothing but a hop.
    expect(outcome.status).toBe("ok");
    expect(outcome.provider).toBe("brave");
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.results[0]).toEqual({
      title: "Brave: Arsenal team news",
      link: "https://brave.example.com/a",
      snippet: "Timber returns",
      date: "2026-04-12",
    });
    const status = getWebSearchStatus();
    expect(status.usingFallback).toBe(true);
    expect(status.providers.minimax.lastThrottledAt).not.toBeNull();
    expect(status.lastThrottledAt).not.toBeNull();
  });

  it.each([
    ["a 5xx outage", () => httpError(500)],
    ["a malformed payload", () => httpOk({ not: "a search response" })],
    ["a rejected credential", () => httpError(401)],
    ["a network error", () => Promise.reject(new Error("ECONNRESET"))],
  ])("fails over to Brave on %s", async (_label, minimax) => {
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(minimax()),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    const outcome = await searchWeb("arsenal team news");
    expect(outcome.status).toBe("ok");
    expect(outcome.provider).toBe("brave");
  });

  it("falls through to Brave when MiniMax is merely empty, without blaming MiniMax", async () => {
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(minimaxBody([])),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    const outcome = await searchWeb("arsenal");
    expect(outcome.provider).toBe("brave");
    expect(getWebSearchStatus().providers.minimax.failures).toBe(0);
  });

  it("skips a provider whose own breaker is open and serves the healthy one", async () => {
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(httpError(404)),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    for (const question of ["q1", "q2", "q3"]) {
      await withSearchQuestion(() => searchWeb(question));
    }
    const status = getWebSearchStatus();
    expect(status.providers.minimax.circuitOpen).toBe(true);
    // One provider being out is not an outage while another is serving.
    expect(status.circuitOpen).toBe(false);
    expect(status.providers.brave.circuitOpen).toBe(false);

    fetchMock.mockClear();
    const outcome = await searchWeb("still answerable");
    expect(outcome.status).toBe("ok");
    expect(outcome.provider).toBe("brave");
    // MiniMax was not even called: an open breaker means no traffic.
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("brave"))).toBe(true);
  });

  it("lets an operator promote the fallback to primary with no code change", async () => {
    process.env.WEB_SEARCH_PROVIDER_ORDER = "brave,minimax";
    resetWebSearchStatus();
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(minimaxBody([MINIMAX_RESULT])),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    const outcome = await searchWeb("who answers first");
    expect(outcome.provider).toBe("brave");
    // Serving from the configured primary is not "using fallback".
    expect(outcome.usedFallback).toBe(false);
    const status = getWebSearchStatus();
    expect(status.primaryProvider).toBe("brave");
    expect(status.usingFallback).toBe(false);
    expect(status.enabledProviders).toEqual(["brave", "minimax"]);
  });

  it("runs MiniMax alone when no fallback key is configured", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));
    expect((await searchWeb("solo")).provider).toBe("minimax");
    const status = getWebSearchStatus();
    expect(status.enabledProviders).toEqual(["minimax"]);
    // The seam is still visible, so adding a key is all that is needed.
    expect(status.configuredProviders).toEqual(["minimax", "brave"]);
    expect(status.providers.brave.enabled).toBe(false);
  });

  it("retries a throttled provider at most once before failing over", async () => {
    let minimaxCalls = 0;
    fetchMock.mockImplementation(routed({
      minimax: () => {
        minimaxCalls += 1;
        return Promise.resolve(httpError(429));
      },
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    await searchWeb("retry budget");
    // Bounded: a throttled provider answers a retry storm with more throttling.
    expect(minimaxCalls).toBe(2);
  });

  it("does not wait out a long Retry-After; it fails over instead", async () => {
    const startedAt = Date.now();
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(httpError(429, { "retry-after": "120" })),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    const outcome = await searchWeb("long retry-after");
    expect(outcome.provider).toBe("brave");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

/**
 * The regression that motivated the redesign. One question fans out into ~6
 * searches -- a planned batch plus the model's own tool calls -- and a global,
 * per-search breaker let a single throttled question blank the *next* reader's
 * evidence for five minutes. That reached the reader as a worse model.
 */
describe("question-scoped breaker accounting", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("does not trip the breaker when one question fans out into six failing searches", async () => {
    fetchMock.mockResolvedValue(httpError(404));
    await searchWebBatch(["q1", "q2", "q3", "q4", "q5", "q6"]);
    const status = getWebSearchStatus();
    expect(status.providers.minimax.consecutiveFailedQuestions).toBe(1);
    expect(status.providers.minimax.circuitOpen).toBe(false);
    expect(status.circuitOpen).toBe(false);
  });

  it("attempts every one of a failing question's searches rather than skipping the tail", async () => {
    // The old breaker opened mid-question and silently dropped the remaining
    // searches -- including ones that would have succeeded.
    fetchMock.mockResolvedValue(httpError(404));
    await searchWebBatch(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("keeps a later search of the same question alive after earlier ones fail", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call <= 4 ? httpError(404) : minimaxBody([MINIMAX_RESULT]));
    });
    const outcomes = await searchWebBatch(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(outcomes.filter((outcome) => outcome.status === "ok")).toHaveLength(2);
    expect(getWebSearchStatus().providers.minimax.consecutiveFailedQuestions).toBe(0);
  });

  it("counts the model's own tool searches inside the same question, not as new ones", async () => {
    fetchMock.mockResolvedValue(httpError(404));
    // One question: the planned batch, then three model-driven tool searches.
    await withSearchQuestion(async () => {
      await searchWebBatch(["planned-a", "planned-b"]);
      await searchWeb("tool-1");
      await searchWeb("tool-2");
      await searchWeb("tool-3");
    });
    // Five failed searches, one failed question.
    expect(getWebSearchStatus().providers.minimax.consecutiveFailedQuestions).toBe(1);
    expect(getWebSearchStatus().circuitOpen).toBe(false);
  });

  it("does not let one question's failures blank the next question's evidence", async () => {
    fetchMock.mockResolvedValue(httpError(404));
    await withSearchQuestion(async () => {
      await searchWeb("t1");
      await searchWeb("t2");
      await searchWeb("t3");
    });
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));
    const outcome = await withSearchQuestion(() => searchWeb("the next reader's question"));
    expect(outcome.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the breaker only after three consecutive failed questions", async () => {
    fetchMock.mockResolvedValue(httpError(404));
    await searchWebBatch(["a", "b"]);
    await searchWebBatch(["c", "d"]);
    expect(getWebSearchStatus().providers.minimax.circuitOpen).toBe(false);
    await searchWebBatch(["e", "f"]);
    expect(getWebSearchStatus().providers.minimax.circuitOpen).toBe(true);
    expect(getWebSearchStatus().circuitOpen).toBe(true);
  });

  it("treats a question where any search worked as a healthy question", async () => {
    fetchMock
      .mockResolvedValueOnce(httpError(404))
      .mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const outcomes = await searchWebBatch(["fails", "works"]);
    expect(outcomes[1].results).toHaveLength(1);
    expect(getWebSearchStatus().providers.minimax.consecutiveFailedQuestions).toBe(0);
    expect(getWebSearchStatus().consecutiveFailures).toBe(0);
  });

  it("allows one half-open probe after the open window and closes on recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(httpError(404));
    for (const question of [["a"], ["b"], ["c"]]) await searchWebBatch(question);
    expect((await searchWeb("blocked")).reason).toBe("circuit_open");

    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1));
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));
    expect((await searchWeb("probe")).status).toBe("ok");
    expect((await searchWeb("after recovery")).status).toBe("ok");
    expect(getWebSearchStatus().providers.minimax.circuitOpen).toBe(false);
  });

  it("releases a half-open probe when its active caller is cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(httpError(404));
    for (const question of ["a", "b", "c"]) {
      await withSearchQuestion(() => searchWeb(question));
    }

    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1));
    let rejectProbe: ((error: unknown) => void) | undefined;
    fetchMock.mockImplementation((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        rejectProbe = reject;
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      })
    );

    const controller = new AbortController();
    const cancelledProbe = searchWeb("cancelled half-open probe", controller.signal);
    for (let attempt = 0; attempt < 5 && !rejectProbe; attempt += 1) await Promise.resolve();
    expect(rejectProbe).toBeTypeOf("function");
    controller.abort();
    await expect(cancelledProbe).rejects.toThrow();
    expect(getWebSearchStatus().providers.minimax.failures).toBe(3);

    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const recovered = await searchWeb("after cancelled half-open probe");
    expect(recovered.status).toBe("ok");
    expect(recovered.provider).toBe("minimax");
  });

  it("does not amplify a known outage into a retry storm", async () => {
    // Only searches that start before the provider is known-bad earn their
    // transient-blip retry -- at most `concurrency` of them, since that is how
    // many can be in the air before the first failure registers. The rest go
    // straight to failover. Pinned rather than left to the default, so the
    // arithmetic below is about the mechanism instead of whatever the default
    // happens to be: 6 searches + 2 retries = 8, not the 12 an unconditional
    // retry would cost.
    process.env.WEB_SEARCH_CONCURRENCY = "2";
    fetchMock.mockResolvedValue(httpError(503));
    await searchWebBatch(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(fetchMock.mock.calls.length).toBeLessThan(12);
  });

  it("still retries the first search of a question through a transient blip", async () => {
    let call = 0;
    fetchMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? httpError(503) : minimaxBody([MINIMAX_RESULT]));
    });
    const outcomes = await searchWebBatch(["only"]);
    expect(outcomes[0].status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-arms the open window when the half-open probe also fails", async () => {
    // Otherwise the breaker expires once and never protects again: every later
    // search walks straight through to a provider that is still down.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(httpError(404));
    for (const question of ["a", "b", "c"]) {
      await withSearchQuestion(() => searchWeb(question));
    }
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1));
    fetchMock.mockClear();
    const probe = await withSearchQuestion(() => searchWeb("probe"));
    expect(probe.status).toBe("degraded");
    expect(fetchMock).toHaveBeenCalledTimes(1); // exactly one probe

    expect(getWebSearchStatus().providers.minimax.circuitOpen).toBe(true);
    fetchMock.mockClear();
    const blocked = await withSearchQuestion(() => searchWeb("after the failed probe"));
    expect(blocked.reason).toBe("circuit_open");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets only one search probe at a time once the window elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(httpError(404));
    for (const question of ["a", "b", "c"]) {
      await withSearchQuestion(() => searchWeb(question));
    }
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1));
    fetchMock.mockClear();
    // Four distinct queries at once against a provider that may still be down.
    await withSearchQuestion(() => searchWebBatch(["p1", "p2", "p3", "p4"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrency independently of provider health", async () => {
    // Pinned, so this asserts that the gate holds whatever it is set to rather
    // than re-encoding the current default.
    process.env.WEB_SEARCH_CONCURRENCY = "2";
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return minimaxBody([MINIMAX_RESULT]);
    });
    await searchWebBatch(["a", "b", "c", "d", "e", "f"]);
    expect(peak).toBeLessThanOrEqual(2);
    // A throttled burst is a load condition, not a sick provider.
    expect(getWebSearchStatus().providers.minimax.failures).toBe(0);
  });

  it("still bounds concurrency after searches are cancelled mid-flight", async () => {
    // Cancellation used to release the concurrency slot twice -- once in the
    // catch and again in the finally -- so every abandoned request widened the
    // gate permanently. Readers cancel constantly, so the burst control was
    // gone long before load arrived.
    process.env.WEB_SEARCH_CONCURRENCY = "2";
    const cancelled = new AbortController();
    fetchMock.mockImplementation(async () => {
      cancelled.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await searchWeb(`cancelled-${attempt}`, cancelled.signal).catch(() => undefined);
    }

    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return minimaxBody([MINIMAX_RESULT]);
    });
    // Driven as independent searches rather than one batch: a batch bounds
    // itself by worker count, so only concurrent requests -- the real shape of
    // two readers at once -- actually exercise the process-wide gate.
    await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((query) => searchWeb(query))
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("readiness reporting", () => {
  const fetchMock = vi.fn();
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = withCleanEnv();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "super-secret-minimax-key";
    process.env.BRAVE_SEARCH_API_KEY = "super-secret-brave-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it("reports a throttled primary with a healthy fallback as degraded but serving", async () => {
    fetchMock.mockImplementation(routed({
      minimax: () => Promise.resolve(httpError(429)),
      brave: () => Promise.resolve(braveBody([BRAVE_RESULT])),
    }));
    await withSearchQuestion(() => searchWeb("arsenal"));
    const status = getWebSearchStatus();
    expect(status.circuitOpen).toBe(false);
    expect(status.usingFallback).toBe(true);
    expect(status.lastGoodProvider).toBe("brave");
    expect(status.providers.minimax.lastThrottledAt).not.toBeNull();
    expect(status.providers.minimax.lastFailureReason).toBe("rate_limited");
    expect(status.providers.brave.successes).toBe(1);
  });

  it("reports a total search outage with the reason it gave up", async () => {
    fetchMock.mockResolvedValue(httpError(503));
    await withSearchQuestion(() => searchWeb("everything down"));
    const status = getWebSearchStatus();
    expect(status.degradedSearches).toBe(1);
    expect(status.lastDegradedReason).toBe("providers_exhausted");
    expect(status.lastDegradedAt).not.toBeNull();
    expect(status.consecutiveFailures).toBe(1);
  });

  it("never exposes a key in readiness output or in logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      fetchMock.mockResolvedValue(httpError(429));
      await withSearchQuestion(() => searchWeb("secret leak check"));
      fetchMock.mockResolvedValue(minimaxBody([MINIMAX_RESULT]));
      await withSearchQuestion(() => searchWeb("secret leak check two"));

      const emitted = [...warn.mock.calls, ...log.mock.calls].map(String).join("\n");
      const readiness = JSON.stringify(getWebSearchStatus());
      for (const secret of ["super-secret-minimax-key", "super-secret-brave-key"]) {
        expect(readiness).not.toContain(secret);
        expect(emitted).not.toContain(secret);
      }
      // Provider identity is reported; credentials are not.
      expect(readiness).toContain("minimax");
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
