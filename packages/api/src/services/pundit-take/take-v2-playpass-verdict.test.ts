import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import type { Grounding } from "../ask";
import { attachUserLine, buildMatchPricing } from "../response-correctness";
import { formatPassPlayLineTable } from "./take-pass-play-table";
import { renderPassPlayTakeProse } from "./take-grid-prose";
import { resolvePassPlayVerdict } from "./take-pass-play-verdict";
import type { PunditTakePlan } from "./types";

const planStub = {
  fixtureLabel: "Chelsea v Tottenham",
  supporting: [],
} as Pick<PunditTakePlan, "fixtureLabel" | "supporting"> as PunditTakePlan;

function chelseaSpursGrounding(pHome: number, decimalOdds: number): Grounding {
  const pDraw = 0.244;
  const pAway = Math.max(0.01, 1 - pHome - pDraw);
  const pricing = attachUserLine(
    buildMatchPricing({
      fixtureId: "eng.1:401878767",
      home: "Chelsea",
      away: "Tottenham",
      kickoff: "2026-10-25T17:30:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: "2026-10-20T12:00:00.000Z",
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    { outcome: "home", decimalOdds },
  );
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401878767",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-25",
    stage: "Regular Season",
    home: "Chelsea",
    away: "Tottenham",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing,
    freshness: sampleAgentFreshness({
      espnLastUpdated: "2026-10-20T12:00:00.000Z",
      modelLastUpdated: "2026-10-20T12:00:00.000Z",
      ratingsAsOf: "2026-10-13T01:46:00.000Z",
    }),
    homeElo: 1840,
    awayElo: 1820,
    lambdaHome: 1.55,
    lambdaAway: 1.35,
    totalXg: 2.9,
    homeForm: [],
    awayForm: [],
    homeTable: { position: 4, points: 15, goalDifference: 5, playedGames: 8 },
    awayTable: { position: 7, points: 12, goalDifference: 2, playedGames: 8 },
    homeScorers: [],
    awayScorers: [],
  };
}

function tableCall(grounding: Grounding): string {
  const row = formatPassPlayLineTable(grounding).split("\n").pop() ?? "";
  const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.at(-1) ?? "";
}

function proseBand(prose: string): "Play" | "Pass" | "No call" {
  if (/\bI play\b/i.test(prose)) return "Play";
  if (/will not call/i.test(prose)) return "No call";
  return "Pass";
}

describe("Take v2 play/pass verdict alignment", () => {
  it("Pass band: near-fair Chelsea at 1.70 (+0.6 pts, decimal below passPrice)", () => {
    const grounding = chelseaSpursGrounding(0.594, 1.7);
    expect(resolvePassPlayVerdict(grounding)!.tableCall).toBe("Pass");
    expect(tableCall(grounding)).toBe("Pass");
    const prose = renderPassPlayTakeProse(planStub, grounding)!;
    expect(proseBand(prose)).toBe("Pass");
    expect(prose).toMatch(/I pass on Chelsea at 1\.70/i);
    expect(prose).not.toMatch(/\bI play\b|will not call/i);
  });

  it("No call band: short-priced favourite at 1.33 (+1.1 pts, between pass and play prices)", () => {
    const grounding = chelseaSpursGrounding(0.7629, 1.33);
    expect(resolvePassPlayVerdict(grounding)!.decision).toBe("abstain");
    expect(tableCall(grounding)).toBe("No call");
    const prose = renderPassPlayTakeProse(planStub, grounding)!;
    expect(proseBand(prose)).toBe("No call");
    expect(prose).toMatch(/I will not call Chelsea at 1\.33/i);
    expect(prose).not.toMatch(/\bI play\b/i);
  });

  it("Play band: Chelsea at 1.75 clears playPrice", () => {
    const grounding = chelseaSpursGrounding(0.594, 1.75);
    expect(tableCall(grounding)).toBe("Play");
    const prose = renderPassPlayTakeProse(planStub, grounding)!;
    expect(proseBand(prose)).toBe("Play");
    expect(prose).toMatch(/Chelsea at 1\.75.*I play/i);
  });
});
