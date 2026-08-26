import { describe, expect, it, vi } from "vitest";
import {
  EvidencePageCandidate,
  createEvidencePageCache,
  isPrivateOrReservedAddress,
  prefetchEvidencePages,
  retrieveEvidencePages,
} from "./evidence-page-retrieval";

const candidates: EvidencePageCandidate[] = [
  { id: "S3", url: "https://blog.example/three", title: "Other", date: "2026-08-13", authority: "other" },
  { id: "S1", url: "https://club.example/one", title: "Official", date: "2026-08-13", authority: "official" },
  { id: "S2", url: "https://news.example/two", title: "Reputable", date: "2026-08-13", authority: "reputable" },
  { id: "S4", url: "https://wire.example/four", title: "Fourth", date: "2026-08-13", authority: "reputable" },
];

const publicResolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("evidence page retrieval", () => {
  it("recognizes private, loopback, link-local and reserved addresses", () => {
    expect(isPrivateOrReservedAddress("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedAddress("10.2.3.4")).toBe(true);
    expect(isPrivateOrReservedAddress("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedAddress("::1")).toBe(true);
    expect(isPrivateOrReservedAddress("fc00::1")).toBe(true);
    expect(isPrivateOrReservedAddress("93.184.216.34")).toBe(false);
  });

  it("retrieves at most three pages with official-domain priority", async () => {
    const fetch = vi.fn(async (input: string | URL, _init?: RequestInit, address?: { address: string }) => new Response(
      `<html><script>ignore me</script><body>Evidence from ${String(input)}</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } }
    ));
    const pages = await retrieveEvidencePages(candidates, undefined, {
      fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z"),
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every((call) => call[2]?.address === "93.184.216.34")).toBe(true);
    expect(pages.map((page) => page.id)).toEqual(["S1", "S2", "S4"]);
    expect(pages.some((page) => page.authority === "other")).toBe(false);
    expect(pages[0].text).not.toContain("ignore me");
    expect(pages[0].retrievedAt).toBe("2026-08-13T12:00:00.000Z");
  });

  it("does not retrieve unknown-domain evidence as official or reputable", async () => {
    const fetch = vi.fn();
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch,
      resolveHost: publicResolver,
    })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins the validated DNS address into the connection seam", async () => {
    const resolveHost = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit, address?: { address: string }) => {
      if (address?.address !== "93.184.216.34") throw new Error("connection was not pinned");
      return new Response("Pinned evidence", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });
    const pages = await retrieveEvidencePages(candidates.slice(1, 2), undefined, { fetch, resolveHost });
    expect(pages).toHaveLength(1);
    expect(resolveHost).toHaveBeenCalledTimes(1);
  });

  it("blocks private DNS results and private redirect targets", async () => {
    const privateResolver = vi.fn(async (hostname: string) => [{
      address: hostname === "private.example" ? "10.0.0.2" : "93.184.216.34", family: 4,
    }]);
    const fetch = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "http://private.example/admin" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch, resolveHost: privateResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks cross-host redirects so retrieved content keeps the cited source identity", async () => {
    const fetch = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "https://different.example/story" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch, resolveHost: publicResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and non-text responses", async () => {
    const tooLarge = vi.fn(async () => new Response("x".repeat(20), {
      status: 200, headers: { "content-type": "text/plain", "content-length": "20" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: tooLarge, resolveHost: publicResolver, maxResponseBytes: 10,
    })).toEqual([]);
    const json = vi.fn(async () => new Response("{}", {
      status: 200, headers: { "content-type": "application/json" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: json, resolveHost: publicResolver,
    })).toEqual([]);
  });

  it("propagates the request abort instead of degrading it", async () => {
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    await expect(retrieveEvidencePages(candidates.slice(1, 2), controller.signal, {
      fetch: vi.fn(), resolveHost: publicResolver,
    })).rejects.toThrow("deadline");
  });

  it("passes the bounded retrieval signal into DNS resolution", async () => {
    let receivedSignal: AbortSignal | undefined;
    const resolveHost = vi.fn(async (_hostname: string, signal?: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<Array<{ address: string; family: number }>>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn(),
      resolveHost,
      timeoutMs: 5,
    })).toEqual([]);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe("prefetching pages ahead of verification", () => {
  const html = (input: string | URL) => new Response(
    `<html><body>Evidence from ${String(input)}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } }
  );

  it("serves retrieval from a warmed cache instead of fetching again", async () => {
    const fetch = vi.fn(async (input: string | URL) => html(input));
    const cache = createEvidencePageCache();
    const options = { fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z") };

    prefetchEvidencePages(candidates, undefined, cache, options);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    const pages = await retrieveEvidencePages(candidates, undefined, { ...options, cache });
    // Still three, not six: verification consumed the prefetch rather than
    // starting its own round of identical requests.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(pages.map((page) => page.id)).toEqual(["S1", "S2", "S4"]);
    expect(pages[0].text).toContain("club.example/one");
  });

  it("returns exactly what an uncached retrieval would", async () => {
    const options = {
      fetch: vi.fn(async (input: string | URL) => html(input)),
      resolveHost: publicResolver,
      now: () => new Date("2026-08-13T12:00:00Z"),
    };
    const cold = await retrieveEvidencePages(candidates, undefined, options);

    const cache = createEvidencePageCache();
    prefetchEvidencePages(candidates, undefined, cache, options);
    await vi.waitFor(() => expect(options.fetch).toHaveBeenCalledTimes(6));
    const warm = await retrieveEvidencePages(candidates, undefined, { ...options, cache });

    expect(warm).toEqual(cold);
  });

  it("never lets a prefetching candidate lend its identity to another", async () => {
    // The cache stores the body only. If it stored whole pages, a second
    // candidate sharing a URL would inherit the first one's id and title --
    // a citation naming one source while quoting another.
    const shared = "https://news.example/two";
    const cache = createEvidencePageCache();
    const options = {
      fetch: vi.fn(async (input: string | URL) => html(input)),
      resolveHost: publicResolver,
      now: () => new Date("2026-08-13T12:00:00Z"),
    };
    prefetchEvidencePages(
      [{ id: "S9", url: shared, title: "Warmed by this one", date: "2026-08-01", authority: "reputable" }],
      undefined, cache, options
    );
    await vi.waitFor(() => expect(options.fetch).toHaveBeenCalledTimes(1));

    const pages = await retrieveEvidencePages(
      [{ id: "S2", url: shared, title: "Asked for by this one", date: "2026-08-13", authority: "reputable" }],
      undefined, { ...options, cache }
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe("S2");
    expect(pages[0].title).toBe("Asked for by this one");
    expect(pages[0].date).toBe("2026-08-13");
  });

  it("falls back to a normal fetch when the prefetch failed", async () => {
    let attempt = 0;
    const fetch = vi.fn(async (input: string | URL) => {
      attempt += 1;
      if (attempt <= 3) throw new Error("upstream refused the prefetch");
      return html(input);
    });
    const cache = createEvidencePageCache();
    const options = { fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z") };

    prefetchEvidencePages(candidates, undefined, cache, options);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    // A cached failure is a cached fact: retrieval degrades exactly as it would
    // have without the prefetch, and does not throw.
    const pages = await retrieveEvidencePages(candidates, undefined, { ...options, cache });
    expect(pages).toEqual([]);
  });

  it("does not reject when every prefetch fails", async () => {
    const cache = createEvidencePageCache();
    prefetchEvidencePages(candidates, undefined, cache, {
      fetch: vi.fn(async () => { throw new Error("network down"); }),
      resolveHost: publicResolver,
    });
    await expect(Promise.all([...cache.values()])).resolves.toEqual([null, null, null]);
  });

  it("shares one fetch between two callers racing for the same URL", async () => {
    const fetch = vi.fn(async (input: string | URL) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return html(input);
    });
    const cache = createEvidencePageCache();
    const options = { fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z") };
    const [a, b] = await Promise.all([
      retrieveEvidencePages(candidates, undefined, { ...options, cache }),
      retrieveEvidencePages(candidates, undefined, { ...options, cache }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(a).toEqual(b);
  });
});

describe("prefetch removes page retrieval from the critical path", () => {
  it("overlaps the fetch with generation instead of following it", async () => {
    const PAGE_MS = 60;
    const GENERATION_MS = 80;
    const slowFetch = async (input: string | URL) => {
      await new Promise((resolve) => setTimeout(resolve, PAGE_MS));
      return new Response(`<html><body>Evidence from ${String(input)}</body></html>`, {
        status: 200, headers: { "content-type": "text/html" },
      });
    };
    const options = { fetch: vi.fn(slowFetch), resolveHost: publicResolver };
    const generate = () => new Promise((resolve) => setTimeout(resolve, GENERATION_MS));

    // Today's shape without a cache: generate, then fetch.
    const serialStart = Date.now();
    await generate();
    await retrieveEvidencePages(candidates, undefined, options);
    const serialMs = Date.now() - serialStart;

    // With the prefetch: the fetch runs while the model writes.
    const cache = createEvidencePageCache();
    const overlappedStart = Date.now();
    prefetchEvidencePages(candidates, undefined, cache, options);
    await generate();
    await retrieveEvidencePages(candidates, undefined, { ...options, cache });
    const overlappedMs = Date.now() - overlappedStart;

    // Serial pays generation *plus* the page fetch; overlapped pays the longer
    // of the two. The margin is deliberately loose -- this asserts the stages
    // overlap at all, not a precise timing.
    expect(serialMs).toBeGreaterThan(GENERATION_MS + PAGE_MS - 25);
    expect(overlappedMs).toBeLessThan(serialMs - 25);
  });
});
