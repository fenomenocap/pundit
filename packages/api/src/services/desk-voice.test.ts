import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../config/freshness-policy";
import type { Grounding } from "./ask";
import { sampleMatchContextFields } from "./match-context";
import {
  DESK_SYSTEM,
  card,
  composeDeskFootballTake,
  deskProseIsCurrentNewsRemainder,
  stripSurplusCurrentNewsNotices,
  filterDeskEvidenceRows,
  formatSearchEvidence,
  humaniseDeskCitationDates,
  sanitizeDeskModelProse,
  shouldRestoreDeskFootballTake,
  stripDeskBoardRecitals,
} from "./desk-voice";

function match(over: Partial<Grounding> = {}): Grounding {
  return {
    kind: "match",
    fixtureId: "espn:eng.1:city",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-13",
    stage: "match",
    home: "Manchester City",
    away: "Sunderland",
    pHome: 0.82,
    pDraw: 0.13,
    pAway: 0.05,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.4,
    pBttsNo: 0.6,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    pricing: {
      pHome: 0.82,
      pDraw: 0.13,
      pAway: 0.05,
    } as unknown as Grounding["pricing"],
    marketDivergence: [],
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields({
      homeElo: 1950,
      awayElo: 1520,
      homeForm: ["W", "W", "D"],
      awayForm: ["L", "D", "L"],
      homeTable: { position: 2, points: 10, goalDifference: 6, playedGames: 4 },
      awayTable: { position: 18, points: 2, goalDifference: -5, playedGames: 4 },
    }),
    ...over,
  };
}

const NOW = Date.parse("2026-09-11T03:00:00.000Z");

