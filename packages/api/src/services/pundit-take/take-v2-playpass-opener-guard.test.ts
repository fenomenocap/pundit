import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import type { Grounding } from "../ask";
import { attachUserLine, buildMatchPricing } from "../response-correctness";
import { isExactDeterministicPassPlayOpener } from "./take-pass-play-opener";
import { applyV2TakeProseGuards } from "./take-number-check";
import { buildPunditTakePlan } from "./take-plan";

function arsenalGrounding(): Grounding {
  const pHome = 0.763;
  const pDraw = 0.15;
  const pAway = 0.087;
  const pricing = attachUserLine(
    buildMatchPricing({
      fixtureId: "eng.1:401878768",
      home: "Arsenal",
      away: "Everton",
      kickoff: "2026-10-24T14:00:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: "2026-10-20T12:00:00.000Z",
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    { outcome: "home", decimalOdds: 1.33 },
  );
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401878768",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-24",
    stage: "Regular Season",
    home: "Arsenal",
    away: "Everton",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.5,
    pUnder2_5: 0.5,
    pBttsYes: 0.5,
    pBttsNo: 0.5,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing,
    freshness: sampleAgentFreshness({ modelLastUpdated: "2026-10-20T12:00:00.000Z" }),
    homeForm: [],
    awayForm: [],
    homeTable: { position: 2, points: 18, goalDifference: 6, playedGames: 8 },
    awayTable: { position: 8, points: 10, goalDifference: 1, playedGames: 8 },
    homeScorers: [],
    awayScorers: [],
    homeElo: 1900,
    awayElo: 1750,
    lambdaHome: 1.5,
    lambdaAway: 1.2,
    totalXg: 2.7,
  };
}

describe("Deterministic pass/play opener numeric guard", () => {
  it("recognises exact opener lines only", () => {
    expect(isExactDeterministicPassPlayOpener("Arsenal v Everton — No call on Arsenal at 1.33.")).toBe(true);
    expect(
      isExactDeterministicPassPlayOpener(
        "No call on Arsenal at 1.33, though Saka is 3.75 to score first.",
      ),
    ).toBe(false);
  });

  it("drops a No call line that smuggles an extra decimal past the user price", () => {
    const plan = buildPunditTakePlan(arsenalGrounding(), null);
    const exact = "Arsenal v Everton — No call on Arsenal at 1.33.";
    const polluted =
      "No call on Arsenal at 1.33, though Saka is 3.75 to score first.";
    expect(applyV2TakeProseGuards(`${exact}\n\nThat price implies 75.2%; I have Arsenal at 76.3%.`, plan))
      .toContain(exact);
    expect(applyV2TakeProseGuards(polluted, plan)).toBe("");
  });
});
