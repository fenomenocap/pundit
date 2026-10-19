export * from "./types";
export * from "./flags";
export * from "./storage";
export * from "./builder";
export * from "./model-factor-breakdown";
export * from "./schedule";

import {
  buildMatchDossierForFixture,
  buildMatchDossierForFixtureAsync,
  findModelFixtureByDossierId,
  resolveFixtureFromRequestKey,
} from "./builder";
import { matchDossierEnabled } from "./flags";
import { readMatchDossier } from "./storage";
import type { MatchDossier } from "./types";

export interface GetMatchDossierResult {
  dossier: MatchDossier;
  source: "storage" | "built";
}

export async function getMatchDossier(
  fixtureKey: string,
  options?: { rebuild?: boolean },
): Promise<GetMatchDossierResult | null> {
  if (!matchDossierEnabled()) return null;
  const fixture = resolveFixtureFromRequestKey(fixtureKey) ?? findModelFixtureByDossierId(fixtureKey);
  if (!fixture) return null;
  const fixtureId = `espn:${fixture.competitionId}:${fixture.fixtureId}`;
  if (!options?.rebuild) {
    const stored = readMatchDossier(fixtureId);
    if (stored) return { dossier: stored, source: "storage" };
  }
  const dossier = await buildMatchDossierForFixtureAsync(fixture, { scheduleReason: "on-demand" });
  return { dossier, source: "built" };
}
