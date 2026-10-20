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

const VENUE_PERFORMANCE_PLACE =
  /\b(?:at home|away from home|on the road|on their travels|home form|away form)\b/i;

const VENUE_PERFORMANCE_ACTION =
  /\b(?:conceded|conceding|scored|scoring|won|wins|winning|lost|losing|grind|grinding|struggled|struggling|struggle)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Headline and structured flip — never drop in hygiene passes. */
export function isProtectedTakeSentence(sentence: string, plan: PunditTakePlan): boolean {
  const t = sentence.trim();
  if (/^I'd shift if\b/i.test(t)) return true;
  if (new RegExp(`^${escapeRegExp(plan.fixtureLabel)}\\s*[—-]`).test(t)) return true;
  if (new RegExp(`^On ${escapeRegExp(plan.fixtureLabel)}, I have`).test(t)) return true;
  return false;
}

export function rewriteWinProbabilityPhrase(text: string): string {
  return text
    .replace(/\bwin probabilities\b/gi, "win chances")
    .replace(/\bwin probability\b/gi, "win chance");
}

/** Venue-tied performance narrative without split data (not neutral home-advantage copy). */
export function sentenceMakesVenuePerformanceClaim(sentence: string): boolean {
  if (/\bhome[- ]field advantage\b/i.test(sentence)) return false;
  const withoutAdvantage = sentence.replace(/\bhome advantage\b/gi, "");
  if (!VENUE_PERFORMANCE_PLACE.test(withoutAdvantage)) return false;
  if (/\bconceded\b[\w\s,'’-]{0,48}\bat home\b/i.test(sentence)) return true;
  if (/\bgrind(?:ing)?\s+results\b[\w\s,'’-]{0,24}\bon the road\b/i.test(sentence)) return true;
  if (/\bon the road\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\bat home\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\bon their travels\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  if (/\b(?:home|away) form\b/i.test(sentence) && VENUE_PERFORMANCE_ACTION.test(sentence)) return true;
  return false;
}

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

function sanitizeLlmTakeSentence(
  sentence: string,
  plan: PunditTakePlan,
  venueSplit: boolean,
): string | null {
  if (isProtectedTakeSentence(sentence, plan)) {
    return rewriteWinProbabilityPhrase(sentence);
  }
  let next = rewriteWinProbabilityPhrase(sentence);
  if (!venueSplit && sentenceMakesVenuePerformanceClaim(next)) {
    return null;
  }
  return rewriteVenueInventedFormSentence(next, venueSplit);
}

export function applyVenueFormHygiene(prose: string, plan: PunditTakePlan): string {
  const venueSplit = formDataHasVenueSplit(plan);
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const sanitized = sanitizeLlmTakeSentence(sentence, plan, venueSplit);
    if (sanitized) kept.push(sanitized);
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

/** Expand common contractions so policy dedupe catches won't / will not pairs. */
export function expandContractionsForDedupe(text: string): string {
  return text
    .replace(/\bI'm\b/gi, "I am")
    .replace(/\bI've\b/gi, "I have")
    .replace(/\bI'll\b/gi, "I will")
    .replace(/\bI'd\b/gi, "I would")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bdoesn't\b/gi, "does not")
    .replace(/\bdidn't\b/gi, "did not")
    .replace(/\bisn't\b/gi, "is not")
    .replace(/\baren't\b/gi, "are not")
    .replace(/\bwasn't\b/gi, "was not")
    .replace(/\bweren't\b/gi, "were not")
    .replace(/\bhasn't\b/gi, "has not")
    .replace(/\bhaven't\b/gi, "have not")
    .replace(/\bhadn't\b/gi, "had not")
    .replace(/\bwouldn't\b/gi, "would not")
    .replace(/\bshouldn't\b/gi, "should not")
    .replace(/\bcouldn't\b/gi, "could not")
    .replace(/\bmustn't\b/gi, "must not")
    .replace(/\bit's\b/gi, "it is")
    .replace(/\bthat's\b/gi, "that is")
    .replace(/\bwhat's\b/gi, "what is")
    .replace(/\bwho's\b/gi, "who is")
    .replace(/\blet's\b/gi, "let us");
}

function normalizeForDedupe(text: string): string {
  return expandContractionsForDedupe(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function dedupePolicySentences(sentences: string[], seenNormalized: string[]): string[] {
  const kept: string[] = [];
  for (const sentence of sentences) {
    const norm = normalizeForDedupe(sentence);
    if (!norm) continue;
    if (seenNormalized.some((prev) => blocksNearDuplicate(prev, norm))) continue;
    seenNormalized.push(norm);
    kept.push(sentence);
  }
  return kept;
}

/** Drop repeated paragraphs and near-duplicate sentences within each policy block. */
export function dedupePolicyProseBlocks(prose: string): string {
  const blocks = prose.split("\n\n").map((b) => b.trim()).filter(Boolean);
  const keptBlocks: string[] = [];
  for (const block of blocks) {
    const sentences = block.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    const seenInBlock: string[] = [];
    const keptSentences = dedupePolicySentences(sentences, seenInBlock);
    if (!keptSentences.length) continue;
    const joined = keptSentences.join(" ");
    if (keptBlocks.some((prev) => blocksNearDuplicate(prev, joined))) continue;
    keptBlocks.push(joined);
  }
  const merged = keptBlocks.join("\n\n");
  return dedupePolicyProseSentencesGlobally(merged.replace(/\n\n+/g, " "));
}

/** When policy prose is one block (desk flattening), dedupe sentences across the whole string. */
function dedupePolicyProseSentencesGlobally(prose: string): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const seen: string[] = [];
  return dedupePolicySentences(sentences, seen).join(" ");
}

export function applyV2ProseHygiene(prose: string, plan: PunditTakePlan): string {
  const venueFixed = applyVenueFormHygiene(prose, plan);
  return dedupeVenueQualifiers(venueFixed);
}
