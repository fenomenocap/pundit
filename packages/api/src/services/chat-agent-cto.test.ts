import { describe, expect, it } from "vitest";
import type { AskGrounding } from "./ask";
import { repairMalformedCitationMarkers } from "./chat-agent-package";
import { marketOddsToolPayload } from "./chat-agent";
import type { ModelFixture } from "./model-data";

const fixture = {
  competitionId: "eng.1",
  fixtureId: "401878771",
  home: "Arsenal",
  away: "Everton",
  date: "2026-10-18",
  utcDate: "2026-10-18T14:00:00.000Z",
  pHome: 0.62,
  pDraw: 0.22,
  pAway: 0.16,
} as ModelFixture;

const matchWithOdds = {
  kind: "match",
  fixtureId: "espn:eng.1:401878771",
  competitionId: "eng.1",
  home: "Arsenal",
  away: "Everton",
  oddsSources: [{
    source: "kalshi",
    observedAt: "2026-10-18T12:00:00.000Z",
    pHome: 0.61,
    pDraw: 0.23,
    pAway: 0.16,
  }, {
    source: "polymarket",
    observedAt: "2026-10-18T12:00:00.000Z",
    pHome: 0.6,
    pDraw: 0.24,
    pAway: 0.16,
  }],
} as AskGrounding;

describe("CTO agent fixes", () => {
  it("CTO C) repairs raw [[S1( markers into [[S1]] when the source exists", () => {
    const bundle = {
      queries: [],
      results: [{
        id: "S1",
        title: "Injury report",
        url: "https://example.com/injury",
        date: "2026-10-17",
        snippet: "Player out",
        tier: "publisher",
      }],
    };
    expect(repairMalformedCitationMarkers("Saka is doubtful [[S1( per the report.", bundle))
      .toBe("Saka is doubtful [[S1]] per the report.");
    expect(repairMalformedCitationMarkers("Still cited [[S1]].", bundle)).toBe("Still cited [[S1]].");
  });

  it("CTO C) drops malformed markers when the source id is unknown", () => {
    const bundle = { queries: [], results: [] };
    expect(repairMalformedCitationMarkers("Claim [[S9( without a source.", bundle))
      .toBe("Claim without a source.");
  });

  it("CTO C) get_market_odds payload surfaces grounding Kalshi/Polymarket when cache is empty", () => {
    const payload = marketOddsToolPayload(fixture, matchWithOdds);
    expect(payload.quotes).toHaveLength(2);
    expect(payload.oddsSources).toHaveLength(2);
    const kalshi = (payload.quotes as Array<{ source: string; decimalBeforeFees: { home: number } }>)
      .find((row) => row.source === "kalshi");
    expect(kalshi?.decimalBeforeFees.home).toBeCloseTo(1 / 0.61);
  });
});
