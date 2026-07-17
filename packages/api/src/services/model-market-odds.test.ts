import { describe, expect, it } from "vitest";
import { marketOddsFixtureKey } from "./model-market-odds";

describe("marketOddsFixtureKey", () => {
  it("is insensitive to team order and name variants", () => {
    expect(marketOddsFixtureKey("2026-07-19", "Spain", "Argentina"))
      .toBe(marketOddsFixtureKey("2026-07-19", "Argentina", "Spain"));
    expect(marketOddsFixtureKey("2026-07-19", "USA", "England"))
      .toBe(marketOddsFixtureKey("2026-07-19", "England", "United States"));
  });

  it("distinguishes the same pairing on different dates", () => {
    expect(marketOddsFixtureKey("2026-07-19", "Spain", "Argentina"))
      .not.toBe(marketOddsFixtureKey("2026-07-18", "Spain", "Argentina"));
  });
});
