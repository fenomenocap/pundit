import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MARKET_OBSERVATION_MAX_AGE_MS,
  formatDeskMarketLine,
  isFreshMarketObservation,
  pickDeskMarketQuote,
} from "./market-quote.ts";

describe("pickDeskMarketQuote", () => {
  const now = Date.parse("2026-10-19T12:00:00.000Z");

  it("returns null when every source is stale", () => {
    const staleAt = new Date(now - MARKET_OBSERVATION_MAX_AGE_MS - 1).toISOString();
    assert.equal(pickDeskMarketQuote([{
      source: "polymarket",
      observedAt: staleAt,
      pHome: 0.5,
      pDraw: 0.25,
      pAway: 0.25,
    }], now), null);
  });

  it("returns the first fresh complete source", () => {
    const fresh = new Date(now - 60_000).toISOString();
    const quote = pickDeskMarketQuote([
      {
        source: "kalshi",
        observedAt: fresh,
        pHome: 0.6,
        pDraw: 0.2,
        pAway: 0.2,
      },
      {
        source: "polymarket",
        observedAt: fresh,
        pHome: 0.5,
        pDraw: 0.25,
        pAway: 0.25,
      },
    ], now);
    assert.equal(quote?.source, "kalshi");
    assert.ok(Math.abs(quote!.decimals.home - 1 / 0.6) < 1e-5);
  });

  it("formats UK as-of without edge when claims are disabled", () => {
    const quote = pickDeskMarketQuote([{
      source: "polymarket",
      observedAt: "2026-10-19T06:31:24.955Z",
      pHome: 0.64,
      pDraw: 0.2,
      pAway: 0.16,
    }], now)!;
    const line = formatDeskMarketLine(quote, "home", 0.59);
    assert.match(line!, /^Mkt 1\.56 · Polymarket · as of \d{2}:\d{2}$/);
    assert.doesNotMatch(line!, /pp/);
  });
});

describe("isFreshMarketObservation", () => {
  it("rejects clock-skewed future timestamps", () => {
    const now = Date.parse("2026-10-19T12:00:00.000Z");
    const future = new Date(now + MARKET_OBSERVATION_MAX_AGE_MS + 1).toISOString();
    assert.equal(isFreshMarketObservation(future, now), false);
  });
});
