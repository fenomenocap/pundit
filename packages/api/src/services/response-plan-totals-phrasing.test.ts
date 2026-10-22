import { describe, expect, it } from "vitest";
import { asksTotalsQuestion } from "./response-plan";

describe("asksTotalsQuestion bet phrasing", () => {
  it.each([
    "Should I bet the over on Palace vs Newcastle?",
    "back the under in Arsenal v Everton",
  ])("routes %s to totals", (q) => expect(asksTotalsQuestion(q)).toBe(true));

  it("does not treat unrelated 'over' as totals", () => {
    expect(asksTotalsQuestion("Will Arsenal take over the top spot?")).toBe(false);
  });
});
