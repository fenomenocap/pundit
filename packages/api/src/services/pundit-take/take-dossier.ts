import type { Grounding } from "../ask";
import { matchDossierEnabled } from "../match-dossier/flags";
import { readMatchDossier } from "../match-dossier/storage";
import type { MatchDossier } from "../match-dossier/types";
import { consumeTakeDossier } from "./flags";

/** Resolve dossier for take compose: injected scope first, then stored file. */
export function resolveTakeDossier(
  grounding: Grounding,
  explicit: MatchDossier | null = null,
): MatchDossier | null {
  if (explicit) return explicit;
  const injected = consumeTakeDossier();
  if (injected) return injected;
  if (grounding.kind !== "match" || !matchDossierEnabled()) return null;
  return readMatchDossier(grounding.fixtureId);
}

export function prefetchStoredTakeDossier(grounding: Grounding): MatchDossier | null {
  if (grounding.kind !== "match" || !matchDossierEnabled()) return null;
  return readMatchDossier(grounding.fixtureId);
}
