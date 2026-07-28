import { describe, expect, it } from "vitest";
import { lookupClubRating, parseClubEloCsv } from "./club-ratings";

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
});
