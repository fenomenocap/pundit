import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLUB_RATINGS_COLD_RETRY_MS,
  CLUB_RATINGS_REFRESH_INTERVAL_MS,
  CLUB_RATING_FALLBACK_MAX_AGE_DAYS,
  backfillMissingClubRatings,
  clubEloClubPath,
  clubRatingsRefreshDelay,
  fetchClubRatings,
  getCachedClubRatings,
  lookupClubRating,
  parseClubEloCsv,
  parseLatestClubEloRating,
  refreshClubRatings,
} from "./club-ratings";

function ratingsCsv(count = 10): string {
  const rows = Array.from({ length: count }, (_, index) =>
    `${index + 1},Club ${index + 1},${index < 5 ? "ENG" : "ESP"},1,${1800 - index},2026-07-01,2026-07-26`
  );
  return ["Rank,Club,Country,Level,Elo,From,To", ...rows].join("\n");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("club ratings", () => {
  it("parses ClubElo CSV rows", () => {
    const rows = parseClubEloCsv(`Rank,Club,Country,Level,Elo,From,To
1,Arsenal,ENG,1,1850.2,2026-07-01,2026-07-26
2,Paris SG,FRA,1,1840.1,2026-07-01,2026-07-26`);
    expect(rows).toEqual([
      { club: "Arsenal", country: "ENG", elo: 1850.2 },
      { club: "Paris SG", country: "FRA", elo: 1840.1 },
    ]);
  });

  it("looks up ratings by profile and canonical club name", () => {
    const ratings = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([["Arsenal", 1850]]),
      "uefa-clubs": new Map([["Arsenal", 1850], ["Paris SG", 1840]]),
    };
    expect(lookupClubRating("Arsenal", "eng-clubs", ratings)).toBe(1850);
    expect(lookupClubRating("Manchester United", "eng-clubs", ratings)).toBeUndefined();
    expect(lookupClubRating("Paris Saint-Germain", "uefa-clubs", ratings)).toBe(1840);
  });

  it("fails fast after one host/network error instead of retrying every date", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchClubRatings(new Date("2026-07-28T00:00:00.000Z")))
      .rejects.toThrow("network unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses earlier dates only for a reachable 404 date miss", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => ratingsCsv(),
      });
    vi.stubGlobal("fetch", fetchMock);

    const ratings = await fetchClubRatings(new Date("2026-07-28T00:00:00.000Z"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ratings["uefa-clubs"]).toHaveLength(10);
  });

  it("retains last-good ratings when a later refresh fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    });
    vi.stubGlobal("fetch", fetchMock);
    await refreshClubRatings();
    const lastGood = getCachedClubRatings();

    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
    await refreshClubRatings();
    const afterFailure = getCachedClubRatings();

    expect(afterFailure.fetchedAt).toEqual(lastGood.fetchedAt);
    expect(afterFailure.byProfile["uefa-clubs"]).toEqual(lastGood.byProfile["uefa-clubs"]);
    expect(afterFailure.error).toBe("network unavailable");
  });

  it("addresses a club's own feed by canonical name minus spaces", () => {
    expect(clubEloClubPath("Bodoe Glimt")).toBe("BodoeGlimt");
    expect(clubEloClubPath("St Gillis")).toBe("StGillis");
    expect(clubEloClubPath("Arsenal")).toBe("Arsenal");
  });

  it("takes the last published rating from a per-club feed", () => {
    expect(parseLatestClubEloRating(`Rank,Club,Country,Level,Elo,From,To
100,Olympiakos,GRE,1,1650.5,2026-05-01,2026-05-23
69,Olympiakos,GRE,1,1663.37,2026-05-24,2026-07-03`)).toEqual({
      elo: 1663.37,
      asOf: "2026-07-03",
    });
    expect(parseLatestClubEloRating("Rank,Club,Country,Level,Elo,From,To")).toBeNull();
  });

  it("prices a club whose rating window has lapsed from its own feed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    }));
    await refreshClubRatings();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `Rank,Club,Country,Level,Elo,From,To
69,Olympiakos,GRE,1,1663.37,2026-05-24,2026-07-03`,
    }));
    const unresolved = await backfillMissingClubRatings(
      [{ team: "Olympiacos", profile: "uefa-clubs" }],
      new Date("2026-07-31T00:00:00Z")
    );

    expect(unresolved).toEqual([]);
    const cached = getCachedClubRatings();
    expect(lookupClubRating("Olympiacos", "uefa-clubs", cached.byProfile)).toBeCloseTo(1663.37);
    expect(cached.staleRatings).toEqual([
      { club: "Olympiakos", elo: 1663.37, asOf: "2026-07-03", ageDays: 28 },
    ]);
  });

  it("leaves a club missing when its last rating is too old to price a match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    }));
    await refreshClubRatings();

    const staleDate = new Date("2026-07-31T00:00:00Z");
    staleDate.setUTCDate(staleDate.getUTCDate() - (CLUB_RATING_FALLBACK_MAX_AGE_DAYS + 30));
    const asOf = staleDate.toISOString().slice(0, 10);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `Rank,Club,Country,Level,Elo,From,To
400,Long Gone,GRE,2,1200.0,2025-01-01,${asOf}`,
    }));
    const unresolved = await backfillMissingClubRatings(
      [{ team: "Long Gone", profile: "uefa-clubs" }],
      new Date("2026-07-31T00:00:00Z")
    );

    expect(unresolved).toEqual(["Long Gone"]);
    const cached = getCachedClubRatings();
    expect(lookupClubRating("Long Gone", "uefa-clubs", cached.byProfile)).toBeUndefined();
    expect(cached.staleRatings).toEqual([]);
  });

  it("reports a club unresolved when its own feed fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    }));
    await refreshClubRatings();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    await expect(backfillMissingClubRatings(
      [{ team: "Unreachable FC", profile: "uefa-clubs" }],
      new Date("2026-07-31T00:00:00Z")
    )).resolves.toEqual(["Unreachable FC"]);
  });

  it("drops stale fallbacks once a fresh snapshot names the club again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    }));
    await refreshClubRatings();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `Rank,Club,Country,Level,Elo,From,To
69,Olympiakos,GRE,1,1663.37,2026-05-24,2026-07-03`,
    }));
    await backfillMissingClubRatings(
      [{ team: "Olympiacos", profile: "uefa-clubs" }],
      new Date("2026-07-31T00:00:00Z")
    );
    expect(getCachedClubRatings().staleRatings).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ratingsCsv(),
    }));
    await refreshClubRatings();
    expect(getCachedClubRatings().staleRatings).toEqual([]);
  });

  it("retries a cold failure sooner and keeps successful refreshes hourly", () => {
    const emptyProfiles = {
      world: new Map(),
      "eng-clubs": new Map(),
      "uefa-clubs": new Map(),
    };
    expect(clubRatingsRefreshDelay({
      byProfile: emptyProfiles,
      fetchedAt: null,
      error: "network unavailable",
      staleRatings: [],
    })).toBe(CLUB_RATINGS_COLD_RETRY_MS);
    expect(clubRatingsRefreshDelay({
      byProfile: emptyProfiles,
      fetchedAt: new Date(),
      error: "last refresh failed",
      staleRatings: [],
    })).toBe(CLUB_RATINGS_REFRESH_INTERVAL_MS);
  });
});
