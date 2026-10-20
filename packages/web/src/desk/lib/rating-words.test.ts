import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ratingComparison } from "./rating-words.ts";

describe("ratingComparison", () => {
  it("says the higher side rate stronger when the gap is 50 or more", () => {
    assert.equal(ratingComparison("Chelsea", "Spurs", 1896, 1803), "Chelsea rate stronger.");
    assert.equal(ratingComparison("Chelsea", "Spurs", 1803, 1896), "Spurs rate stronger.");
  });

  it("says slightly stronger when the gap is under 50", () => {
    assert.equal(ratingComparison("Chelsea", "Spurs", 1840, 1803), "Chelsea rate slightly stronger.");
    assert.equal(ratingComparison("Arsenal", "Liverpool", 1900, 1880), "Arsenal rate slightly stronger.");
  });

  it("says evenly matched when the ratings round to the same number", () => {
    assert.equal(ratingComparison("Chelsea", "Spurs", 1896, 1896), "Chelsea and Spurs are evenly matched.");
    assert.equal(ratingComparison("Chelsea", "Spurs", 1896.4, 1895.6), "Chelsea and Spurs are evenly matched.");
  });
});
