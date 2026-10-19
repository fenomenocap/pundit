import type { OddsSource } from "./ask";
import { getCachedFixtureMarketOdds } from "./model-market-odds";
import { getCachedModelData, type ModelFixture } from "./model-data";
import type { OneXTwoOutcome } from "./response-correctness";
import { formatBasicsDate } from "./basics-answer-voice";

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

const asPercentNumber = (probability: number) => Math.round(probability * 1000) / 10;

function percentGapFixed(left: number, right: number) {
  return Math.round((left - right) * 10) / 10;
}

export interface SlateGapHighlight {
  fixtureLabel: string;
  fixtureDay: string;
  source: string;
  observedAt: string;
  outcome: OneXTwoOutcome;
  label: string;
  modelPercent: number;
  marketPercent: number;
  gapPoints: number;
}

function fixtureDay(fixture: ModelFixture): string {
  return (fixture.utcDate ?? fixture.date).slice(0, 10);
}

function oddsSourcesForFixture(fixture: ModelFixture): OddsSource[] {
  const markets = getCachedFixtureMarketOdds(fixture);
  const rows: OddsSource[] = [];
  if (markets?.kalshi) {
    rows.push({ source: "kalshi", observedAt: markets.observedAt, ...markets.kalshi });
  }
  if (markets?.polymarket) {
    rows.push({ source: "polymarket", observedAt: markets.observedAt, ...markets.polymarket });
  }
  return rows;
}

function gapsForFixture(fixture: ModelFixture): SlateGapHighlight[] {
  const oddsSources = oddsSourcesForFixture(fixture);
  const labels: Record<OneXTwoOutcome, string> = {
    home: fixture.home,
    draw: "the draw",
    away: fixture.away,
  };
  const highlights: SlateGapHighlight[] = [];
  for (const source of oddsSources) {
    for (const outcome of OUTCOMES) {
      const market = outcome === "home" ? source.pHome : outcome === "draw" ? source.pDraw : source.pAway;
      const modelP = outcome === "home" ? fixture.pHome : outcome === "draw" ? fixture.pDraw : fixture.pAway;
      if (market == null || !Number.isFinite(market) || market <= 0 || market >= 1) continue;
      if (!Number.isFinite(modelP)) continue;
      const modelPercent = asPercentNumber(modelP);
      const marketPercent = asPercentNumber(market);
      highlights.push({
        fixtureLabel: `${fixture.home} v ${fixture.away}`,
        fixtureDay: fixtureDay(fixture),
        source: source.source,
        observedAt: source.observedAt,
        outcome,
        label: labels[outcome],
        modelPercent,
        marketPercent,
        gapPoints: percentGapFixed(modelPercent, marketPercent),
      });
    }
  }
  return highlights;
}

export function largestGapOnFixtures(fixtures: readonly ModelFixture[]): SlateGapHighlight | null {
  let best: SlateGapHighlight | null = null;
  for (const fixture of fixtures) {
    for (const row of gapsForFixture(fixture)) {
      if (!best || Math.abs(row.gapPoints) > Math.abs(best.gapPoints)) best = row;
    }
  }
  return best;
}

export function selectSlateForBestValue(now = new Date()): { fixtures: ModelFixture[]; label: string } {
  const today = now.toISOString().slice(0, 10);
  const fixtures = getCachedModelData().fixtures;
  const todayFixtures = fixtures.filter((row) => fixtureDay(row) === today);
  if (todayFixtures.length && largestGapOnFixtures(todayFixtures)) {
    return { fixtures: todayFixtures, label: `today (${formatBasicsDate(`${today}T12:00:00.000Z`)})` };
  }
  const upcoming = fixtures
    .filter((row) => fixtureDay(row) >= today)
    .sort((a, b) => fixtureDay(a).localeCompare(fixtureDay(b)));
  const days = [...new Set(upcoming.map(fixtureDay))];
  const first = days[0];
  if (!first) return { fixtures: [], label: "the priced slate" };
  const second = days[1];
  const useWeekendPair = second
    && (Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) <= 2 * 86400000;
  const slateDays = useWeekendPair ? [first, second] : [first];
  const slateFixtures = upcoming.filter((row) => slateDays.includes(fixtureDay(row)));
  const label = slateDays.length > 1
    ? `next slate (${formatBasicsDate(`${first}T12:00:00.000Z`)}–${formatBasicsDate(`${second!}T12:00:00.000Z`)})`
    : `next slate (${formatBasicsDate(`${first}T12:00:00.000Z`)})`;
  return { fixtures: slateFixtures, label };
}

export function largestSlateModelMarketGapForDemo(now = new Date()): {
  highlight: SlateGapHighlight | null;
  slateLabel: string;
} {
  const { fixtures, label } = selectSlateForBestValue(now);
  return { highlight: largestGapOnFixtures(fixtures), slateLabel: label };
}

/** Largest absolute model-vs-market gap across every priced fixture (unfiltered). */
export function largestSlateModelMarketGap(): SlateGapHighlight | null {
  return largestGapOnFixtures(getCachedModelData().fixtures);
}
