import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLUB_RATINGS_MAX_PERSISTED_AGE_DAYS,
  clubRatingsAgeDays,
  deserialiseClubRatings,
  getCachedClubRatings,
  loadPersistedClubRatings,
  refreshClubRatings,
  serialiseClubRatings,
} from "./club-ratings";

const originalDataDir = process.env.PUNDIT_DATA_DIR;
let dataDir: string;

function ratingsCsv(count = 10): string {
  const rows = Array.from({ length: count }, (_, index) =>
    `${index + 1},Club ${index + 1},${index < 5 ? "ENG" : "ESP"},1,${1800 - index},2026-07-01,2026-07-26`
  );
  return ["Rank,Club,Country,Level,Elo,From,To", ...rows].join("\n");
}

function okCsv(): Response {
  return { ok: true, status: 200, text: async () => ratingsCsv() } as unknown as Response;
}

function writePersisted(fetchedAt: Date): void {
  const byProfile = {
    world: new Map<string, number>(),
    "eng-clubs": new Map([["Arsenal", 1850]]),
    "uefa-clubs": new Map([["Arsenal", 1850], ["Paris SG", 1840]]),
  };
  const target = path.join(dataDir, "cache", "club-ratings.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(serialiseClubRatings(byProfile, fetchedAt)), "utf8");
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-ratings-"));
  process.env.PUNDIT_DATA_DIR = dataDir;
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.PUNDIT_DATA_DIR;
  else process.env.PUNDIT_DATA_DIR = originalDataDir;
});

describe("club ratings persistence", () => {
  it("round-trips a rating set through serialisation", () => {
    const fetchedAt = new Date("2026-08-01T00:00:00.000Z");
    const byProfile = {
      world: new Map<string, number>(),
      "eng-clubs": new Map([["Arsenal", 1850]]),
      "uefa-clubs": new Map([["Arsenal", 1850], ["Paris SG", 1840]]),
    };
    const restored = deserialiseClubRatings(serialiseClubRatings(byProfile, fetchedAt));
    expect(restored?.fetchedAt.toISOString()).toBe(fetchedAt.toISOString());
    expect(restored?.byProfile["uefa-clubs"].get("Paris SG")).toBe(1840);
    expect(restored?.byProfile["eng-clubs"].get("Arsenal")).toBe(1850);
  });

  it("rejects a persisted set with no usable ratings", () => {
    expect(deserialiseClubRatings({
      fetchedAt: "2026-08-01T00:00:00.000Z",
      byProfile: { world: {}, "eng-clubs": {}, "uefa-clubs": {} },
    })).toBeNull();
  });

  it("writes the ratings cache to the volume after a successful refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okCsv()));
    await refreshClubRatings();
    expect(fs.existsSync(path.join(dataDir, "cache", "club-ratings.json"))).toBe(true);
    expect(getCachedClubRatings().servingPersisted).toBe(false);
  });

  it("restores ratings from the volume so a restart mid-outage still prices", () => {
    writePersisted(new Date(Date.now() - 3 * 86_400_000));
    expect(loadPersistedClubRatings()).toBe(true);
    const cached = getCachedClubRatings();
    expect(cached.byProfile["uefa-clubs"].get("Arsenal")).toBe(1850);
    expect(cached.servingPersisted).toBe(true);
    expect(clubRatingsAgeDays(cached.fetchedAt)).toBe(3);
  });

  it("refuses persisted ratings older than the age limit", () => {
    const tooOld = new Date(Date.now() - (CLUB_RATINGS_MAX_PERSISTED_AGE_DAYS + 1) * 86_400_000);
    writePersisted(tooOld);
    expect(loadPersistedClubRatings()).toBe(false);
    // It must not adopt the expired snapshot, whatever the cache already held.
    expect(getCachedClubRatings().fetchedAt?.toISOString()).not.toBe(tooOld.toISOString());
  });

  it("keeps serving restored ratings when ClubElo is unreachable", async () => {
    writePersisted(new Date(Date.now() - 2 * 86_400_000));
    loadPersistedClubRatings();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    await refreshClubRatings();

    const cached = getCachedClubRatings();
    // The outage is recorded, but the model still has ratings to build from --
    // the failure mode that took the chat tier to 503 on 2026-08-07.
    expect(cached.error).toBe("timeout");
    expect(cached.servingPersisted).toBe(true);
    expect(cached.byProfile["uefa-clubs"].get("Arsenal")).toBe(1850);
  });

  it("drops ratings that age out during a prolonged outage", async () => {
    writePersisted(new Date(Date.now() - (CLUB_RATINGS_MAX_PERSISTED_AGE_DAYS - 1) * 86_400_000));
    loadPersistedClubRatings();
    vi.setSystemTime(new Date(Date.now() + 3 * 86_400_000));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    await refreshClubRatings();

    // Past the limit the model should go honestly unready rather than quietly
    // price matches off ratings nobody would stand behind.
    expect(getCachedClubRatings().byProfile["uefa-clubs"].size).toBe(0);
    expect(getCachedClubRatings().fetchedAt).toBeNull();
    vi.useRealTimers();
  });
});
