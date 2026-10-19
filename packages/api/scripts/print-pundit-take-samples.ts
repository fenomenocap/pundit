/**
 * Prints verbatim Pundit Take v2 samples for PR evidence.
 * Run: pnpm --filter @sports-predict/api exec tsx scripts/print-pundit-take-samples.ts
 */
import { buildGrounding } from "../src/services/ask";
import { buildMatchDossierForFixture } from "../src/services/match-dossier/builder";
import { buildMatchPricing } from "../src/services/response-correctness";
import { attachUserLine } from "../src/services/response-correctness";
import { postCheckTakeProseWithReport } from "../src/services/pundit-take/take-validate";
import { composePunditTakeDelivery } from "../src/services/pundit-take/compose";
import { withPunditTakeRequestScope } from "../src/services/pundit-take/flags";
import { buildPunditTakePlan } from "../src/services/pundit-take/take-plan";
import { renderTakeProseWithLlmDetailed } from "../src/services/pundit-take/take-llm";
import { planResponse } from "../src/services/response-plan";
import { fixture } from "../src/services/__fixtures__/model-fixture";
import { replaceModelDataForTests } from "../src/services/model-data";
import { replaceFootballDataForTests, replaceSeasonScheduleForTests } from "../src/services/football-data";
import type { Grounding } from "../src/services/ask";

const TABLE_AS_OF = "2026-10-18T09:00:00.000Z";

function seedSpursCoventryModel() {
  const modelRow = fixture("Tottenham", "Coventry", {
    fixtureId: 401879257,
    utcDate: "2026-10-18T15:00:00.000Z",
    date: "2026-10-18",
    pHome: 0.599,
    pDraw: 0.244,
    pAway: 0.157,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.52,
    pBttsNo: 0.48,
    homeElo: 1799,
    awayElo: 1706,
  });
  replaceModelDataForTests({ fixtures: [modelRow], lastUpdated: new Date(TABLE_AS_OF), error: null });
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "2026-27",
    fixtures: [],
    lastUpdated: new Date(TABLE_AS_OF),
    error: null,
    servingLastGood: false,
  });
  replaceFootballDataForTests({
    lastUpdated: new Date(TABLE_AS_OF),
    byCompetition: {
      "eng.1": {
        upcoming: [],
        recent: [],
        standings: [
          {
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
          },
          {
            competitionId: "eng.1",
            position: 16,
            team: "Coventry",
            playedGames: 8,
            won: 1,
            draw: 3,
            lost: 4,
            points: 6,
            goalsFor: 7,
            goalsAgainst: 11,
            goalDifference: -4,
            group: null,
            advanced: false,
          },
        ],
        error: null,
      },
    },
  });
  return modelRow;
}

function withKalshiMarket(grounding: Grounding): Grounding {
  const observedAt = "2026-10-18T09:30:00.000Z";
  const oddsSources = [{
    source: "kalshi" as const,
    observedAt,
    pHome: 0.625,
    pDraw: 0.208,
    pAway: 0.168,
  }];
  const pHome = grounding.pHome;
  const pDraw = grounding.pDraw;
  const pAway = grounding.pAway;
  return {
    ...grounding,
    oddsSources,
    marketDivergence: [{
      source: "kalshi" as const,
      observedAt,
      legs: [
        { outcome: "home" as const, label: grounding.home, modelPercent: pHome * 100, marketPercent: 62.5, gapPoints: -2.6 },
        { outcome: "draw" as const, label: "the draw", modelPercent: pDraw * 100, marketPercent: 20.8, gapPoints: 3.6 },
        { outcome: "away" as const, label: grounding.away, modelPercent: pAway * 100, marketPercent: 16.8, gapPoints: -1.1 },
      ],
      largest: { outcome: "draw" as const, label: "the draw", modelPercent: pDraw * 100, marketPercent: 20.8, gapPoints: 3.6 },
    }],
    pricing: buildMatchPricing({
      fixtureId: grounding.fixtureId.replace(/^espn:/, ""),
      home: grounding.home,
      away: grounding.away,
      kickoff: grounding.date,
      modelVersion: grounding.pricing.modelVersion,
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: oddsSources.map((source) => ({
        source: source.source,
        observedAt: source.observedAt,
        pHome: source.pHome,
        pDraw: source.pDraw!,
        pAway: source.pAway,
        impliedDisplayDecimals: true,
        decimalOdds: {
          home: 1 / source.pHome,
          draw: 1 / source.pDraw!,
          away: 1 / source.pAway,
        },
      })),
    }),
  };
}

function groundingFromModelRow(): Grounding {
  const modelRow = seedSpursCoventryModel();
  return withKalshiMarket(buildGrounding(modelRow));
}

function printCase(title: string, question: string, grounding: Grounding, hasHistory = false) {
  const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: grounding.marketDivergence.length > 0, hasHistory });
  const dossier = buildMatchDossierForFixture(
    fixture("Tottenham", "Coventry", { fixtureId: 401879257, pHome: 0.599, pDraw: 0.244, pAway: 0.157 }),
  );
  const delivery = withPunditTakeRequestScope("v2", () => composePunditTakeDelivery(question, grounding, plan, dossier));
  console.log(`\n=== ${title} ===\n`);
  console.log(delivery?.answer ?? "(no delivery)");
  console.log("\n--- sources (table) ---\n");
  console.log(JSON.stringify({
    tableSource: delivery?.sources.tableSource,
    tableAsOf: delivery?.sources.tableAsOf,
    tableAsOfSgt: delivery?.sources.tableAsOfSgt,
  }, null, 2));
}

seedSpursCoventryModel();
let g = groundingFromModelRow();

printCase("Who wins Tottenham v Coventry?", "Who wins Tottenham v Coventry?", g);
printCase("Fair odds vs market Tottenham v Coventry", "Fair odds vs market for Tottenham v Coventry?", g);

g = groundingFromModelRow();
g = {
  ...g,
  pricing: attachUserLine(g.pricing, { outcome: "home", decimalOdds: 1.55 }),
};
printCase("Pass or play (user line 1.55 home)", "pass or play?", g);

g = groundingFromModelRow();
printCase("BTTS", "BTTS for Tottenham v Coventry?", g);
printCase("Over 2.5", "Over 2.5 Tottenham v Coventry?", g);

async function printLlmSample() {
  g = groundingFromModelRow();
  const planJson = buildPunditTakePlan(g, null);
  const live = await renderTakeProseWithLlmDetailed(planJson);
  console.log("\n=== LLM path (OpenRouter when configured) ===\n");
  console.log(JSON.stringify(live, null, 2));

  const llmDraft = [
    "Spurs v Coventry — Spurs at 60%.",
    "Spurs are 20th on 3 points; Coventry are 16th on 6, and the market is more confident in Spurs than I am (63% v 60%).",
    "Tottenham always win these ties at home.",
    "The value is Draw at 4.81 against our fair 4.10.",
  ].join(" ");
  const recorded = postCheckTakeProseWithReport(llmDraft, planJson);
  console.log("\n=== Recorded LLM draft + post-check (same pipeline as prod when key is set) ===\n");
  console.log(JSON.stringify({ llmDraft, ...recorded }, null, 2));
}

printLlmSample().catch((err) => {
  console.error("\n=== LLM path failed ===\n", err);
});
