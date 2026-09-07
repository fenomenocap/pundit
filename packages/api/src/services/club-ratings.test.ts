import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  backfillMissingClubRatings,
  clubRatingsAgeDays,
  clubRatingsAreCurrent,
  clubRatingsRefreshDelay,
  CLUB_RATINGS_COLD_RETRY_MS,
  CLUB_RATINGS_REFRESH_INTERVAL_MS,
  getCachedClubRatings,
  lookupClubRating,
  refreshClubRatings,
} from "./club-ratings";
import { CLUB_STRENGTH_MAX_AGE_MS } from "./club-strength-artifact";

const originalDataDir = process.env.PUNDIT_DATA_DIR;
let scratchDataDir: string;

beforeEach(() => {
  scratchDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-club-ratings-"));
  process.env.PUNDIT_DATA_DIR = scratchDataDir;
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(scratchDataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
});

describe("club ratings artifact adapter", () => {
  it("loads the pinned champion artifact without network access", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("runtime network access is forbidden");
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshClubRatings();

    const ratings = getCachedClubRatings();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ratings.artifactId).toMatch(/^clubelo@1:[a-f0-9]{64}$/);
    expect(ratings.byProfile["uefa-clubs"].size).toBeGreaterThanOrEqual(100);
    expect(ratings.byProfile["eng-clubs"].size).toBeGreaterThanOrEqual(20);
    expect(ratings.servingPersisted).toBe(false);
  });

  it("resolves qualifier aliases against the pinned snapshot without inventing ratings", async () => {
    await refreshClubRatings();
    const ratings = getCachedClubRatings().byProfile;
    expect(lookupClubRating("Arsenal", "eng-clubs", ratings)).toEqual(expect.any(Number));
    expect(lookupClubRating("Absent FC", "uefa-clubs", ratings)).toBeUndefined();
  });

  it("does not invent or network-fetch a missing strength", async () => {
    await refreshClubRatings();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(backfillMissingClubRatings([
      { team: "Absent FC", profile: "uefa-clubs" },
    ])).resolves.toEqual(["Absent FC"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps legacy retry-delay semantics for model scheduling", () => {
    const base = {
      byProfile: { world: new Map(), "eng-clubs": new Map(), "uefa-clubs": new Map() },
      staleRatings: [],
      servingPersisted: false,
      artifactId: null,
      artifactSha256: null,
    };
    expect(clubRatingsRefreshDelay({ ...base, fetchedAt: null, error: "invalid artifact" }))
      .toBe(CLUB_RATINGS_COLD_RETRY_MS);
    expect(clubRatingsRefreshDelay({ ...base, fetchedAt: new Date(), error: null }))
      .toBe(CLUB_RATINGS_REFRESH_INTERVAL_MS);
  });

  it("uses exact elapsed age for eligibility while retaining whole-day telemetry", async () => {
    await refreshClubRatings();
    const ratings = getCachedClubRatings();
    const snapshotAt = ratings.fetchedAt!;
    const boundary = snapshotAt.getTime() + CLUB_STRENGTH_MAX_AGE_MS;

    expect(clubRatingsAreCurrent(ratings, new Date(boundary - 1))).toBe(true);
    expect(clubRatingsAgeDays(snapshotAt, new Date(boundary - 1))).toBe(29);
    expect(clubRatingsAreCurrent(ratings, new Date(boundary))).toBe(true);
    expect(clubRatingsAgeDays(snapshotAt, new Date(boundary))).toBe(30);
    expect(clubRatingsAreCurrent(ratings, new Date(boundary + 1))).toBe(false);
    expect(clubRatingsAgeDays(snapshotAt, new Date(boundary + 1))).toBe(30);
  });
});
