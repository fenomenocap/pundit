import type { Grounding } from "../ask";
import { allowedNumbersFromPlan, sentenceUsesDisallowedNumber } from "./take-allowed-numbers";
import type { PunditTakePlan } from "./types";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Drop prose sentences whose numbers are not present in the plan facts payload. */
export function filterProseByPlanNumbers(prose: string, plan: PunditTakePlan, grounding?: Grounding): string {
  const allowed = allowedNumbersFromPlan(plan, grounding);
  const sentences = prose.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => {
    if (/^Gambling can be addictive|^Nothing is guaranteed|^I can't guarantee|^I won't size a stake/i.test(sentence)) {
      return true;
    }
    if (/18\+/.test(sentence)) return true;
    if (/^That price implies|^I pass on|^I play\b|^The value is|^Separately,/i.test(sentence)) return true;
    if (/^I'd shift if /.test(sentence)) return true;
    return !sentenceUsesDisallowedNumber(sentence, allowed);
  });
  return (kept.length ? kept : sentences.slice(0, 1)).join(" ").trim();
}

/** Prose block only (exclude markdown tables). */
export function proseBlocksBeforeTable(answer: string): string {
  const tableIdx = answer.indexOf("\n\n| Outcome |");
  return (tableIdx >= 0 ? answer.slice(0, tableIdx) : answer.split("\n\nModel ")[0] ?? answer).trim();
}

export function applyFinalProseGuards(
  prose: string,
  plan: PunditTakePlan,
  grounding: Grounding,
  allowCoinFlip: boolean,
): string {
  let out = filterProseByPlanNumbers(prose, plan, grounding);
  if (!allowCoinFlip) {
    out = out
      .replace(/\bessentially a toss-up\b/gi, "")
      .replace(/\ba genuine toss-up\b/gi, "")
      .replace(/\ba toss-up\b/gi, "")
      .replace(/\btoss-up\b/gi, "")
      .replace(/\bcoin-flip\b/gi, "")
      .replace(/\bcoin flip\b/gi, "")
      .replace(/ — , lean /g, " — lean ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (/\bmodel\b/i.test(out)) {
    out = out.replace(/\bmodel\b/gi, "read").replace(/\s{2,}/g, " ").trim();
  }
  return out;
}
