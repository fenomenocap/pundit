import type { EvidenceBundle, Grounding } from "../ask";
import { compactTeamLabel } from "../basics-answer-voice";
import type { DossierEvidenceItem, FplPlayerAvailabilityStatus, MatchDossier } from "./types";
import { isFplBootstrapInjuryItem } from "./types";

type FplAbsenceIndex = Map<string, FplPlayerAvailabilityStatus>;

const ABSENCE_CLAIM =
  /\b([A-Z][A-Za-zÀ-ÿ.'’-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’-]+){0,3})\s*(?:\([^)]+\))?\s*(?:was|is|are|remains|stays)\s+(?:also\s+)?(?:suspended|injured|doubtful|ruled out|unavailable|out)\b|\b([A-Z][A-Za-zÀ-ÿ.'’-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’-]+){0,3})\s*(?:\([^)]+\))?\s*(?:misses?|will miss|sits? out)\b/i;

const CLAIM_KIND =
  /\b(suspended|injured|doubtful|ruled out|unavailable|misses?|will miss|sits? out|\bout\b)\b/i;

function indexKey(club: string, player: string): string {
  return `${club.trim().toLowerCase()}::${player.trim().toLowerCase()}`;
}

function clubsForGrounding(grounding: Grounding): string[] {
  return [grounding.home, grounding.away, compactTeamLabel(grounding.home), compactTeamLabel(grounding.away)];
}

function buildFplAbsenceIndex(
  dossier: MatchDossier | null,
  grounding: Grounding,
): FplAbsenceIndex {
  const index: FplAbsenceIndex = new Map();
  if (!dossier) return index;
  const items = [
    ...(dossier.injuries?.value.items ?? []),
    ...(dossier.teamNews?.value.items ?? []),
  ].filter(isFplBootstrapInjuryItem);
  const allowedClubs = new Set(clubsForGrounding(grounding).map((c) => c.toLowerCase()));
  for (const item of items) {
    if (!item.player || !item.club || item.status == null) continue;
    if (!allowedClubs.has(item.club.trim().toLowerCase())
      && !allowedClubs.has(compactTeamLabel(item.club).toLowerCase())) continue;
    index.set(indexKey(item.club, item.player), item.status);
    index.set(indexKey(compactTeamLabel(item.club), item.player), item.status);
    const last = item.player.split(/\s+/).pop();
    if (last && last.length > 1) {
      index.set(indexKey(item.club, last), item.status);
      index.set(indexKey(compactTeamLabel(item.club), last), item.status);
    }
  }
  return index;
}

function lookupStatus(index: FplAbsenceIndex, club: string, player: string): FplPlayerAvailabilityStatus | undefined {
  return index.get(indexKey(club, player))
    ?? index.get(indexKey(compactTeamLabel(club), player))
    ?? index.get(indexKey(club, player.split(/\s+/).pop() ?? player))
    ?? index.get(indexKey(compactTeamLabel(club), player.split(/\s+/).pop() ?? player));
}

function claimMatchesFplStatus(claimText: string, status: FplPlayerAvailabilityStatus): boolean {
  const lower = claimText.toLowerCase();
  if (/\bsuspended\b/.test(lower)) return status === "s";
  if (/\binjured\b/.test(lower)) return status === "i";
  if (/\bdoubtful\b/.test(lower)) return status === "d";
  if (/\b(?:ruled out|unavailable|misses?|will miss|sits? out|\bout\b)\b/.test(lower)) {
    return status === "i" || status === "s" || status === "d" || status === "u";
  }
  return false;
}

function extractPlayerClub(sentence: string, grounding: Grounding): { player: string; club: string } | null {
  const paren = sentence.match(/\b([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)?)\s*\(([^)]+)\)/);
  if (paren) {
    return { player: paren[1].trim(), club: paren[2].trim() };
  }
  const match = ABSENCE_CLAIM.exec(sentence);
  const player = (match?.[1] ?? match?.[2])?.trim();
  if (!player) return null;
  for (const club of [grounding.home, grounding.away]) {
    if (sentence.includes(club) || sentence.includes(compactTeamLabel(club))) {
      return { player, club };
    }
  }
  return { player, club: grounding.home };
}

function sentenceHasFixtureMatchedCitation(sentence: string, bundle?: EvidenceBundle): boolean {
  if (/\[\[\s*S?\d{1,3}\s*\]\]/i.test(sentence) || /\]\(https?:\/\//i.test(sentence)) {
    return Boolean(bundle?.results?.length);
  }
  return false;
}

function absenceSentence(sentence: string): boolean {
  return CLAIM_KIND.test(sentence) && /\b[A-Z][a-z]/.test(sentence);
}

/**
 * Drops squad absence claims that contradict the dossier FPL spine unless the sentence carries a search citation.
 */
export function enforceFplAbsenceClaims(
  answer: string,
  grounding: Grounding,
  dossier: MatchDossier | null,
  bundle?: EvidenceBundle,
): string {
  const index = buildFplAbsenceIndex(dossier, grounding);
  if (!index.size && !dossier) return answer;
  return answer.split("\n").map((line) => {
    if (!absenceSentence(line)) return line;
    if (sentenceHasFixtureMatchedCitation(line, bundle)) return line;
    const extracted = extractPlayerClub(line, grounding);
    if (!extracted) return line;
    const status = lookupStatus(index, extracted.club, extracted.player);
    if (status == null) return "";
    if (status === "n") return "";
    return claimMatchesFplStatus(line, status) ? line : "";
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
