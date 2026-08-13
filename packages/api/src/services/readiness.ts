import type { ActiveFixture } from "./active-fixtures";
import {
  ModelDataCache,
  modelDataCoversActiveFixtures,
} from "./model-data";

interface FootballReadiness {
  lastUpdated: Date | null;
  error: string | null;
}

interface MarketOddsReadiness {
  ready: boolean;
  lastUpdated: Date | null;
  error: string | null;
}

export interface ReadinessState {
  ready: boolean;
  modelReady: boolean;
  footballReady: boolean;
  marketOddsReady: boolean;
}

export function evaluateReadiness(
  model: ModelDataCache,
  football: FootballReadiness,
  activeFixtures: ActiveFixture[],
  marketOdds: MarketOddsReadiness
): ReadinessState {
  // A failed refresh may retain an exact last-good fixture set. That remains
  // usable; a cold/empty/stale model does not.
  const modelReady = modelDataCoversActiveFixtures(model, activeFixtures);
  const footballReady = football.lastUpdated !== null && football.error === null;
  const marketOddsReady = marketOdds.ready && marketOdds.lastUpdated !== null;

  return {
    // Search and public market feeds are explicitly degradable. Only the
    // football authority and active model are startup/readiness dependencies.
    ready: modelReady && footballReady,
    modelReady,
    footballReady,
    marketOddsReady,
  };
}
