import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  asPointInTimeValidityRows,
  clubHistoryDateCoverage,
  clubSlugFromClubEloApiUrl,
  eloOnUtcDateFromClubHistory,
  eloOnUtcDateFromValidityRows,
  isClubEloClubHistoryUrl,
  looksLikeClubEloClubHistoryCsv,
  parseClubEloClubHistoryCsv,
  parseClubEloValidityCsv,
} from "./clubelo-club-history";
import { looksLikeClubEloRankingCsv } from "./clubelo-wayback";

const VILLA_HISTORY = [
  "Rank,Club,Country,Level,Elo,From,To",
  "None,Aston Villa,ENG,1,1551.14,1946-07-07,1946-08-31",
  "90,Aston Villa,ENG,1,1610.53,2019-09-23,2019-09-28",
  "90,Aston Villa,ENG,1,1610.53,2019-09-29,2019-09-30",
  "90,Aston Villa,ENG,1,1610.53,2019-10-01,2019-12-31",
  "91,Aston Villa,ENG,1,1600.00,2018-01-01,2018-06-30",
  "92,Aston Villa,ENG,1,1590.00,2018-07-01,2018-12-31",
  "93,Aston Villa,ENG,1,1580.00,2017-01-01,2017-06-30",
  "94,Aston Villa,ENG,1,1570.00,2017-07-01,2017-12-31",
  "95,Aston Villa,ENG,1,1560.00,2016-01-01,2016-06-30",
  "96,Aston Villa,ENG,1,1555.00,2016-07-01,2016-12-31",
].join("\n");

