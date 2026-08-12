import { describe, expect, it, vi } from "vitest";
import {
  EvidencePageCandidate,
  isPrivateOrReservedAddress,
  retrieveEvidencePages,
} from "./evidence-page-retrieval";

const candidates: EvidencePageCandidate[] = [
  { id: "S3", url: "https://blog.example/three", title: "Other", date: "2026-08-13", authority: "other" },
  { id: "S1", url: "https://club.example/one", title: "Official", date: "2026-08-13", authority: "official" },
  { id: "S2", url: "https://news.example/two", title: "Reputable", date: "2026-08-13", authority: "reputable" },
  { id: "S4", url: "https://other.example/four", title: "Fourth", date: "2026-08-13", authority: "other" },
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
    expect(pages.map((page) => page.id)).toEqual(["S1", "S2", "S3"]);
    expect(pages[0].text).not.toContain("ignore me");
    expect(pages[0].retrievedAt).toBe("2026-08-13T12:00:00.000Z");
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
    const pages = await retrieveEvidencePages(candidates.slice(0, 1), undefined, { fetch, resolveHost });
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
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch, resolveHost: privateResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks cross-host redirects so retrieved content keeps the cited source identity", async () => {
    const fetch = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "https://different.example/story" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch, resolveHost: publicResolver,
    })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and non-text responses", async () => {
    const tooLarge = vi.fn(async () => new Response("x".repeat(20), {
      status: 200, headers: { "content-type": "text/plain", "content-length": "20" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch: tooLarge, resolveHost: publicResolver, maxResponseBytes: 10,
    })).toEqual([]);
    const json = vi.fn(async () => new Response("{}", {
      status: 200, headers: { "content-type": "application/json" },
    }));
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch: json, resolveHost: publicResolver,
    })).toEqual([]);
  });

  it("propagates the request abort instead of degrading it", async () => {
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    await expect(retrieveEvidencePages(candidates.slice(0, 1), controller.signal, {
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
    expect(await retrieveEvidencePages(candidates.slice(0, 1), undefined, {
      fetch: vi.fn(),
      resolveHost,
      timeoutMs: 5,
    })).toEqual([]);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(true);
  });
});
