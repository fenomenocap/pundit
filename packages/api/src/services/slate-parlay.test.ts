import { describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__/model-fixture";
import {
  composeSlateParlayAnswer,
  isNonFixtureVersusTarget,
  isSlateParlayRequest,
  referencesFeaturedMatchDeictic,
} from "./slate-parlay";

describe("slate parlay and deictic helpers", () => {
  it("treats market-side versus phrases as non-fixture", () => {
    expect(isNonFixtureVersusTarget("the market")).toBe(true);
    expect(isNonFixtureVersusTarget("market")).toBe(true);
    expect(isNonFixtureVersusTarget("Brighton")).toBe(false);
  });

  it("detects featured-match deictic wording", () => {
    expect(referencesFeaturedMatchDeictic(
      "What's the fair price on today's featured match and is there any edge vs the market?"
    )).toBe(true);
    expect(referencesFeaturedMatchDeictic("Who wins Liverpool v Fulham?")).toBe(false);
  });

  it("detects slate parlay requests but not general slate essays", () => {
    expect(isSlateParlayRequest(
      "Build me a 2-leg parlay from today's matches with the combined price"
    )).toBe(true);
    expect(isSlateParlayRequest(
      "In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?"
    )).toBe(false);
  });

  it("composes legs only from the supplied priced slate", () => {
    const slate = [
      fixture("Tottenham Hotspur", "Coventry City", {
        fixtureId: 1,
        pHome: 0.62,
        pDraw: 0.22,
        pAway: 0.16,
        homeElo: 1850,
        awayElo: 1600,
      }),
      fixture("Arsenal", "Crystal Palace", {
        fixtureId: 2,
        pHome: 0.58,
        pDraw: 0.24,
        pAway: 0.18,
        homeElo: 1900,
        awayElo: 1650,
      }),
      fixture("Brighton", "Nottingham Forest", {
        fixtureId: 3,
        pHome: 0.45,
        pDraw: 0.28,
        pAway: 0.27,
      }),
    ];
    const answer = composeSlateParlayAnswer(
      "Build me a 2-leg parlay from today's matches with the combined price",
      slate
    );
    expect(answer).toBeTruthy();
    expect(answer).toContain("Tottenham Hotspur v Coventry City");
    expect(answer).toContain("Arsenal v Crystal Palace");
    expect(answer).not.toContain("Brighton");
    expect(answer).toContain("Combined model probability");
    expect(answer).toMatch(/not independent/i);
  });
});
