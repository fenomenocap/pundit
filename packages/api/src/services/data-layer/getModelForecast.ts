import { buildGrounding, type Grounding } from "../ask";
import { getCachedModelData, getModelFixtureKey, type ModelFixture } from "../model-data";
import { writeDataLayerSnapshot } from "./snapshot-store";
import type { DataLayerResult } from "./types";
import { wrapWithFreshness } from "./shared";

export interface GetModelForecastInput {
  fixture: ModelFixture;
}

export function getModelForecast(input: GetModelForecastInput): DataLayerResult<Grounding> {
  const model = getCachedModelData();
  const grounding = buildGrounding(input.fixture);
  const asOf = model.lastUpdated?.toISOString() ?? grounding.pricing.pricedAt;
  writeDataLayerSnapshot(grounding.fixtureId, asOf, {
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
    externalMarketConsensus: grounding.externalMarketConsensus ?? null,
    pricedAt: grounding.pricing.pricedAt,
  });
  return wrapWithFreshness(
    grounding,
    [{
      id: grounding.pricing.modelVersion,
      label: "Pundit Fundamental model",
      trustTier: "model-pin",
      observedAt: grounding.pricing.pricedAt,
    }],
    asOf,
    model.lastUpdated === null,
  );
}

export function getModelForecastByKey(fixtureKey: string): DataLayerResult<Grounding> | null {
  const model = getCachedModelData();
  const fixture = model.fixtures.find((row) => getModelFixtureKey(row) === fixtureKey);
  if (!fixture) return null;
  return getModelForecast({ fixture });
}
