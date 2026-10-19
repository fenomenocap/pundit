import { describe, expect, it } from "vitest";
import { inferUserLineFromQuestion } from "./response-correctness";

describe("inferUserLineFromQuestion", () => {
  it("parses away side at 7 on pass or play turns", () => {
    expect(inferUserLineFromQuestion(
      "I found the away side at 7 — pass or play?",
      "Tottenham",
      "Coventry",
    )).toEqual({ outcome: "away", decimalOdds: 7 });
  });

  it("returns undefined without pass or play", () => {
    expect(inferUserLineFromQuestion("away side at 7", "A", "B")).toBeUndefined();
  });
});