const RANKING_SNAPSHOT = [
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

describe("offline ClubElo per-club history", () => {
  it("accepts only api.clubelo.com club slugs, not dated or placeholder paths", () => {
    expect(clubSlugFromClubEloApiUrl("http://api.clubelo.com/Arsenal")).toBe("Arsenal");
    expect(clubSlugFromClubEloApiUrl("http://api.clubelo.com:80/astonvilla")).toBe("astonvilla");
    expect(clubSlugFromClubEloApiUrl("https://api.clubelo.com/Liverpool")).toBe("Liverpool");
    expect(isClubEloClubHistoryUrl("http://api.clubelo.com/2024-08-15")).toBe(false);
    expect(isClubEloClubHistoryUrl("http://api.clubelo.com/YYYY-MM-DD")).toBe(false);
    expect(isClubEloClubHistoryUrl("http://api.clubelo.com/CLUBNAME")).toBe(false);
    expect(isClubEloClubHistoryUrl("http://api.clubelo.com/Fixtures")).toBe(false);
    expect(isClubEloClubHistoryUrl("https://clubelo.com/Arsenal")).toBe(false);
    expect(isClubEloClubHistoryUrl("http://api.clubelo.com/")).toBe(false);
  });

  it("treats a single-club From/To series as club history, not a dated ranking", () => {
    expect(looksLikeClubEloClubHistoryCsv(VILLA_HISTORY)).toBe(true);
    expect(looksLikeClubEloRankingCsv(VILLA_HISTORY)).toBe(false);
    expect(looksLikeClubEloClubHistoryCsv(RANKING_SNAPSHOT)).toBe(false);
    expect(looksLikeClubEloRankingCsv(RANKING_SNAPSHOT)).toBe(true);
    expect(looksLikeClubEloClubHistoryCsv("Rank,Club,Country,Level,Elo,From,To\n")).toBe(false);
    expect(looksLikeClubEloClubHistoryCsv("<html>ClubElo</html>")).toBe(false);
  });

  it("looks up ClubElo's own window for the UTC day before kickoff and fails closed on gaps", () => {
    const rows = parseClubEloClubHistoryCsv(VILLA_HISTORY);
    expect(eloOnUtcDateFromClubHistory(rows, "2019-10-15")).toBe(1610.53);
    expect(eloOnUtcDateFromClubHistory(rows, "2019-12-31")).toBe(1610.53);
    expect(eloOnUtcDateFromClubHistory(rows, "2024-08-15")).toBeNull();
    expect(eloOnUtcDateFromClubHistory(rows, "2019-09-22")).toBeNull();
    const coverage = clubHistoryDateCoverage(rows, ["2019-10-01", "2024-08-15", "2025-01-01"]);
    expect(coverage.covered).toEqual(["2019-10-01"]);
    expect(coverage.missing).toEqual(["2024-08-15", "2025-01-01"]);
  });

  it("fails closed on overlapping From/To windows instead of inventing Elo", () => {
    const overlapping = parseClubEloClubHistoryCsv([
      "Rank,Club,Country,Level,Elo,From,To",
      ...Array.from({ length: 10 }, (_, index) => (
        `1,Arsenal,ENG,1,${1800 + index},2010-01-01,2010-06-30`
      )),
      "1,Arsenal,ENG,1,1900,2010-06-01,2010-12-31",
    ].join("\n"));
    expect(eloOnUtcDateFromClubHistory(overlapping, "2010-06-15")).toBeNull();
  });

  it("accepts a scrape gap inside an open From/To window and rejects past To", () => {
    const rows = parseClubEloValidityCsv([
      "Rank,Club,Country,Level,Elo,From,To,date,updated_at",
      "1,Arsenal,ENG,1,1975.82,2024-12-15,2024-12-21,2024-12-19,2024-12-19 12:00:00",
    ].join("\n"));
    expect(eloOnUtcDateFromValidityRows(rows, "2024-12-20")?.elo).toBe(1975.82);
    expect(eloOnUtcDateFromValidityRows(rows, "2024-12-21")?.elo).toBe(1975.82);
    expect(eloOnUtcDateFromValidityRows(rows, "2024-12-22")).toBeNull();
    expect(eloOnUtcDateFromValidityRows(rows, "2024-12-14")).toBeNull();
  });

  it("rejects a later snapshot that overlaps an earlier policy date (look-ahead)", () => {
    const rows = parseClubEloValidityCsv([
      "Rank,Club,Country,Level,Elo,From,To,date",
      "90,Hull,ENG,2,1532.88,2024-08-10,2024-08-24,2024-08-15",
      "80,Hull,ENG,2,1633.12,2024-08-16,2024-08-31,2024-08-25",
      "1,Hull,ENG,2,1633.40,2026-08-01,2026-08-12,2026-08-12",
    ].join("\n"));
    expect(eloOnUtcDateFromValidityRows(rows, "2024-08-23")?.elo).toBe(1532.88);
    expect(eloOnUtcDateFromValidityRows(rows, "2024-08-16")?.elo).toBe(1532.88);
    expect(eloOnUtcDateFromValidityRows(rows, "2024-08-15")?.elo).toBe(1532.88);
    expect(eloOnUtcDateFromValidityRows(rows, "2026-08-12")?.elo).toBe(1633.40);
  });

  it("does not interpolate Elo across a From/To hole", () => {
    const rows = parseClubEloValidityCsv([
      "Rank,Club,Country,Level,Elo,From,To,date",
      "1,Arsenal,ENG,1,1975.82,2024-12-15,2024-12-21,2024-12-19",
      "1,Arsenal,ENG,1,1985.78,2025-01-05,2025-01-15,2025-01-10",
    ].join("\n"));
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-03")).toBeNull();
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-04")).toBeNull();
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-05")?.elo).toBe(1985.78);
  });

  it("treats Wayback dated rankings as that calendar date only", () => {
    const rows = asPointInTimeValidityRows("2025-01-23", [
      { club: "Arsenal", country: "ENG", elo: 1980 },
    ]);
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-23")?.elo).toBe(1980);
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-22")).toBeNull();
    expect(eloOnUtcDateFromValidityRows(rows, "2025-01-24")).toBeNull();
  });

  it("keeps runtime model modules from importing the club-history path", () => {
    const runtimeFiles = [
      "model-data.ts",
      "club-ratings.ts",
      "club-strength-artifact.ts",
      "model-contributors.ts",
      "ask.ts",
    ];
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/clubelo-club-history/);
      expect(source).not.toMatch(/api\.clubelo\.com\/Arsenal/);
    }
  });
});
