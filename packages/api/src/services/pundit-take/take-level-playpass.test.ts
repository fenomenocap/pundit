import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import type { Grounding } from "../ask";
import { attachUserLine, buildMatchPricing, type OneXTwoOutcome } from "../response-correctness";
import { planResponse } from "../response-plan";
import { composePunditTakeDelivery } from "./compose";
import { withPunditTakeRequestScope, type PunditTakeMode } from "./flags";
import { formatPassPlayLineTable } from "./take-pass-play-table";
import { applyV2TakeProseGuards } from "./take-number-check";
import { buildPunditTakePlan } from "./take-plan";
import { renderPassPlayTakeProse } from "./take-grid-prose";
import { resolvePassPlayVerdict } from "./take-pass-play-verdict";

/** Crystal Palace v Newcastle as served on 22 Oct (sweep prod-a7a561d): 0.3587 / 0.2827 / 0.3587, gap 0.0 pts. */
function palNewGrounding(
  probs: { pHome: number; pDraw: number; pAway: number },
  line: { outcome: OneXTwoOutcome; decimalOdds: number },
): Grounding {
  const { pHome, pDraw, pAway } = probs;
  const pricing = attachUserLine(
    buildMatchPricing({
      fixtureId: "eng.1:401879254",
      home: "Crystal Palace",
      away: "Newcastle",
      kickoff: "2026-10-25T14:00:00.000Z",
      modelVersion: "clubelo@1:test",
      pricedAt: "2026-10-22T12:00:00.000Z",
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    line,
  );
  return {
    kind: "match",
    fixtureId: "espn:eng.1:401879254",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-25",
    stage: "Regular Season",
    home: "Crystal Palace",
    away: "Newcastle",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.6,
    pBttsNo: 0.4,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing,
    freshness: sampleAgentFreshness({ modelLastUpdated: "2026-10-22T12:00:00.000Z" }),
    homeForm: [],
    awayForm: [],
    homeTable: { position: 14, points: 7, goalDifference: -2, playedGames: 8 },
    awayTable: { position: 11, points: 8, goalDifference: 0, playedGames: 8 },
    homeScorers: [],
    awayScorers: [],
    homeElo: 1780,
    awayElo: 1790,
    lambdaHome: 1.4,
    lambdaAway: 1.35,
    totalXg: 2.75,
  };
}

const LEVEL = { pHome: 0.3587, pDraw: 0.2827, pAway: 0.3587 };
/** #392 unequal-rounded variant: raw gap 1.5 pts, rounded 37 v 36. */
const NEAR_TIE = { pHome: 0.37, pDraw: 0.275, pAway: 0.355 };
/** #392 side-v-draw variant: home and draw within 2 pts. */
const SIDE_V_DRAW = { pHome: 0.35, pDraw: 0.34, pAway: 0.31 };
/** Control: clear home favourite (not level). */
const NOT_LEVEL = { pHome: 0.42, pDraw: 0.28, pAway: 0.3 };

function delivered(question: string, grounding: Grounding, scope: PunditTakeMode | null = null): string {
  return withPunditTakeRequestScope(scope, () => {
    const plan = planResponse(question, {
      groundingKind: "match",
      hasCompleteMarket1x2: false,
      hasUserLine: true,
      v2PlayPassResolver: true,
    });
    return composePunditTakeDelivery(question, grounding, plan)!.answer;
  });
}

function tableCall(answer: string): string {
  const row = answer.split("\n").find((l) => /^\| Crystal Palace |^\| Newcastle |^\| Draw /i.test(l)) ?? "";
  return row.split("|").map((c) => c.trim()).filter(Boolean).at(-1) ?? "";
}

function proseOf(answer: string): string {
  return answer.split("\n\n| Side")[0]!;
}

/** The three sweep play/pass phrasings at a price above fair (3.09 v fair 2.79). */
const SWEEP_VARIANTS = [
  { type: "playpass", question: "Crystal Palace at 3.09 in Crystal Palace v Newcastle, play or pass?" },
  { type: "playpass_rev", question: "Play or pass: Crystal Palace at 3.09 in Crystal Palace v Newcastle?" },
  { type: "playpass_club", question: "Crystal Palace at 3.09, play or pass?" },
];

describe("level 1X2: a user-quoted price never plays or names a side (types.ts levelNoSide)", () => {
  it.each(SWEEP_VARIANTS)("$type at 3.09 on a level fixture → Pass with level wording", ({ question }) => {
    const grounding = palNewGrounding(LEVEL, { outcome: "home", decimalOdds: 3.09 });
    const answer = delivered(question, grounding);
    const prose = proseOf(answer);
    expect(prose).toMatch(/^Crystal Palace v Newcastle — level at 36% each; I have no side\./);
    expect(prose).toMatch(/I pass at 3\.09; with no side, I don't play a quoted price\./);
    expect(prose).not.toMatch(/\bI play\b|small play|strong play|\bplay —/i);
    expect(prose).not.toMatch(/I have Crystal Palace at|Crystal Palace at 3\.09|I pass on Crystal Palace/i);
    expect(prose).not.toMatch(/The value is|I'd shift if|What flips it/i);
    expect(tableCall(answer)).toBe("Pass");
    expect(answer).not.toMatch(/\| Play \|/);
  });

  it.each(SWEEP_VARIANTS)("$type: verdict and table are Pass even though the price is above fair", ({ question }) => {
    const grounding = palNewGrounding(LEVEL, { outcome: "home", decimalOdds: 3.09 });
    const verdict = resolvePassPlayVerdict(grounding)!;
    expect(verdict.gapPoints).toBeGreaterThan(0);
    expect(verdict.levelNoSide).toBe(true);
    expect(verdict.decision).toBe("pass");
    expect(verdict.tableCall).toBe("Pass");
    expect(formatPassPlayLineTable(grounding)).toMatch(/\| Pass \|$/);
    expect(delivered(question, grounding, "v2")).toBe(delivered(question, grounding, null));
  });

  it("away side and draw quotes on a level fixture also Pass with no side named", () => {
    for (const line of [
      { outcome: "away" as const, decimalOdds: 3.4, question: "Newcastle at 3.40, play or pass?" },
      { outcome: "draw" as const, decimalOdds: 4.2, question: "The draw at 4.20 in Crystal Palace v Newcastle, play or pass?" },
    ]) {
      const grounding = palNewGrounding(LEVEL, line);
      expect(resolvePassPlayVerdict(grounding)!.tableCall).toBe("Pass");
      const prose = renderPassPlayTakeProse(buildPunditTakePlan(grounding, null), grounding)!;
      expect(prose).toMatch(/level at 36% each; I have no side\./);
      expect(prose).toMatch(new RegExp(`I pass at ${line.decimalOdds.toFixed(2).replace(".", "\\.")};`));
      expect(prose).not.toMatch(/\bI play\b|I have Newcastle at|I pass on/i);
    }
  });

  it("near-fair and below-fair quotes on a level fixture keep Pass and use the level wording", () => {
    for (const decimalOdds of [2.81, 2.51]) {
      const grounding = palNewGrounding(LEVEL, { outcome: "home", decimalOdds });
      const answer = delivered(`Crystal Palace at ${decimalOdds.toFixed(2)} in Crystal Palace v Newcastle, play or pass?`, grounding);
      expect(proseOf(answer)).toMatch(/level at 36% each; I have no side\./);
      expect(proseOf(answer)).not.toMatch(/I pass on Crystal Palace/i);
      expect(tableCall(answer)).toBe("Pass");
    }
  });

  it("#392 unequal-rounded variant: 'level, 37% v 36%' and Pass at 3.09", () => {
    const grounding = palNewGrounding(NEAR_TIE, { outcome: "home", decimalOdds: 3.09 });
    const answer = delivered("Crystal Palace at 3.09, play or pass?", grounding);
    expect(proseOf(answer)).toMatch(/^Crystal Palace v Newcastle — level, 37% v 36%; I have no side\./);
    expect(proseOf(answer)).toMatch(/I pass at 3\.09;/);
    expect(proseOf(answer)).not.toMatch(/\bI play\b/i);
    expect(tableCall(answer)).toBe("Pass");
  });

  it("#392 side-v-draw variant: 'Crystal Palace or a draw' and Pass at 3.09", () => {
    const grounding = palNewGrounding(SIDE_V_DRAW, { outcome: "home", decimalOdds: 3.09 });
    const answer = delivered("Crystal Palace at 3.09, play or pass?", grounding);
    expect(proseOf(answer)).toMatch(/^Crystal Palace v Newcastle — Crystal Palace or a draw\. I can't split them, so no side\./);
    expect(proseOf(answer)).toMatch(/I pass at 3\.09;/);
    expect(proseOf(answer)).not.toMatch(/\bI play\b/i);
    expect(tableCall(answer)).toBe("Pass");
  });

  it("level prose survives the numeric guards intact", () => {
    const grounding = palNewGrounding(LEVEL, { outcome: "home", decimalOdds: 3.09 });
    const plan = buildPunditTakePlan(grounding, null);
    const raw = renderPassPlayTakeProse(plan, grounding)!;
    const guarded = applyV2TakeProseGuards(raw, plan);
    expect(guarded).toMatch(/level at 36% each; I have no side\. I pass at 3\.09; with no side, I don't play a quoted price\./);
  });

  it("control: a non-level fixture at a price above playPrice still plays", () => {
    const grounding = palNewGrounding(NOT_LEVEL, { outcome: "home", decimalOdds: 2.8 });
    const verdict = resolvePassPlayVerdict(grounding)!;
    expect(verdict.levelNoSide).toBe(false);
    expect(verdict.tableCall).toBe("Play");
    const answer = delivered("Crystal Palace at 2.80, play or pass?", grounding);
    expect(proseOf(answer)).toMatch(/Crystal Palace at 2\.80, (?:small play|play|strong play) — I play\./);
    expect(proseOf(answer)).not.toMatch(/no side/i);
  });
});
