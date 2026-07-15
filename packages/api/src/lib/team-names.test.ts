import { describe, expect, it } from "vitest";
import { normalizeTeamName } from "./team-names";

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
});
