import { describe, expect, it } from "vitest";
import { pickHigherGridSide } from "./take-headline";

describe("pickHigherGridSide tie-break", () => {
  it("picks home/over/yes when model pct is tied", () => {
    expect(pickHigherGridSide([
      { sideKey: "home", label: "Home", p: 0.36 },
      { sideKey: "away", label: "Away", p: 0.36 },
    ]).sideKey).toBe("home");
    expect(pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: 0.5 },
      { sideKey: "under", label: "Under 2.5", p: 0.5 },
    ]).sideKey).toBe("over");
  });
});
