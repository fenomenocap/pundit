import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLUB_RATINGS_COLD_RETRY_MS,
  CLUB_RATINGS_REFRESH_INTERVAL_MS,
  clubRatingsRefreshDelay,
  fetchClubRatings,
  getCachedClubRatings,
  lookupClubRating,
  parseClubEloCsv,
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
    })).toBe(CLUB_RATINGS_COLD_RETRY_MS);
    expect(clubRatingsRefreshDelay({
      byProfile: emptyProfiles,
      fetchedAt: new Date(),
      error: "last refresh failed",
    })).toBe(CLUB_RATINGS_REFRESH_INTERVAL_MS);
  });
});
