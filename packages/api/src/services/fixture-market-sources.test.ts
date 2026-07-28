import { afterEach, describe, expect, it, vi } from "vitest";
import { getModelFixtureKey, ModelFixture } from "./model-data";
import {
  fetchKalshiOdds,
  fetchPolymarketOdds,
  noVigFromDecimal,
  parseKalshiEvent,
  parsePolymarketEvent,
  parseStakeFixture,
} from "./fixture-market-sources";

const fixture: ModelFixture = {
  competitionId: "eng.1",
  competition: "Premier League",
  fixtureId: 1,
  utcDate: "2026-07-15T19:00:00Z",
  date: "2026-07-15",
  group: null,
  stage: "match",
  home: "England",
  away: "Argentina",
  homeElo: 1800,
  awayElo: 1750,
  pHome: 0.25,
  pDraw: 0.25,
  pAway: 0.5,
  pOver2_5: 0.5,
  pUnder2_5: 0.5,
  pBttsYes: 0.5,
  pBttsNo: 0.5,
  topScores: [],
  scorelines: [],
  stakePHome: null,
  stakePDraw: null,
  stakePAway: null,
  result: null,
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

  // Shape cut from the live final event: the draw leg is labelled
  // "Draw (Spain vs. Argentina)", not a bare "Draw".
  it("maps Polymarket's parenthesised draw label to the draw leg", () => {
    const markets = [
      ["England", "0.5"], ["Draw (England vs. Argentina)", "0.25"], ["Argentina", "0.25"],
    ].map(([groupItemTitle, yes]) => ({
      active: true, closed: false, groupItemTitle, sportsMarketType: "moneyline",
      outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]),
    }));
    expect(parsePolymarketEvent({ title: "England vs. Argentina", markets }, fixture))
      .toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
  });

  // Shape cut from the live KXWCGAME series response: outcome labels carry a
  // "Reg Time:" prefix and prices live only in the *_dollars fields.
  it("parses a KXWCGAME event with prefixed labels and dollar-only prices", () => {
    const markets = [
      ["Reg Time: England", 0.43], ["Reg Time: Tie", 0.32], ["Reg Time: Argentina", 0.27],
    ].map(([yes_sub_title, price]) => ({
      status: "active", yes_sub_title,
      yes_ask: null, yes_bid: null, last_price: null,
      yes_ask_dollars: price, yes_bid_dollars: (price as number) - 0.01,
    }));
    const odds = parseKalshiEvent({
      title: "England vs Argentina: Regulation Time Moneyline",
      sub_title: "ENG vs ARG (Jul 19)",
      markets,
    }, fixture);
    const total = 0.43 + 0.32 + 0.27;
    expect(odds?.pHome).toBeCloseTo(0.43 / total);
    expect(odds?.pDraw).toBeCloseTo(0.32 / total);
    expect(odds?.pAway).toBeCloseTo(0.27 / total);
  });
});

describe("market source fetchers", () => {
  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

  afterEach(() => vi.unstubAllGlobals());

  it("queries Kalshi by the WC match series and maps the fixture", async () => {
    const wcFixture: ModelFixture = {
      ...fixture,
      competitionId: "fifa.world",
      competition: "FIFA World Cup 2026",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      events: [{
        title: "England vs Argentina: Regulation Time Moneyline",
        markets: [
          { status: "active", yes_sub_title: "Reg Time: England", yes_ask_dollars: 0.43 },
          { status: "active", yes_sub_title: "Reg Time: Tie", yes_ask_dollars: 0.32 },
          { status: "active", yes_sub_title: "Reg Time: Argentina", yes_ask_dollars: 0.27 },
        ],
      }],
      cursor: "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchKalshiOdds([wcFixture], "world-cup");
    expect(String(fetchMock.mock.calls[0][0])).toContain("series_ticker=KXWCGAME");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(1);
  });

  it("searches Polymarket per fixture and refetches slim events by slug", async () => {
    const pricedMarkets = [
      ["England", "0.5"], ["Draw", "0.25"], ["Argentina", "0.25"],
    ].map(([groupItemTitle, yes]) => ({
      active: true, closed: false, groupItemTitle, sportsMarketType: "moneyline",
      outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([yes, String(1 - Number(yes))]),
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        events: [{
          title: "England vs. Argentina", slug: "fifwc-eng-arg-2026-07-15",
          markets: pricedMarkets.map(({ outcomePrices: _p, ...market }) => market),
        }],
      }))
      .mockResolvedValueOnce(jsonResponse([{
        title: "England vs. Argentina", slug: "fifwc-eng-arg-2026-07-15",
        markets: pricedMarkets,
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchPolymarketOdds([fixture]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("public-search?q=");
    expect(String(fetchMock.mock.calls[1][0])).toContain("slug=fifwc-eng-arg-2026-07-15");
    expect(result.get(getModelFixtureKey(fixture)))
      .toEqual({ pHome: 0.5, pDraw: 0.25, pAway: 0.25 });
  });
});
