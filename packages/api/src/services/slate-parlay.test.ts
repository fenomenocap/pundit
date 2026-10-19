import { describe, expect, it, vi } from "vitest";
import { fixture } from "./__fixtures__/model-fixture";
import {
  composeCrossGameParlayAnswer,
  composeSlateParlayAnswer,
  isCrossGameParlayRequest,
  isDeskParlayRequest,
  isNonFixtureVersusTarget,
  isSlateParlayRequest,
  londonCalendarDate,
  referencesFeaturedMatchDeictic,
  selectSlateLegsForParlay,
  PARLAY_PRICING_FALLBACK,
  slateParlayFailClosedAnswer,
} from "./slate-parlay";
import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";

describe("slate parlay and deictic helpers", () => {
  it("treats market-side versus phrases as non-fixture", () => {
    expect(isNonFixtureVersusTarget("the market")).toBe(true);
    expect(isNonFixtureVersusTarget("Brighton")).toBe(false);
  });

  it("detects featured-match deictic wording", () => {
    expect(referencesFeaturedMatchDeictic(
      "What's the fair price on today's featured match and is there any edge vs the market?"
    )).toBe(true);
    expect(referencesFeaturedMatchDeictic("Fair price on the featured game?")).toBe(true);
    expect(referencesFeaturedMatchDeictic("What's the fair price on this match on the desk?")).toBe(true);
  });

  it("filters today first then fills from next kickoffs with one notice", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const today = fixture("Tottenham Hotspur", "Coventry City", {
      fixtureId: 1,
      utcDate: "2026-10-19T19:00:00.000Z",
      pHome: 0.62,
      pDraw: 0.22,
      pAway: 0.16,
    });
    const tomorrow = fixture("Arsenal", "Crystal Palace", {
      fixtureId: 2,
      utcDate: "2026-10-20T19:00:00.000Z",
      pHome: 0.58,
      pDraw: 0.24,
      pAway: 0.18,
    });
    const later = fixture("Liverpool", "Chelsea", {
      fixtureId: 3,
      utcDate: "2026-10-21T19:00:00.000Z",
      pHome: 0.5,
      pDraw: 0.25,
      pAway: 0.25,
    });
    expect(londonCalendarDate(today.utcDate)).toBe(londonCalendarDate(now));
    const selection = selectSlateLegsForParlay(
      "Build me a 2-leg parlay from today's matches with the combined price",
      [tomorrow, today, later],
      now
    );
    expect(selection?.legs.map((row) => row.fixtureId)).toEqual([1, 2]);
    expect(selection?.scopeLead).toMatch(/Today has one match/);
  });

  it("scopes next-slate accas to the upcoming desk window", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const slate = [
      fixture("Tottenham Hotspur", "Coventry City", {
        fixtureId: 1,
        utcDate: "2026-10-19T19:00:00.000Z",
        pHome: 0.62,
        pDraw: 0.22,
        pAway: 0.16,
      }),
      fixture("Arsenal", "Everton", {
        fixtureId: 2,
        utcDate: "2026-10-23T14:00:00.000Z",
        pHome: 0.58,
        pDraw: 0.24,
        pAway: 0.18,
      }),
      fixture("Liverpool", "Chelsea", {
        fixtureId: 3,
        utcDate: "2026-10-24T15:00:00.000Z",
        pHome: 0.5,
        pDraw: 0.25,
        pAway: 0.25,
      }),
    ];
    const selection = selectSlateLegsForParlay("3-fold acca from the next slate", slate, now);
    expect(selection?.legs.every((row) => row.fixtureId !== 1)).toBe(true);
    expect(selection?.scopeLead).toMatch(/Next desk slate/);
  });

  it("returns honest fallback when parlay cannot be priced", () => {
    expect(slateParlayFailClosedAnswer()).toBe(PARLAY_PRICING_FALLBACK);
    const answer = composeSlateParlayAnswer("2-leg parlay from the desk", [], new Date());
    expect(answer).toBeNull();
  });

  it("composes kickoff labels and fair-only framing when no market", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const slate = [
      fixture("Tottenham Hotspur", "Coventry City", {
        fixtureId: 1,
        utcDate: "2026-10-19T19:00:00.000Z",
        pHome: 0.62,
        pDraw: 0.22,
        pAway: 0.16,
        homeElo: 1850,
        awayElo: 1600,
        stakePHome: null,
        stakePDraw: null,
        stakePAway: null,
      }),
      fixture("Arsenal", "Crystal Palace", {
        fixtureId: 2,
        utcDate: "2026-10-19T14:00:00.000Z",
        pHome: 0.58,
        pDraw: 0.24,
        pAway: 0.18,
        homeElo: 1900,
        awayElo: 1650,
      }),
    ];
    const answer = composeSlateParlayAnswer(
      "Build me a 2-leg parlay from today's matches with the combined price",
      slate,
      now
    );
    expect(answer).toMatch(/UK ·/);
    expect(answer).toMatch(/fair price only \(no live market quote\)/i);
    expect(answer).not.toMatch(/bookmaker ticket/i);
    expect(answer).toMatch(/Correlation:/);
    if (!MODEL_EDGE_CLAIMS_ALLOWED) {
      expect(answer).not.toMatch(/\bedge\b/i);
    }
  });

  it("includes market line when stake odds exist on the fixture", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const slate = [
      fixture("Tottenham Hotspur", "Coventry City", {
        fixtureId: 1,
        utcDate: "2026-10-19T19:00:00.000Z",
        pHome: 0.62,
        pDraw: 0.22,
        pAway: 0.16,
        stakePHome: 0.58,
        stakePDraw: 0.24,
        stakePAway: 0.18,
        forecastProvenance: {
          modelId: "clubelo",
          modelVersion: "3",
          contributorId: "clubelo",
          contributorVersion: "1",
          methodId: "test",
          forecastAt: "2026-10-19T10:00:00.000Z",
          ratingProfile: "eng-clubs",
          ratingSnapshotAt: null,
          ratingAgeMinutes: null,
          ratingSourceState: "artifact",
        },
      }),
      fixture("Arsenal", "Crystal Palace", {
        fixtureId: 2,
        utcDate: "2026-10-20T19:00:00.000Z",
        pHome: 0.58,
        pDraw: 0.24,
        pAway: 0.18,
        stakePHome: 0.55,
        stakePDraw: 0.25,
        stakePAway: 0.2,
        forecastProvenance: {
          modelId: "clubelo",
          modelVersion: "3",
          contributorId: "clubelo",
          contributorVersion: "1",
          methodId: "test",
          forecastAt: "2026-10-19T10:00:00.000Z",
          ratingProfile: "eng-clubs",
          ratingSnapshotAt: null,
          ratingAgeMinutes: null,
          ratingSourceState: "artifact",
        },
      }),
    ];
    const answer = composeSlateParlayAnswer(
      "Pick me a 5-fold acca from today's 3pm kick-offs",
      slate,
      now
    );
    expect(answer).toMatch(/market implied \d+\.\d%/);
    expect(answer).toMatch(/gap [+-]?\d+\.\d pts/);
    expect(answer).toMatch(/Stake/);
  });

  it("detects cross-game named parlays without slate keywords", () => {
    const q = "Spurs to beat Coventry and Arsenal to beat Everton — what's the combined fair price?";
    expect(isCrossGameParlayRequest(q)).toBe(true);
    expect(isDeskParlayRequest(q)).toBe(true);
    expect(isSlateParlayRequest(q)).toBe(false);
  });

  it("composes demo five-fold next-slate acca with scope lead and combined model line", () => {
    const now = new Date("2026-10-19T12:00:00.000Z");
    const slate = [
      fixture("Arsenal", "Everton", { fixtureId: 2, utcDate: "2026-10-23T14:00:00.000Z", pHome: 0.58, pDraw: 0.24, pAway: 0.18 }),
      fixture("Liverpool", "Chelsea", { fixtureId: 3, utcDate: "2026-10-23T14:00:00.000Z", pHome: 0.5, pDraw: 0.25, pAway: 0.25 }),
      fixture("Manchester City", "Bournemouth", { fixtureId: 4, utcDate: "2026-10-23T14:00:00.000Z", pHome: 0.72, pDraw: 0.18, pAway: 0.1 }),
      fixture("Newcastle United", "Brighton & Hove Albion", { fixtureId: 5, utcDate: "2026-10-24T15:00:00.000Z", pHome: 0.52, pDraw: 0.26, pAway: 0.22 }),
      fixture("Aston Villa", "West Ham United", { fixtureId: 6, utcDate: "2026-10-24T15:00:00.000Z", pHome: 0.55, pDraw: 0.25, pAway: 0.2 }),
      fixture("Fulham", "Wolverhampton Wanderers", { fixtureId: 7, utcDate: "2026-10-25T15:00:00.000Z", pHome: 0.48, pDraw: 0.27, pAway: 0.25 }),
    ];
    const answer = composeSlateParlayAnswer("Pick me a 5-fold acca from the next slate", slate, now);
    expect(answer).toMatch(/^Next desk slate/);
    expect(answer).toMatch(/5-fold/);
    expect(answer).toMatch(/combined model \d+\.\d%/);
    expect(answer).toMatch(/model \d+\.\d% \(fair \d+\.\d{2}\)/);
  });

  it("composes a two-leg cross-game parlay from named picks", () => {
    const slate = [
      fixture("Tottenham Hotspur", "Coventry City", {
        fixtureId: 1,
        utcDate: "2026-10-19T19:00:00.000Z",
        pHome: 0.62,
        pDraw: 0.22,
        pAway: 0.16,
      }),
      fixture("Arsenal", "Everton", {
        fixtureId: 2,
        utcDate: "2026-10-20T19:00:00.000Z",
        pHome: 0.58,
        pDraw: 0.24,
        pAway: 0.18,
        stakePHome: 0.56,
        stakePDraw: 0.25,
        stakePAway: 0.19,
      }),
    ];
    const answer = composeCrossGameParlayAnswer(
      "Spurs to beat Coventry and Arsenal to beat Everton",
      slate
    );
    expect(answer).toMatch(/two-leg/i);
    expect(answer).toMatch(/combined model \d+\.\d%/);
    expect(answer).toMatch(/This uses /);
    expect(answer).toMatch(/Tottenham Hotspur v Coventry City/);
    expect(answer).toMatch(/Arsenal v Everton/);
  });

  it("detects slate parlay requests but not general slate essays", () => {
    expect(isSlateParlayRequest(
      "Build me a 2-leg parlay from today's matches with the combined price"
    )).toBe(true);
    expect(isSlateParlayRequest(
      "In general, how do you assess a slate of football fixtures without treating any outcome as guaranteed?"
    )).toBe(false);
  });
});
