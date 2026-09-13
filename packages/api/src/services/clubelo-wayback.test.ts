import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clubEloDatedCsvUrls,
  datedCsvInventoryFromCdxRows,
  fetchClubEloDatedCsv,
  isClubEloDatedCsvUrl,
  listWaybackDatedCsvInventory,
  looksLikeClubEloRankingCsv,
  parseWaybackCdxPayload,
  rankingDateFromClubEloApiUrl,
  selectLatestWaybackCsvCapture,
  waybackHostCsvCdxUrl,
  waybackIdentityUrl,
  type WaybackCdxRow,
} from "./clubelo-wayback";

const SAMPLE_CSV = [
  "Rank,Club,Country,Level,Elo,From,To",
  "1,Man United,ENG,1,1915.316,2024-08-16,2024-08-17",
  "2,Bayern,GER,1,2001.5,2024-08-16,2024-08-17",
  "3,Arsenal,ENG,1,1950.1,2024-08-16,2024-08-17",
  "4,Liverpool,ENG,1,1918.2,2024-08-16,2024-08-17",
  "5,Man City,ENG,1,2060.1,2024-08-16,2024-08-17",
  "6,Inter,ITA,1,1966.3,2024-08-16,2024-08-17",
  "7,Real Madrid,ESP,1,1987.5,2024-08-16,2024-08-17",
  "8,Hull,ENG,1,1532.88,2024-08-16,2024-08-17",
  "9,Chelsea,ENG,1,1850.0,2024-08-16,2024-08-17",
  "10,Tottenham,ENG,1,1840.0,2024-08-16,2024-08-17",
].join("\n");

function csvResponse(text: string, status = 200): Response {
  const raw = Buffer.from(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/csv" }),
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    text: async () => text,
  } as Response;
}

function htmlResponse(html: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    arrayBuffer: async () => {
      const raw = Buffer.from(html);
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    },
    text: async () => html,
  } as Response;
}

const CDX_JSON = JSON.stringify([
  ["timestamp", "original", "statuscode", "mimetype", "length"],
  ["20240919031757", "http://api.clubelo.com/2024-09-02", "200", "text/csv", "11659"],
  ["20240918010101", "http://api.clubelo.com/2024-09-02", "200", "text/csv", "11650"],
  ["20250131093320", "http://api.clubelo.com/2025-01-23", "200", "text/csv", "11066"],
  ["20250421072429", "http://api.clubelo.com/realmadrid", "200", "text/csv", "64548"],
  ["20240628083423", "http://api.clubelo.com/YYYY-MM-DD", "200", "text/csv", "300"],
  ["20181207060655", "http://api.clubelo.com/", "403", "text/html", "832"],
]);

