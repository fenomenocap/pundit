import type { PunditTakePlan } from "./types";

/** Club-form windows in the dossier are all-venues; no home/away split in current data. */
export function formDataHasVenueSplit(_plan: PunditTakePlan): boolean {
  return false;
}

const VENUE_FORM_CLAIM =
  /\b(?:away from home|on the road|(?:^|\s)at home(?:\s|$)|home form|away form)\b/i;
const FORM_STAT_CLAIM =
  /\b(?:last\s+(?:five|5|\d+)\b|\d+\s+goals?\b|managed\s+\d+\s+goals?)/i;

const LAST_N_VENUE_PHRASE =
  /\bin their last (five|5|\d+) (?:away from home|on the road|at home)\b/gi;
const OVER_LAST_N_VENUE =
  /\bover their last (five|5|\d+) (?:away from home|on the road|at home)\b/gi;
const MANAGED_GOALS_AWAY =
  /\b(managed\s+\d+\s+goals?\s+in their last (?:five|5|\d+)) (?:away from home|on the road|at home)\b/gi;

export function rewriteVenueInventedFormSentence(sentence: string, venueSplitAvailable: boolean): string | null {
  if (venueSplitAvailable || !VENUE_FORM_CLAIM.test(sentence) || !FORM_STAT_CLAIM.test(sentence)) {
    return sentence;
  }
  let out = sentence
    .replace(LAST_N_VENUE_PHRASE, "in their last $1 league games")
    .replace(OVER_LAST_N_VENUE, "over their last $1 league games")
    .replace(MANAGED_GOALS_AWAY, "$1 league games")
    .replace(/\b(?:away from home|on the road)\b/gi, "")
    .replace(/\bin their last (five|5|\d+) at home\b/gi, "in their last $1 league games")
    .replace(/\bhome form\b/gi, "recent league form")
    .replace(/\baway form\b/gi, "recent league form")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
  if (VENUE_FORM_CLAIM.test(out) && FORM_STAT_CLAIM.test(out)) {
    return null;
  }
  return out || null;
}

export function applyVenueFormHygiene(prose: string, plan: PunditTakePlan): string {
  const venueSplit = formDataHasVenueSplit(plan);
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const rewritten = rewriteVenueInventedFormSentence(sentence, venueSplit);
    if (rewritten) kept.push(rewritten);
  }
  return kept.join(" ").trim();
}

export function dedupeVenueQualifiers(text: string): string {
  return text
    .replace(/\(\s*all venues\s*\)\s*at all venues/gi, "(all venues)")
    .replace(/\(\s*all venues\s*\)\s*\(\s*all venues\s*\)/gi, "(all venues)")
    .replace(/\bacross all venues\s+at all venues\b/gi, "across all venues")
    .replace(/\(\s*all venues\s*\)\s+across all venues\b/gi, "(all venues)")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function blocksNearDuplicate(a: string, b: string): boolean {
  const na = normalizeForDedupe(a);
  const nb = normalizeForDedupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 40 && nb.includes(na)) return true;
  if (nb.length >= 40 && na.includes(nb)) return true;
  return false;
}

/** Drop repeated paragraphs in policy / refusal answers. */
export function dedupePolicyProseBlocks(prose: string): string {
  const blocks = prose.split("\n\n").map((b) => b.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const block of blocks) {
    if (kept.some((prev) => blocksNearDuplicate(prev, block))) continue;
    kept.push(block);
  }
  return kept.join("\n\n");
}

export function applyV2ProseHygiene(prose: string, plan: PunditTakePlan): string {
  const venueFixed = applyVenueFormHygiene(prose, plan);
  return dedupeVenueQualifiers(venueFixed);
}
