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

function trackedResponse(
  body: string,
  init: ResponseInit = {},
  close = true,
): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (body) controller.enqueue(new TextEncoder().encode(body));
      if (close) controller.close();
    },
    cancel,
  });
  return {
    response: new Response(stream, {
      ...init,
      headers: { "content-type": "text/plain", ...init.headers },
    }),
    cancel,
  };
}

function failedResponse(error: Error): Response {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(error);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

describe("evidence page retrieval", () => {
  it("recognizes private, loopback, link-local and reserved addresses", () => {
    expect(isPrivateOrReservedAddress("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedAddress("10.2.3.4")).toBe(true);
    expect(isPrivateOrReservedAddress("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedAddress("::1")).toBe(true);
    expect(isPrivateOrReservedAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isPrivateOrReservedAddress("::")).toBe(true);
    expect(isPrivateOrReservedAddress("0:0:0:0:0:0:0:0")).toBe(true);
    expect(isPrivateOrReservedAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateOrReservedAddress("0:0:0:0:0:ffff:7f00:1")).toBe(true);
    expect(isPrivateOrReservedAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateOrReservedAddress("fc00::1")).toBe(true);
    expect(isPrivateOrReservedAddress("93.184.216.34")).toBe(false);
    expect(isPrivateOrReservedAddress("2001:4860:4860::8888")).toBe(false);
    expect(isPrivateOrReservedAddress("::ffff:808:808")).toBe(false);
    expect(isPrivateOrReservedAddress("0:0:0:0:0:ffff:808:808")).toBe(false);
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
    const redirect = trackedResponse("private redirect body", {
      status: 302, headers: { location: "http://private.example/admin" },
    });
    const fetch = vi.fn().mockResolvedValue(redirect.response);
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch, resolveHost: privateResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(redirect.cancel).toHaveBeenCalledTimes(1);
    expect(redirect.response.body?.locked).toBe(false);
  });

  it("blocks cross-host redirects so retrieved content keeps the cited source identity", async () => {
    const redirect = trackedResponse("cross-host redirect body", {
      status: 302, headers: { location: "https://different.example/story" },
    });
    const fetch = vi.fn().mockResolvedValue(redirect.response);
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch, resolveHost: publicResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(redirect.cancel).toHaveBeenCalledTimes(1);
    expect(redirect.response.body?.locked).toBe(false);
  });

  it.each(["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:a9fe:a9fe"])(
    "blocks mapped private DNS address %s before fetching",
    async (address) => {
      const fetch = vi.fn();
      const resolveHost = vi.fn(async () => [{ address, family: 6 }]);
      expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
        fetch, resolveHost,
      })).toEqual([]);
      expect(resolveHost).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(["::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1"])(
    "rejects private IPv6 URL literal %s without DNS or fetch",
    async (address) => {
      const fetch = vi.fn();
      const resolveHost = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
      expect(await retrieveEvidencePages([{
        ...candidates[1], url: `http://[${address}]/evidence`,
      }], undefined, { fetch, resolveHost })).toEqual([]);
      expect(resolveHost).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("pins public IPv6 URL literals without a DNS lookup", async () => {
    const address = "2001:4860:4860::8888";
    const fetch = vi.fn(async () => new Response("Public evidence", {
      status: 200, headers: { "content-type": "text/plain" },
    }));
    const resolveHost = vi.fn();
    const pages = await retrieveEvidencePages([{
      ...candidates[1], url: `http://[${address}]/evidence`,
    }], undefined, { fetch, resolveHost });
    expect(pages).toHaveLength(1);
    expect(resolveHost).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL), expect.any(Object), { address, family: 6 }
    );
  });

  it("rejects oversized and non-text responses", async () => {
    const tooLarge = vi.fn(async () => new Response("x".repeat(20), {
      status: 200, headers: { "content-type": "text/plain", "content-length": "20" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: tooLarge, resolveHost: publicResolver, maxResponseBytes: 10,
    })).toEqual([]);
    const json = trackedResponse("{}", {
      status: 200, headers: { "content-type": "application/json" },
    });
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(json.response), resolveHost: publicResolver,
    })).toEqual([]);
    expect(json.cancel).toHaveBeenCalledTimes(1);
    expect(json.response.body?.locked).toBe(false);
  });

  it("cancels unused redirect and error response bodies", async () => {
    const redirect = trackedResponse("redirect body", {
      status: 302,
      headers: { location: "https://club.example/final" },
    });
    const final = trackedResponse("final body", { status: 200 });
    const fetch = vi.fn()
      .mockResolvedValueOnce(redirect.response)
      .mockResolvedValueOnce(final.response);

    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch, resolveHost: publicResolver,
    })).toHaveLength(1);
    expect(redirect.cancel).toHaveBeenCalledTimes(1);
    expect(redirect.response.body?.locked).toBe(false);
    expect(final.response.body?.locked).toBe(false);

    const error = trackedResponse("error body", { status: 503 });
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(error.response),
      resolveHost: publicResolver,
    })).toEqual([]);
    expect(error.cancel).toHaveBeenCalledTimes(1);
    expect(error.response.body?.locked).toBe(false);

    const missingLocation = trackedResponse("missing location body", { status: 302 });
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(missingLocation.response),
      resolveHost: publicResolver,
    })).toEqual([]);
    expect(missingLocation.cancel).toHaveBeenCalledTimes(1);
    expect(missingLocation.response.body?.locked).toBe(false);
  });

  it("releases bounded readers after success, read failure, and overlimit", async () => {
    const success = trackedResponse("readable body");
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(success.response),
      resolveHost: publicResolver,
    })).toHaveLength(1);
    expect(success.response.body?.locked).toBe(false);

    const failure = failedResponse(new Error("stream failed"));
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(failure),
      resolveHost: publicResolver,
    })).toEqual([]);
    expect(failure.body?.locked).toBe(false);

    const overlimit = trackedResponse("0123456789", {}, false);
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(overlimit.response),
      resolveHost: publicResolver,
      maxResponseBytes: 5,
    })).toEqual([]);
    expect(overlimit.cancel).toHaveBeenCalledTimes(1);
    expect(overlimit.response.body?.locked).toBe(false);

    const declaredOverlimit = trackedResponse("declared body", {
      status: 200,
      headers: { "content-length": "100" },
    });
    expect(await retrieveEvidencePages(candidates.slice(1, 2), undefined, {
      fetch: vi.fn().mockResolvedValue(declaredOverlimit.response),
      resolveHost: publicResolver,
      maxResponseBytes: 5,
    })).toEqual([]);
    expect(declaredOverlimit.cancel).toHaveBeenCalledTimes(1);
    expect(declaredOverlimit.response.body?.locked).toBe(false);
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

  it("evicts a failed prefetch so verification can retry the URL", async () => {
    let attempt = 0;
    const fetch = vi.fn(async (input: string | URL) => {
      attempt += 1;
      if (attempt <= 3) throw new Error("upstream refused the prefetch");
      return html(input);
    });
    const cache = createEvidencePageCache();
    const options = { fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z") };

    prefetchEvidencePages(candidates, undefined, cache, options);
    await vi.waitFor(() => expect(cache.size).toBe(0));

    const pages = await retrieveEvidencePages(candidates, undefined, { ...options, cache });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(pages.map((page) => page.id)).toEqual(["S1", "S2", "S4"]);
  });

  it("evicts an aborted prefetch so a live retrieval can retry", async () => {
    const controller = new AbortController();
    let attempt = 0;
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      return html(input);
    });
    const cache = createEvidencePageCache();
    const options = { fetch, resolveHost: publicResolver, now: () => new Date("2026-08-13T12:00:00Z") };

    prefetchEvidencePages([candidates[1]], controller.signal, cache, options);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error("prefetch canceled"));
    await vi.waitFor(() => expect(cache.size).toBe(0));

    const pages = await retrieveEvidencePages([candidates[1]], undefined, { ...options, cache });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pages.map((page) => page.id)).toEqual(["S1"]);
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