describe("Wayback ClubElo dated CSV fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("accepts only api.clubelo.com/YYYY-MM-DD URLs for that calendar date", () => {
    expect(clubEloDatedCsvUrls("2024-08-15")).toEqual([
      "http://api.clubelo.com/2024-08-15",
      "https://api.clubelo.com/2024-08-15",
    ]);
    expect(isClubEloDatedCsvUrl("http://api.clubelo.com/2024-08-15", "2024-08-15")).toBe(true);
    expect(isClubEloDatedCsvUrl("https://api.clubelo.com/2024-08-15", "2024-08-15")).toBe(true);
    expect(isClubEloDatedCsvUrl("http://api.clubelo.com:80/2024-08-15", "2024-08-15")).toBe(true);
    expect(isClubEloDatedCsvUrl("http://api.clubelo.com/2024-08-16", "2024-08-15")).toBe(false);
    expect(isClubEloDatedCsvUrl("https://clubelo.com/", "2024-08-15")).toBe(false);
    expect(isClubEloDatedCsvUrl("https://clubelo.com/2024-08-15", "2024-08-15")).toBe(false);
    expect(isClubEloDatedCsvUrl("https://clubelo.com/Ranking", "2024-08-15")).toBe(false);
    expect(isClubEloDatedCsvUrl("http://api.clubelo.com/realmadrid", "2024-08-15")).toBe(false);
    expect(isClubEloDatedCsvUrl("http://api.clubelo.com/YYYY-MM-DD", "2024-08-15")).toBe(false);
    expect(rankingDateFromClubEloApiUrl("http://api.clubelo.com/YYYY-MM-DD")).toBeNull();
  });

  it("selects the latest 200 text/csv capture for that ranking date only", () => {
    const rows = parseWaybackCdxPayload(CDX_JSON);
    expect(selectLatestWaybackCsvCapture(rows, "2024-09-02")).toEqual({
      timestamp: "20240919031757",
      original: "http://api.clubelo.com/2024-09-02",
      statusCode: "200",
      mimeType: "text/csv",
      length: "11659",
    });
    expect(selectLatestWaybackCsvCapture(rows, "2024-08-15")).toBeNull();
    expect(selectLatestWaybackCsvCapture(rows, "2025-01-23")?.original)
      .toBe("http://api.clubelo.com/2025-01-23");
    const inventory = datedCsvInventoryFromCdxRows(rows);
    expect([...inventory.keys()].sort()).toEqual(["2024-09-02", "2025-01-23"]);
    expect(inventory.has("YYYY-MM-DD")).toBe(false);
    expect(waybackIdentityUrl(inventory.get("2024-09-02")!))
      .toBe("https://web.archive.org/web/20240919031757id_/http://api.clubelo.com/2024-09-02");
  });

  it("rejects homepage HTML and club time-series bodies as ranking CSVs", () => {
    expect(looksLikeClubEloRankingCsv(SAMPLE_CSV)).toBe(true);
    expect(looksLikeClubEloRankingCsv("<html><body>ClubElo ranking</body></html>")).toBe(false);
    expect(looksLikeClubEloRankingCsv("From,To,Elo\n2010-01-01,2010-01-02,1850.0")).toBe(false);
    expect(looksLikeClubEloRankingCsv("Rank,Club,Country,Level,Elo,From,To\n1,Man United,ENG,1,1915,2024-08-16,2024-08-17"))
      .toBe(false);
    const singleClubSeries = [
      "Rank,Club,Country,Level,Elo,From,To",
      ...Array.from({ length: 12 }, (_, index) => (
        `90,Aston Villa,ENG,1,1610.5,2019-0${(index % 9) + 1}-01,2019-0${(index % 9) + 1}-28`
      )),
    ].join("\n");
    expect(looksLikeClubEloRankingCsv(singleClubSeries)).toBe(false);
  });

  it("treats Wayback CDX HTML outages as unavailable rather than an empty archive", () => {
    expect(() => parseWaybackCdxPayload("<html>Temporarily Offline</html>"))
      .toThrow("wayback-cdx-unavailable");
    expect(parseWaybackCdxPayload("[]")).toEqual([]);
  });

  it("prefers the live dated API over Wayback", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).startsWith("http://api.clubelo.com/2024-09-02")) {
        return csvResponse(SAMPLE_CSV);
      }
      throw new Error(`unexpected ${url}`);
    });
    const result = await fetchClubEloDatedCsv({ rankingDate: "2024-09-02", fetchImpl });
    expect(result.captureSource).toBe("clubelo-live-api");
    expect(result.sourceUrl).toBe("http://api.clubelo.com/2024-09-02");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to Wayback for that calendar date after live 502", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("api.clubelo.com/2024-09-02") && !href.includes("web.archive.org")) {
        return csvResponse("502 bad gateway", 502);
      }
      if (href.startsWith("https://web.archive.org/cdx/")) {
        return csvResponse(CDX_JSON);
      }
      if (href.includes("web/20240919031757id_/http://api.clubelo.com/2024-09-02")) {
        return csvResponse(SAMPLE_CSV);
      }
      throw new Error(`unexpected ${url}`);
    });
    const result = await fetchClubEloDatedCsv({ rankingDate: "2024-09-02", fetchImpl });
    expect(result.captureSource).toBe("internet-archive-wayback");
    expect(result.waybackTimestamp).toBe("20240919031757");
    expect(result.originalUrl).toBe("http://api.clubelo.com/2024-09-02");
    expect(result.sourceUrl).toContain("web.archive.org/web/20240919031757id_/");
  });

  it("does not use a Wayback capture for a different ranking date", async () => {
    const inventory = datedCsvInventoryFromCdxRows(parseWaybackCdxPayload(CDX_JSON));
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("api.clubelo.com/2024-08-15") && !href.includes("web.archive.org")) {
        return csvResponse("502", 502);
      }
      if (href.includes("web.archive.org/web/")) {
        return csvResponse(SAMPLE_CSV);
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(fetchClubEloDatedCsv({
      rankingDate: "2024-08-15",
      fetchImpl,
      inventory,
      skipLive: false,
    })).rejects.toThrow("wayback-missing:2024-08-15");
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("web.archive.org/web/"))).toBe(false);
  });

  it("rejects Wayback HTML even when the identity URL returns 200", async () => {
    const row: WaybackCdxRow = {
      timestamp: "20240919031757",
      original: "http://api.clubelo.com/2024-09-02",
      statusCode: "200",
      mimeType: "text/csv",
      length: "11659",
    };
    const fetchImpl = vi.fn(async () => htmlResponse("<html><h1>ClubElo</h1></html>"));
    await expect(fetchClubEloDatedCsv({
      rankingDate: "2024-09-02",
      fetchImpl,
      inventory: new Map([["2024-09-02", row]]),
      skipLive: true,
    })).rejects.toThrow("wayback-invalid-body");
  });

  it("lists only dated ranking CSVs from a host CDX inventory", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(waybackHostCsvCdxUrl());
      return csvResponse(CDX_JSON);
    });
    const inventory = await listWaybackDatedCsvInventory(fetchImpl, 5_000);
    expect(inventory.status).toBe("ok");
    expect([...inventory.captures.keys()].sort()).toEqual(["2024-09-02", "2025-01-23"]);
  });

  it("keeps runtime model modules from importing Wayback or ClubElo capture", () => {
    const runtimeFiles = [
      "model-data.ts",
      "club-ratings.ts",
      "club-strength-artifact.ts",
      "model-contributors.ts",
      "ask.ts",
    ];
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/capture-clubelo/);
      expect(source).not.toMatch(/clubelo-wayback/);
      expect(source).not.toMatch(/web\.archive\.org/);
      expect(source).not.toMatch(/clubelo-pre-kickoff-corpus/);
    }
  });
});
