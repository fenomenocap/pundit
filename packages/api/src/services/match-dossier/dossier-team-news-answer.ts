import type { Grounding } from "../ask";
import { compactTeamLabel, formatTimestampSgt } from "../basics-answer-voice";
import { formatFplInjuryFact } from "../pundit-take/take-fpl-injuries";
import type { DossierEvidenceItem, MatchDossier } from "./types";
import { isFplBootstrapInjuryItem } from "./types";

function clubSideLabel(club: string, grounding: Grounding): string {
  const normalized = club.trim().toLowerCase();
  if ([grounding.home, compactTeamLabel(grounding.home)].some((c) => c.toLowerCase() === normalized)) {
    return grounding.home;
  }
  if ([grounding.away, compactTeamLabel(grounding.away)].some((c) => c.toLowerCase() === normalized)) {
    return grounding.away;
  }
  return club;
}

function itemsForClub(items: DossierEvidenceItem[], clubLabel: string): DossierEvidenceItem[] {
  const normalized = clubLabel.trim().toLowerCase();
  return items.filter((item) => item.club
    && [item.club, compactTeamLabel(item.club)].some((c) => c.toLowerCase() === normalized));
}

function renderClubBlock(
  clubLabel: string,
  items: DossierEvidenceItem[],
): string[] {
  const lines: string[] = [];
  const facts = items
    .filter(isFplBootstrapInjuryItem)
    .map((item) => formatFplInjuryFact(item))
    .filter((line): line is string => Boolean(line));
  if (!facts.length) {
    lines.push(`No confirmed absences listed for ${clubLabel}.`);
    return lines;
  }
  lines.push(...facts);
  return lines;
}

function latestFplAsOfSgt(items: DossierEvidenceItem[]): string | null {
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const ts = Date.parse(item.newsAddedAt ?? item.publishedAt ?? "");
    if (!Number.isNaN(ts) && ts > maxTs) maxTs = ts;
  }
  if (!Number.isFinite(maxTs)) return null;
  return formatTimestampSgt(new Date(maxTs).toISOString());
}

/**
 * Deterministic team-news answer from fixture-first `dossier.teamNews` only (no web search).
 */
export function composeFixtureFirstTeamNewsAnswer(
  grounding: Grounding,
  dossier: MatchDossier,
): string {
  const items = dossier.teamNews?.value.items ?? [];
  const homeItems = itemsForClub(items, grounding.home);
  const awayItems = itemsForClub(items, grounding.away);
  const blocks = [
    ...renderClubBlock(grounding.home, homeItems),
    ...renderClubBlock(grounding.away, awayItems),
  ];
  const asOf = latestFplAsOfSgt(items);
  if (asOf) {
    blocks.push(`FPL injury status (as of ${asOf}).`);
  }
  blocks.push("These are FPL availability flags for this fixture, not a revised match forecast or confirmed lineup.");
  return blocks.join("\n");
}

export function isFixtureFirstTeamNewsQuestion(question: string): boolean {
  return /\b(?:injur(?:y|ies|ed)|suspension|availability|team news|(?:predicted|probable|expected|likely|confirmed|official|starting)\s+line-?ups?|line-?ups?\s+(?:news|updates?|reports?)|starting (?:xi|eleven))\b/i.test(question)
    || /\bwho(?:'s| is| are)\s+missing\b/i.test(question)
    || /\bany injuries?\b/i.test(question);
}
