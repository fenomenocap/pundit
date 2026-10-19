import { describe, expect, it } from "vitest";
import { isNonFixtureVersusTarget, referencesFeaturedMatchDeictic } from "./featured-match-deictic";

describe("featured match deictic", () => {
  it("treats market-side versus phrases as non-fixture", () => {
    expect(isNonFixtureVersusTarget("the market")).toBe(true);
    expect(isNonFixtureVersusTarget("Brighton")).toBe(false);
  });

  it("detects homepage featured-match wording", () => {
    expect(referencesFeaturedMatchDeictic(
      "What's the fair price on today's featured match and is there any edge vs the market?"
    )).toBe(true);
    expect(referencesFeaturedMatchDeictic("Fair price on the featured game?")).toBe(true);
    expect(referencesFeaturedMatchDeictic("What's on today's game for odds?")).toBe(true);
    expect(referencesFeaturedMatchDeictic("What's the fair price on this match on the desk?")).toBe(true);
    expect(referencesFeaturedMatchDeictic("In general, why is the table sorted by points?")).toBe(false);
  });
});
