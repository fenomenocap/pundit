import { describe, expect, it } from "vitest";
import type { Grounding } from "./ask";
import {
  filterDeskEvidenceRows,
  formatSearchEvidence,
  humaniseDeskCitationDates,
  sanitizeDeskModelProse,
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
  it("drops MiniMax-authored markdown links so stale pages cannot look cited", () => {
    const dumped = [
      "City at home, model says 82/15/4, Polymarket 78/15/7.",
      "The bench still waits on Rodri (ACL) ([City vs Sunderland](https://www.goal.com/old), 2025-12-04T09:23:37.534Z).",
      "Who decides it is the first ball in behind.",
    ].join(" ");
    const clean = sanitizeDeskModelProse(dumped, match());
    expect(clean).toContain("Who decides it is the first ball in behind.");
    expect(clean).not.toMatch(/Rodri/);
    expect(clean).not.toMatch(/goal\.com/);
    expect(clean).not.toMatch(/82\/15\/4/);
    expect(clean).not.toMatch(/Polymarket/i);
  });
});

describe("stripDeskBoardRecitals extras", () => {
  it("drops a Polymarket / xG numbered dump", () => {
    const clean = stripDeskBoardRecitals(
      "Lean is real. 1. The 1X2. Engine 81.9% home vs market 78.3%. "
      + "Sunderland's last four ran at 1.72 xG. Who decides it is the first goal."
    );
    expect(clean).toContain("Lean is real.");
    expect(clean).toContain("Who decides it is the first goal.");
    expect(clean).not.toMatch(/1X2/i);
    expect(clean).not.toMatch(/xG/);
    expect(clean).not.toMatch(/%/);
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
});
