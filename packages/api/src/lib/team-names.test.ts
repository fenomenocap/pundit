import { describe, expect, it } from "vitest";
import { canonicalClubName, canonicalTeamName, normalizeTeamName } from "./team-names";

describe("normalizeTeamName", () => {
  it("strips diacritics", () => {
    expect(normalizeTeamName("Curaçao")).toBe("curacao");
  });

  it("resolves aliases to canonical model names", () => {
    expect(normalizeTeamName("Türkiye")).toBe("turkey");
    expect(normalizeTeamName("United States")).toBe("usa");
    expect(normalizeTeamName("The Democratic Republic of Congo")).toBe("dr congo");
  });

  it("is case-insensitive", () => {
    expect(normalizeTeamName("BOSNIA AND HERZEGOVINA")).toBe("bosnia");
  });

  it("returns display-case canonical names for upstream model inputs", () => {
    expect(canonicalTeamName("United States")).toBe("USA");
    expect(canonicalTeamName("Türkiye")).toBe("Turkey");
    expect(canonicalTeamName("Curaçao")).toBe("Curacao");
  });

  it("resolves club aliases to ClubElo canonical names", () => {
    expect(normalizeTeamName("Manchester United")).toBe("man united");
    expect(canonicalClubName("Tottenham Hotspur")).toBe("Tottenham");
    expect(canonicalClubName("Brighton & Hove Albion")).toBe("Brighton");
  });

  it("resolves current UCL qualifier names from ESPN to ClubElo", () => {
    const expected = new Map([
      ["KuPS Kuopio", "Kuopio"],
      ["Sabah FK", "Sabah"],
      ["Lincoln Red Imps", "Lincoln"],
      ["Mjällby AIF", "Mjaellby"],
      ["FC Thun", "Thun"],
      ["NK Celje", "Celje"],
      ["Heart of Midlothian", "Hearts"],
      ["SK Sturm Graz", "Sturm Graz"],
      ["Shamrock Rovers", "Shamrock"],
      ["Kairat Almaty", "Kairat"],
      ["Omonia Nicosia", "Omonia"],
      ["KI Klaksvik", "Klaksvik"],
      ["Lech Poznan", "Lech"],
      ["AGF", "Aarhus"],
      ["CSU Craiova", "Craiova"],
      ["Levski Sofia", "Levski"],
      ["Hapoel Be'er", "Beer-Sheva"],
      ["Vikingur Reykjavik", "Vikingur"],
      ["Gornik Zabrze", "Gornik"],
      ["Red Star Belgrade", "Crvena Zvezda"],
      ["Iberia 1999", "Saburtalo"],
    ]);

    for (const [espnName, clubEloName] of expected) {
      expect(canonicalClubName(espnName)).toBe(clubEloName);
    }
  });
});
