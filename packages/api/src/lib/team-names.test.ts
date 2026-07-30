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

  it("uses the spellings ClubElo actually publishes for the round that went unpriced", () => {
    // Each right-hand name was read off the ClubElo daily snapshot, not
    // inferred. The spacing and the dropped or replaced words are the whole
    // point -- normalization strips diacritics and case but not punctuation, so an
    // approximation here leaves the club unrated and drops its fixture.
    const expected = new Map([
      ["Bodo/Glimt", "Bodoe Glimt"],
      ["Bodø/Glimt", "Bodoe Glimt"],
      ["NEC Nijmegen", "Nijmegen"],
      ["Olympiacos", "Olympiakos"],
      ["Sparta Prague", "Sparta Praha"],
      ["Union St.-Gilloise", "St Gillis"],
      ["Union Saint-Gilloise", "St Gillis"],
    ]);

    for (const [espnName, clubEloName] of expected) {
      expect(canonicalClubName(espnName)).toBe(clubEloName);
    }
  });
});
