import { describe, expect, it } from "vitest";
import { ModelFixture } from "./model-data";
import {
  noVigFromDecimal,
  parseKalshiEvent,
  parsePolymarketEvent,
  parseStakeFixture,
} from "./fixture-market-sources";

const fixture: ModelFixture = {
  date: "2026-07-15", group: null, stage: "semifinals", home: "England", away: "Argentina",
  pHome: 0.25, pDraw: 0.25, pAway: 0.5, pOver2_5: 0.5, pUnder2_5: 0.5,
  pBttsYes: 0.5, pBttsNo: 0.5, topScores: [], stakePHome: null,
  stakePDraw: null, stakePAway: null, result: null,
};

describe("local fixture market normalization", () => {
  it("removes the overround from complete decimal 1X2 odds", () => {
    expect(noVigFromDecimal(2, 4, 4)).toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
    expect(noVigFromDecimal(2, null, 4)).toBeNull();
  });

  it("parses an active Stake match-result market", () => {
    const parsed = parseStakeFixture({
      data: { __typename: "SportFixtureDataMatch", competitors: [{ name: "England" }, { name: "Argentina" }] },
      groups: [{ templates: [{ name: "Main", markets: [{
        name: "Match Result", status: "active", outcomes: [
          { name: "England", odds: 2, active: true },
          { name: "Draw", odds: 4, active: true },
          { name: "Argentina", odds: 4, active: true },
        ],
      }] }] }],
    }, [fixture]);
    expect(parsed?.odds).toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
  });

  it("combines active Polymarket binary contracts", () => {
    const markets = [
      ["England", "0.5"], ["Draw", "0.25"], ["Argentina", "0.25"],
    ].map(([groupItemTitle, yes]) => ({
      active: true, closed: false, groupItemTitle, sportsMarketType: "moneyline",
      outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]),
    }));
    expect(parsePolymarketEvent({ title: "England vs Argentina", markets }, fixture))
      .toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
  });

  it("combines only open Kalshi contracts and rejects settled prices", () => {
    const markets = [
      ["England", "0.5"], ["Draw", "0.25"], ["Argentina", "0.25"],
    ].map(([yes_sub_title, price]) => ({
      status: "open", title: "Regulation Time Moneyline", yes_sub_title,
      yes_ask_dollars: price,
    }));
    expect(parseKalshiEvent({ title: "England vs Argentina", markets }, fixture))
      .toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
    expect(parseKalshiEvent({
      title: "England vs Argentina",
      markets: markets.map((market) => ({ ...market, status: "settled" })),
    }, fixture)).toBeNull();
  });

  it("rejects settled-looking zero/zero/one Polymarket prices", () => {
    const markets = [
      ["England", "0"], ["Draw", "0"], ["Argentina", "1"],
    ].map(([groupItemTitle, yes]) => ({
      active: true, closed: false, groupItemTitle, sportsMarketType: "moneyline",
      outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]),
    }));
    expect(parsePolymarketEvent({ title: "England vs Argentina", markets }, fixture)).toBeNull();
  });
});
