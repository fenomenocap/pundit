import { describe, expect, it } from "vitest";
import { parseKalshiMarkets } from "./kalshi-data";
import { parsePolymarketMatchEvent } from "./polymarket-data";

describe("parseKalshiMarkets", () => {
  it("parses and normalizes three binary regulation-time markets", () => {
    const markets = [
      { yes_sub_title: "Reg Time: England", yes_bid_dollars: "0.35", yes_ask_dollars: "0.37" },
      { yes_sub_title: "Reg Time: Tie", yes_bid_dollars: "0.32", yes_ask_dollars: "0.34" },
      { yes_sub_title: "Reg Time: Argentina", yes_bid_dollars: "0.30", yes_ask_dollars: "0.32" },
    ];

    const odds = parseKalshiMarkets(markets, "England", "Argentina");
    expect(odds).not.toBeNull();
    expect(odds!.pHome + odds!.pDraw + odds!.pAway).toBeCloseTo(1);
    expect(odds!.pHome).toBeGreaterThan(odds!.pAway);
  });
});

describe("parsePolymarketMatchEvent", () => {
  it("extracts Yes prices for home, draw, and away", () => {
    const event = {
      markets: [
        {
          question: "Will England win on 2026-07-15?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.36","0.64"]',
        },
        {
          question: "Will England vs. Argentina end in a draw?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.33","0.67"]',
        },
        {
          question: "Will Argentina win on 2026-07-15?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.31","0.69"]',
        },
      ],
    };

    const odds = parsePolymarketMatchEvent(event, "England", "Argentina");
    expect(odds).not.toBeNull();
    expect(odds!.pHome + odds!.pDraw + odds!.pAway).toBeCloseTo(1);
    expect(odds).toMatchObject({ pHome: 0.36, pDraw: 0.33, pAway: 0.31 });
  });
});
