import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGrounding } from "../ask";
import { buildMatchPricing } from "../response-correctness";
import { sampleMatchContextFields } from "../match-context";
import { sampleAgentFreshness } from "../../config/freshness-policy";
import { fixture } from "../__fixtures__/model-fixture";
import { replaceModelDataForTests } from "../model-data";
import { replaceFootballDataForTests, replaceSeasonScheduleForTests } from "../football-data";
import { composeMatchResponse } from "../response-composer";
import { planResponse } from "../response-plan";
import { withPunditTakeRequestScope } from "./flags";
import {
  countMarkdownTables,
  TAKE_PROSE_BANNED_PATTERN,
  validateTakeProseAgainstPlan,
} from "./take-validate";
import { composePunditTakeDelivery } from "./compose";

function spursCoventryGrounding() {
  const pHome = 0.599;
  const pDraw = 0.244;
  const pAway = 0.157;
  const observedAt = "2026-10-18T09:30:00.000Z";
  const oddsSources = [{
    source: "kalshi" as const,
    observedAt,
    pHome: 0.625,
    pDraw: 0.208,
    pAway: 0.168,
  }];
  return {
    kind: "match" as const,
    fixtureId: "espn:eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: "Tottenham",
    away: "Coventry",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    topScores: [{ score: "2-1", probability: 0.102 }],
    scorelines: [{ score: "1-1", probability: 0.116 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: [{
      source: "kalshi" as const,
      observedAt,
      legs: [
        { outcome: "home" as const, label: "Tottenham", modelPercent: 59.9, marketPercent: 62.5, gapPoints: -2.6 },
        { outcome: "draw" as const, label: "the draw", modelPercent: 24.4, marketPercent: 20.8, gapPoints: 3.6 },
        { outcome: "away" as const, label: "Coventry", modelPercent: 15.7, marketPercent: 16.8, gapPoints: -1.1 },
      ],
      largest: { outcome: "draw" as const, label: "the draw", modelPercent: 24.4, marketPercent: 20.8, gapPoints: 3.6 },
    }],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: "Tottenham",
      away: "Coventry",
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "clubelo@1:e92896aabcd0001",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: oddsSources.map((source) => ({
        source: source.source,
        observedAt: source.observedAt,
        pHome: source.pHome,
        pDraw: source.pDraw,
        pAway: source.pAway,
        impliedDisplayDecimals: true,
        decimalOdds: {
          home: 1 / source.pHome,
          draw: 1 / source.pDraw,
          away: 1 / source.pAway,
        },
      })),
    }),
    freshness: sampleAgentFreshness({
      marketOddsLastUpdated: observedAt,
      modelLastUpdated: observedAt,
      ratingsAsOf: "2026-10-13T01:46:00.000Z",
    }),
    ...sampleMatchContextFields({
      homeElo: 1799,
      awayElo: 1706,
      homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
      awayTable: { position: 16, points: 6, goalDifference: -4, playedGames: 8 },
    }),
  };
}

