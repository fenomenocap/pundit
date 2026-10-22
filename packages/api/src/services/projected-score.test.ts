import { describe, expect, it } from "vitest";
import { projectedScoreFromScorelines } from "./projected-score";

describe("projectedScoreFromScorelines", () => {
  it("leads with the likeliest score inside the most likely result, keeping the grid mode second", () => {
    // Chelsea v Tottenham live grid (23 Oct): 1-1 is the single mode, 2-1 leads the home-win cells.
    const rows = [
      { score: "1-1", probability: 0.1154 },
      { score: "2-1", probability: 0.1087 },
      { score: "2-0", probability: 0.1015 },
      { score: "1-0", probability: 0.0968 },
    ];
    const projected = projectedScoreFromScorelines(rows, { pHome: 0.5991, pDraw: 0.2436, pAway: 0.1572 });
    expect(projected).toMatchObject({ score: "2-1", probability: 0.1087, outcome: "home", modal: { score: "1-1" } });
  });

  it("ignores the goals line: a 50/50 over 2.5 does not turn 2-0 into 2-1", () => {
    const rows = [
      { score: "2-0", probability: 0.1635 },
      { score: "1-0", probability: 0.1597 },
      { score: "2-1", probability: 0.1091 },
    ];
    expect(projectedScoreFromScorelines(rows, { pHome: 0.7744, pDraw: 0.1708, pAway: 0.0548 })?.score).toBe("2-0");
  });

  it("picks away scores for an away favourite and returns null without rows", () => {
    const rows = [{ score: "1-1", probability: 0.13 }, { score: "1-2", probability: 0.1 }, { score: "0-1", probability: 0.088 }];
    expect(projectedScoreFromScorelines(rows, { pHome: 0.27, pDraw: 0.28, pAway: 0.45 })?.score).toBe("1-2");
    expect(projectedScoreFromScorelines([], { pHome: 0.4, pDraw: 0.3, pAway: 0.3 })).toBeNull();
  });
});