describe("filterDeskEvidenceRows", () => {
  it("drops months-old previews and a different opponent", () => {
    const kept = filterDeskEvidenceRows(
      [
        {
          id: "S1",
          title: "Manchester City vs Sunderland Team News, H2H, early...",
          snippet: "Rodri ACL, De Bruyne groin, Bobb still out.",
          date: "2025-12-04T09:23:37.534Z",
          url: "https://www.goal.com/old-sunderland",
        },
        {
          id: "S2",
          title: "Man City Starting XI vs Sunderland: Confirmed Team News",
          snippet: "Yahoo preview from January.",
          date: "2026-01-01",
          url: "https://sports.yahoo.com/old-xi",
        },
        {
          id: "S3",
          title: "Man City vs Coventry injury, suspension list, predicted XIs",
          snippet: "Doku calf. Stones and Bobb unavailable.",
          date: "2026-09-04T15:00:00+01:00",
          url: "https://www.sportsmole.co.uk/coventry",
        },
        {
          id: "S4",
          title: "Manchester City vs Sunderland: predicted lineup and team news",
          snippet: "Haaland leads the line this weekend.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.bbc.co.uk/current",
        },
      ],
      match(),
      NOW
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toContain("bbc.co.uk");
    expect(kept[0]?.id).toBe("S1");
  });

  it("drops City previews when the pinned fixture is Chelsea vs Hull", () => {
    const kept = filterDeskEvidenceRows(
      [
        {
          title: "Manchester City vs Sunderland Team News",
          snippet: "Rodri still out.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.goal.com/city",
        },
        {
          title: "Chelsea vs Hull City: predicted lineup and team news",
          snippet: "Jackson is a doubt.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.standard.co.uk/chelsea-hull",
        },
      ],
      match({
        home: "Chelsea",
        away: "Hull City",
        fixtureId: "espn:eng.1:chelsea-hull",
      }),
      NOW
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toContain("chelsea-hull");
  });
});

describe("desk citation rewrite", () => {
  it("unsticks a jammed markdown citation and drops an offset ISO instant", () => {
    const raw = "just 40% BTTS([Manchester City vs Sunderland Team News, H2H, early... ]"
      + "(https://www.goal.com/en/news/city), 2025-12-04T09:23:37.534Z). "
      + "later has Dias ([Man City vs Coventry](https://www.sportsmole.co.uk/x), "
      + "2026-09-04T15:00:00+01:00).";
    const out = humaniseDeskCitationDates(raw);
    expect(out).not.toMatch(/T09:23:37/);
    expect(out).not.toMatch(/\+01:00/);
    expect(out).toContain("BTTS ([Manchester City vs Sunderland Team News, H2H, early...](https://www.goal.com/en/news/city) · 4 Dec)");
    expect(out).toContain("([Man City vs Coventry](https://www.sportsmole.co.uk/x) · 4 Sep)");
  });
});

describe("sanitizeDeskModelProse", () => {
  it("drops MiniMax-authored markdown links and unevidenced ACL names", () => {
    const dumped = "The bench still waits on Rodri (ACL) ([City vs Sunderland](https://www.goal.com/old), 2025-12-04T09:23:37.534Z). Who decides it is the first ball in behind.";
    const clean = sanitizeDeskModelProse(dumped);
    expect(clean).toContain("Who decides it is the first ball in behind.");
    expect(clean).not.toMatch(/Rodri/);
    expect(clean).not.toMatch(/goal\.com/);
  });
});

describe("formatSearchEvidence dates", () => {
  it("feeds MiniMax a short date, not a machine instant", () => {
    const block = formatSearchEvidence([
      {
        id: "S1",
        title: "City vs Sunderland team news",
        snippet: "Haaland leads the line.",
        date: "2026-09-09T17:47:51.000Z",
      },
    ]);
    expect(block).toContain("9 Sep");
    expect(block).not.toContain("T17:47:51");
  });

  it("groups desk search evidence by tier when tiers are present", () => {
    const block = formatSearchEvidence([
      {
        id: "S1",
        title: "xG report",
        snippet: "City 2.1 xG last five.",
        date: "2026-09-09",
        tier: "analytics",
      },
      {
        id: "S2",
        title: "Team news",
        snippet: "Rodri still out.",
        date: "2026-09-09",
        tier: "news",
      },
    ]);
    expect(block).toContain("ANALYTICS EVIDENCE");
    expect(block).toContain("NEWS EVIDENCE");
    expect(block).toContain("[[S1]]");
    expect(block).toContain("[[S2]]");
  });
});

describe("desk football-take floor", () => {
  it("writes a schematic take without board numbers or current-news claims", () => {
    const take = composeDeskFootballTake(match());
    expect(take).toMatch(/Manchester City should control this at home/);
    expect(take).toMatch(/Sunderland only get a result/);
    expect(take).toMatch(/team-strength view/);
    expect(take).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(take).not.toMatch(/EV%|captured decimal|2\.70|Etihad|injured|manager/i);
    expect(stripDeskBoardRecitals(take)).toBe(take);
  });

  it("treats a conflict notice as empty remainder and keeps a briefing restorable", () => {
    expect(deskProseIsCurrentNewsRemainder(
      "Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe(true);
    expect(deskProseIsCurrentNewsRemainder(
      "City should control this at home. Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe(false);
    expect(shouldRestoreDeskFootballTake("Give me the match briefing for Arsenal vs Leeds United.")).toBe(true);
    expect(shouldRestoreDeskFootballTake("Tactical matchup")).toBe(true);
    expect(shouldRestoreDeskFootballTake("What is the latest team news?")).toBe(false);
    expect(stripSurplusCurrentNewsNotices(
      "Arsenal should control this at home. Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe("Arsenal should control this at home.");
  });
});

describe("desk qualitative voice", () => {
  it("forbids MiniMax from printing the board, 2.70, or a stadium", () => {
    expect(DESK_SYSTEM).toMatch(/Do not print probabilities/);
    expect(DESK_SYSTEM).toMatch(/Do not name a stadium/);
    expect(DESK_SYSTEM).not.toMatch(/Put a number on it/);
    expect(DESK_SYSTEM).toMatch(/"2\.70"/);
    const prompt = card(match());
    expect(prompt).toContain("Manchester City are at home");
    expect(prompt).toContain("Elo Manchester City 1950 vs Sunderland 1520");
    expect(prompt).toContain("Form Manchester City WWD");
    expect(prompt).toContain("Manchester City: 2nd, 10 pts");
    expect(prompt).not.toMatch(/\d+%/);
    expect(prompt).not.toMatch(/Etihad|2\.70|Old Trafford/i);
  });

  it("strips board recitals and keeps the football sentence", () => {
    const dump = [
      "United vs City at the Etihad, derby frame, and I puts City around 53% to win with a 26% draw and 21% home win.",
      "City walk into the fixture without a corresponding blow named on the list, so the visitors keep their structure intact.",
      "The engine sees it tight on goals — Over 2.5 at 51% versus Under at 49%.",
      "Totals sit near even because every match uses the same 2.70 expected goals.",
      "The modal scoreline is 1-1 at 13%.",
      "City 21 / 26 / 53 on the 1X2.",
    ].join(" ");
    const clean = stripDeskBoardRecitals(dump);
    expect(clean).toContain("City walk into the fixture");
    expect(clean).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(clean).not.toMatch(/Etihad|2\.70|the engine|1x2|BTTS|modal/i);
    expect(clean).not.toMatch(/\b21\s*\/\s*26\s*\/\s*53\b/);
  });
});