describe("Pundit Take v2 style pack (PR1)", () => {
  const prevEnv = process.env;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-take-"));
    process.env = { ...prevEnv, PUNDIT_DATA_DIR: dataDir, PUNDIT_TAKE_V2: "false" };
    const modelRow = fixture("Tottenham", "Coventry", {
      fixtureId: 401879257,
      utcDate: "2026-10-18T15:00:00.000Z",
      date: "2026-10-18",
      pHome: 0.599,
      pDraw: 0.244,
      pAway: 0.157,
      homeElo: 1799,
      awayElo: 1706,
    });
    replaceModelDataForTests({ fixtures: [modelRow], lastUpdated: new Date(), error: null });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: [],
      lastUpdated: new Date(),
      error: null,
      servingLastGood: false,
    });
    vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
    replaceFootballDataForTests({
      byCompetition: {
        "eng.1": {
          upcoming: [],
          recent: [],
          standings: [{
            competitionId: "eng.1",
            position: 20,
            team: "Tottenham",
            playedGames: 8,
            won: 0,
            draw: 3,
            lost: 5,
            points: 3,
            goalsFor: 4,
            goalsAgainst: 16,
            goalDifference: -12,
            group: null,
            advanced: false,
          }],
          error: null,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = prevEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const prompts = [
    "Who wins Tottenham v Coventry?",
    "Fair odds vs market for Tottenham v Coventry?",
    "Why?",
  ] as const;

  it("flag-off composeMatchResponse matches legacy path", () => {
    const grounding = spursCoventryGrounding();
    const q = prompts[0];
    const plan = planResponse(q, { groundingKind: "match", hasCompleteMarket1x2: true });
    const legacy = composeMatchResponse(q, grounding, plan);
    expect(legacy).toMatch(/59\.9%|Spurs/);
    expect(legacy).toMatch(/Model:/);
    expect(legacy).not.toContain("| Outcome | Ours |");
  });

  for (const q of prompts) {
    it(`take v2 bans labels and tokens for: ${q}`, () => {
      const grounding = spursCoventryGrounding();
      const plan = planResponse(q, {
        groundingKind: "match",
        hasCompleteMarket1x2: true,
        hasHistory: q === "Why?",
      });
      const delivery = withPunditTakeRequestScope("v2", () => {
        const fromComposer = composeMatchResponse(q, grounding, plan);
        const direct = composePunditTakeDelivery(q, grounding, plan);
        expect(direct?.answer).toBe(fromComposer);
        return direct!;
      });
      if (q.includes("Fair odds")) {
        expect(delivery.answer).toMatch(/looks (light|rich) at/i);
        expect(delivery.answer).toContain("| Outcome | Ours |");
        return;
      }
      const proseBlock = delivery.answer.split("\n\n| Outcome |")[0].split("\n\nModel ")[0];
      const prose = proseBlock.split("\n\n")[0];
      expect(TAKE_PROSE_BANNED_PATTERN.test(prose)).toBe(false);
      expect(prose).not.toMatch(/^Why:/m);
      expect(prose).not.toMatch(/^Lean:/m);
      expect(countMarkdownTables(delivery.answer)).toBeLessThanOrEqual(1);
      expect(validateTakeProseAgainstPlan(prose, delivery.plan).filter((e) => e !== "banned-token")).toEqual([]);
      expect(delivery.sources.odds.length).toBeGreaterThan(0);
      expect(delivery.answer).toContain("| Outcome | Ours |");
    });
  }

  it("thin dossier shortens prose without padding injuries", () => {
    const grounding = spursCoventryGrounding();
    const plan = planResponse(prompts[0], { groundingKind: "match", hasCompleteMarket1x2: true });
    const delivery = composePunditTakeDelivery(prompts[0], grounding, plan)!;
    expect(delivery.plan.contradicting.some((p) => p.id === "fact-injuries")).toBe(false);
    expect(delivery.plan.supporting.some((p) => p.id === "fact-table-standings")).toBe(true);
    expect(delivery.answer).toMatch(/20th.*3 points|three clear of 20th-placed/i);
      expect(delivery.answer).not.toMatch(/\bstill\b/i);
      expect(delivery.answer).not.toMatch(/sharper than my read/i);
      const proseBody = delivery.answer.split("\n\n| Outcome |")[0].split("\n\nModel ")[0];
      expect(proseBody).not.toMatch(/applied in this forecast|sits at|home backing|rating sheet|\bElo\b/i);
      expect(delivery.answer).toMatch(/at home/);
  });

  it("take v2 BTTS and totals avoid Lean labels", () => {
    const grounding = spursCoventryGrounding();
    for (const [q, mode] of [
      ["BTTS for Tottenham v Coventry?", "btts"],
      ["Over 2.5 Tottenham v Coventry?", "totals"],
    ] as const) {
      const plan = planResponse(q, { groundingKind: "match", hasCompleteMarket1x2: true });
      expect(plan.mode).toBe(mode);
      const delivery = withPunditTakeRequestScope("v2", () =>
        composePunditTakeDelivery(q, grounding, plan)!);
      expect(delivery.answer).not.toMatch(/^Lean:/m);
      expect(delivery.answer).toMatch(/BTTS yes at 52\.0%|Over 2\.5 at 55\.0%/);
      expect(delivery.answer).toContain("| Outcome | Ours |");
      expect(delivery.answer).not.toMatch(/1\.35 xG|1\.85 xG|on this read|low-score correction|home backing/i);
      expect(delivery.plan.marketKind).toBe(mode === "btts" ? "btts" : "totals");
    }
  });

  it("no-market fixture uses No price yet table", () => {
    const grounding = spursCoventryGrounding();
    grounding.marketDivergence = [];
    grounding.oddsSources = [];
    grounding.pricing.markets = [];
    const plan = planResponse(prompts[0], { groundingKind: "match", hasCompleteMarket1x2: false });
    const delivery = withPunditTakeRequestScope("v2", () =>
      composePunditTakeDelivery(prompts[0], grounding, plan)!);
    expect(delivery.answer).toContain("No price yet.");
    expect(delivery.plan.hasCompleteMarket).toBe(false);
  });
});
