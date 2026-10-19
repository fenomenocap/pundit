import type { OddsSource } from "./ask";
import { getCachedFixtureMarketOdds } from "./model-market-odds";
import { getCachedModelData, type ModelFixture } from "./model-data";
import type { OneXTwoOutcome } from "./response-correctness";

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

const asPercentNumber = (probability: number) => Math.round(probability * 1000) / 10;
const percentGap = (left: number, right: number) => Math.round((left - right) * 10) / 10;

export interface SlateGapHighlight {
  fixtureLabel: string;
  source: string;
  observedAt: string;
  outcome: OneXTwoOutcome;
  label: string;
  modelPercent: number;
  marketPercent: number;
  gapPoints: number;
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
        source: source.source,
        observedAt: source.observedAt,
        outcome,
        label: labels[outcome],
        modelPercent,
        marketPercent,
        gapPoints: percentGap(modelPercent, marketPercent),
      });
    }
  }
  return highlights;
}

/** Largest absolute model-vs-market gap across every priced fixture on the active slate. */
export function largestSlateModelMarketGap(): SlateGapHighlight | null {
  const fixtures = getCachedModelData().fixtures;
  let best: SlateGapHighlight | null = null;
  for (const fixture of fixtures) {
    for (const row of gapsForFixture(fixture)) {
      if (!best || Math.abs(row.gapPoints) > Math.abs(best.gapPoints)) best = row;
    }
  }
  return best;
}
