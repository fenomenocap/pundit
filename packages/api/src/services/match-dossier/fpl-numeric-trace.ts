import type { Grounding } from "../ask";
import { compactTeamLabel } from "../basics-answer-voice";
import type { MatchDossier } from "./types";
import { isFplBootstrapInjuryItem } from "./types";

function clubOnFixture(itemClub: string, grounding: Grounding): boolean {
  const normalized = itemClub.trim().toLowerCase();
  const candidates = [
    grounding.home,
    grounding.away,
    compactTeamLabel(grounding.home),
    compactTeamLabel(grounding.away),
  ].map((name) => name.trim().toLowerCase());
  return candidates.includes(normalized);
}

/** FPL `chance_of_playing` values (0–100) as 0–1 probabilities for numeric traceability. */
export function fplChanceProbabilitiesForTrace(
  dossier: MatchDossier | null,
  grounding: Grounding,
): number[] {
  if (!dossier) return [];
  const items = [
    ...(dossier.injuries?.value.items ?? []),
    ...(dossier.teamNews?.value.items ?? []),
  ].filter(isFplBootstrapInjuryItem);
  const probs: number[] = [];
  for (const item of items) {
    if (!item.club || !clubOnFixture(item.club, grounding)) continue;
    if (item.chanceOfPlaying == null || !Number.isFinite(item.chanceOfPlaying)) continue;
    probs.push(item.chanceOfPlaying / 100);
  }
  return probs;
}
