import { describe, expect, it } from "vitest";
import { parseEloRatings, parseTsv } from "./elo-ratings";

describe("local Elo ratings", () => {
  it("parses TSV rows and canonicalizes source team names", () => {
    expect(parseTsv("USA\tUnited States\nENG\tEngland\n")).toEqual([
      ["USA", "United States"], ["ENG", "England"],
    ]);
    const names = Array.from({ length: 10 }, (_, index) => [
      `T${index}`,
      index === 0 ? "United States" : `Team ${index}`,
    ]);
    const world = names.map(([code], index) => ["", "", code, String(1900 - index)]);
    expect(parseEloRatings(names, world).get("USA")).toBe(1900);
  });
});
