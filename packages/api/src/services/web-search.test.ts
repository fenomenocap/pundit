import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWebSearchStatus,
  normalizeSearchDate,
  resetWebSearchStatus,
  searchWeb,
} from "./web-search";

const NOW = new Date("2026-08-11T12:00:00Z");

function minimaxBody(results: Array<Record<string, unknown>>) {
  return { ok: true, json: async () => ({ organic: results }) };
}

const MINIMAX_RESULT = {
  title: "Arsenal team news",
  link: "https://example.com/a",
  snippet: "Timber returns",
  date: "12 Apr 2026",
};

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

describe("searchWeb provider chain", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses MiniMax first and reports it as the serving provider", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const results = await searchWeb("arsenal team news");
    expect(results).toEqual([{
      title: "Arsenal team news",
      link: "https://example.com/a",
      snippet: "Timber returns",
      date: "2026-04-12",
    }]);
    expect(getWebSearchStatus().lastGoodProvider).toBe("minimax");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the failure and degrades when the MiniMax endpoint breaks", async () => {
    // Search rides MiniMax's own key and quota by design; there is no second
    // vendor to fall back to, so a break must be counted and visible on /ready
    // rather than silently looking like the model not searching.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    expect(await searchWeb("arsenal team news")).toEqual([]);
    const status = getWebSearchStatus();
    expect(status.providerFailures.minimax).toBe(1);
    expect(status.consecutiveFailures).toBe(1);
    expect(status.lastGoodProvider).toBeNull();
  });

  it("treats a structurally valid empty payload as no results", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([]));
    expect(await searchWeb("arsenal")).toEqual([]);
    expect(getWebSearchStatus().consecutiveFailures).toBe(1);
  });

  it("makes exactly one upstream call and enables only MiniMax", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await searchWeb("arsenal")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWebSearchStatus().enabledProviders).toEqual(["minimax"]);
  });

  it("clears the failure streak once a search succeeds again", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    await searchWeb("one");
    expect(getWebSearchStatus().consecutiveFailures).toBe(1);
    await searchWeb("two");
    const status = getWebSearchStatus();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastGoodProvider).toBe("minimax");
  });

  it("counts consecutive total failures so an outage is visible", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await searchWeb("one");
    await searchWeb("two");
    const status = getWebSearchStatus();
    expect(status.consecutiveFailures).toBe(2);
    expect(status.totalSearches).toBe(2);
    expect(status.lastGoodProvider).toBeNull();
  });

  it("degrades to empty rather than throwing, so the answer survives", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(searchWeb("arsenal")).resolves.toEqual([]);
  });

  it("ignores an empty query and malformed provider payloads", async () => {
    expect(await searchWeb("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ organic: "nope" }) });
    expect(await searchWeb("arsenal")).toEqual([]);
  });

  it("drops entries missing a title or link", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([
      { title: "", link: "https://example.com/x", snippet: "s", date: "" },
      { title: "Real", link: "", snippet: "s", date: "" },
      MINIMAX_RESULT,
    ]));
    const results = await searchWeb("arsenal");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Arsenal team news");
  });

  it("caps results so a long payload cannot flood the turn", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody(
      Array.from({ length: 20 }, (_, i) => ({
        title: `r${i}`, link: `https://example.com/${i}`, snippet: "s", date: "",
      }))
    ));
    expect(await searchWeb("arsenal")).toHaveLength(6);
  });

  it("rejects unsafe URLs and bounds untrusted fields", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([
      { title: "unsafe", link: "javascript:alert(1)", snippet: "x", date: "" },
      { title: "t".repeat(300), link: "https://example.com/ok", snippet: "s".repeat(800), date: "" },
    ]));
    const results = await searchWeb("bounds");
    expect(results).toHaveLength(1);
    expect(results[0].title).toHaveLength(200);
    expect(results[0].snippet).toHaveLength(600);
  });

  it("coalesces concurrent searches and serves a five-minute cache", async () => {
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    const [first, second] = await Promise.all([
      searchWeb("same query"),
      searchWeb("SAME QUERY"),
    ]);
    expect(first).toEqual(second);
    expect(await searchWeb("same query")).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit after three consecutive provider failures", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await searchWeb("one");
    await searchWeb("two");
    await searchWeb("three");
    await searchWeb("four");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("allows one half-open probe after five minutes and closes on recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fetchMock.mockRejectedValue(new Error("network down"));
    await searchWeb("one");
    await searchWeb("two");
    await searchWeb("three");
    expect(await searchWeb("blocked")).toEqual([]);

    vi.advanceTimersByTime(5 * 60_000);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    expect(await searchWeb("probe")).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(minimaxBody([MINIMAX_RESULT]));
    expect(await searchWeb("after recovery")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
