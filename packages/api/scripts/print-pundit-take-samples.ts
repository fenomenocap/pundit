/**
 * Prints verbatim Pundit Take v2 samples (deterministic prose + table) for PR evidence.
 * Run: pnpm --filter @sports-predict/api exec tsx scripts/print-pundit-take-samples.ts
 */
import { buildMatchDossierForFixture, findModelFixtureByDossierId } from "../src/services/match-dossier/builder";
import { composePunditTakeDelivery } from "../src/services/pundit-take/compose";
import { withPunditTakeRequestScope } from "../src/services/pundit-take/flags";
import { planResponse } from "../src/services/response-plan";
import { buildMatchPricing } from "../src/services/response-correctness";
import { sampleMatchContextFields } from "../src/services/match-context";
import { sampleAgentFreshness } from "../src/config/freshness-policy";
import { fixture } from "../src/services/__fixtures__/model-fixture";
import { replaceModelDataForTests } from "../src/services/model-data";
import { replaceFootballDataForTests, replaceSeasonScheduleForTests } from "../src/services/football-data";
import type { Grounding } from "../src/services/ask";

function buildGrounding(partial: Partial<Grounding> & Pick<Grounding, "home" | "away" | "pHome" | "pDraw" | "pAway">): Grounding {
  const observedAt = "2026-10-18T09:30:00.000Z";
  const oddsSources = partial.oddsSources ?? [{
    source: "kalshi" as const,
    observedAt,
    pHome: 0.625,
    pDraw: 0.208,
    pAway: 0.168,
  }];
  const pHome = partial.pHome;
  const pDraw = partial.pDraw;
  const pAway = partial.pAway;
  return {
    kind: "match",
    fixtureId: partial.fixtureId ?? "espn:eng.1:401879257",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: partial.home,
    away: partial.away,
    pHome,
    pDraw,
    pAway,
    pOver2_5: partial.pOver2_5 ?? 0.55,
    pUnder2_5: partial.pUnder2_5 ?? 0.45,
    pBttsYes: partial.pBttsYes ?? 0.52,
    pBttsNo: partial.pBttsNo ?? 0.48,
    topScores: partial.topScores ?? [],
    scorelines: partial.scorelines ?? [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources,
    marketDivergence: partial.marketDivergence ?? [{
      source: "kalshi" as const,
      observedAt,
      legs: [
        { outcome: "home", label: partial.home, modelPercent: pHome * 100, marketPercent: 62.5, gapPoints: -2.6 },
        { outcome: "draw", label: "the draw", modelPercent: pDraw * 100, marketPercent: 20.8, gapPoints: 3.6 },
        { outcome: "away", label: partial.away, modelPercent: pAway * 100, marketPercent: 16.8, gapPoints: -1.1 },
      ],
      largest: { outcome: "draw", label: "the draw", modelPercent: pDraw * 100, marketPercent: 20.8, gapPoints: 3.6 },
    }],
    pricing: partial.pricing ?? buildMatchPricing({
      fixtureId: "eng.1:401879257",
      home: partial.home,
      away: partial.away,
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
    freshness: sampleAgentFreshness({ marketOddsLastUpdated: observedAt, modelLastUpdated: observedAt, ratingsAsOf: "2026-10-13T01:46:00.000Z" }),
    ...sampleMatchContextFields({
      homeElo: 1799,
      awayElo: 1706,
      homeTable: { position: 20, points: 3, goalDifference: -12, playedGames: 8 },
      awayTable: { position: 8, points: 14, goalDifference: 2, playedGames: 8 },
    }),
    ...partial,
  } as Grounding;
}

function seedModel(home: string, away: string, fixtureId: number, probs: { pHome: number; pDraw: number; pAway: number }) {
  replaceModelDataForTests({
    fixtures: [fixture(home, away, { fixtureId, ...probs, homeElo: 1799, awayElo: 1706, utcDate: "2026-10-18T15:00:00.000Z", date: "2026-10-18" })],
    lastUpdated: new Date(),
    error: null,
  });
  replaceSeasonScheduleForTests({ competitionId: "eng.1", seasonId: "2026-27", fixtures: [], lastUpdated: new Date(), error: null, servingLastGood: false });
  replaceFootballDataForTests({ byCompetition: { "eng.1": { upcoming: [], recent: [], standings: [], error: null } } });
}

function dossierFor(grounding: Grounding) {
  const fixture = findModelFixtureByDossierId(grounding.fixtureId);
  return fixture ? buildMatchDossierForFixture(fixture, { scheduleReason: "manual" }) : null;
}

function printCase(title: string, question: string, grounding: Grounding, hasHistory = false) {
  const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: grounding.marketDivergence.length > 0, hasHistory });
  const dossier = dossierFor(grounding);
  const delivery = withPunditTakeRequestScope("v2", () => composePunditTakeDelivery(question, grounding, plan, dossier));
  console.log(`\n=== ${title} ===\n`);
  console.log(delivery?.answer ?? "(no delivery)");
  console.log("\n--- plan JSON ---\n");
  console.log(JSON.stringify(delivery?.plan ?? null, null, 2));
}

seedModel("Tottenham", "Coventry", 401879257, { pHome: 0.599, pDraw: 0.244, pAway: 0.157 });
printCase("Who wins Tottenham v Coventry?", "Who wins Tottenham v Coventry?", buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 }));

printCase(
  "Fair odds vs market Tottenham v Coventry",
  "Fair odds vs market for Tottenham v Coventry?",
  buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 }),
);

seedModel("Tottenham", "Coventry", 401879257, { pHome: 0.599, pDraw: 0.244, pAway: 0.157 });
const noMarket = buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 });
noMarket.marketDivergence = [];
noMarket.oddsSources = [];
noMarket.pricing.markets = [];
printCase("No market", "Who wins Tottenham v Coventry?", noMarket);

const passPlayGrounding = buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 });
passPlayGrounding.pricing.userLine = {
  outcome: "home",
  decimalOdds: 1.55,
  playPrice: 1.54,
  passPrice: 1.56,
  capturedAt: "2026-10-18T09:30:00.000Z",
};
printCase("Pass or play (user line)", "pass or play?", passPlayGrounding);
printCase("BTTS", "BTTS for Tottenham v Coventry?", buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 }));
printCase("Over 2.5", "Over 2.5 Tottenham v Coventry?", buildGrounding({ home: "Tottenham", away: "Coventry", pHome: 0.599, pDraw: 0.244, pAway: 0.157 }));
