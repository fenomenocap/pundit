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
});
