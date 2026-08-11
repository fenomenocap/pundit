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

function braveBody(results: Array<Record<string, unknown>>) {
  return { ok: true, json: async () => ({ web: { results } }) };
}

const MINIMAX_RESULT = {
  title: "Arsenal team news",
  link: "https://example.com/a",
  snippet: "Timber returns",
  date: "12 Apr 2026",
};

const BRAVE_RESULT = {
  title: "Arsenal injury list",
  url: "https://example.com/b",
  description: "Saka doubtful",
  page_age: "2026-08-10T00:00:00Z",
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
  });
});

describe("searchWeb provider chain", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetWebSearchStatus();
    process.env.MINIMAX_API_KEY = "test-key";
    delete process.env.BRAVE_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAVE_API_KEY;
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

  it("falls over to Brave when the MiniMax endpoint breaks", async () => {
    // The reason Brave exists: the MiniMax endpoint is undocumented and can
    // change shape without notice.
    process.env.BRAVE_API_KEY = "brave-key";
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce(braveBody([BRAVE_RESULT]));
    const results = await searchWeb("arsenal team news");
    expect(results).toHaveLength(1);
    expect(results[0].link).toBe("https://example.com/b");
    expect(results[0].date).toBe("2026-08-10");
    const status = getWebSearchStatus();
    expect(status.lastGoodProvider).toBe("brave");
    expect(status.providerFailures.minimax).toBe(1);
    expect(status.consecutiveFailures).toBe(0);
  });

  it("falls through a provider that succeeds but returns nothing", async () => {
    process.env.BRAVE_API_KEY = "brave-key";
    fetchMock
      .mockResolvedValueOnce(minimaxBody([]))
      .mockResolvedValueOnce(braveBody([BRAVE_RESULT]));
    expect(await searchWeb("arsenal")).toHaveLength(1);
    expect(getWebSearchStatus().lastGoodProvider).toBe("brave");
  });

  it("skips Brave entirely when no key is configured", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await searchWeb("arsenal")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getWebSearchStatus().enabledProviders).toEqual(["minimax"]);
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
});
