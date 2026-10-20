import type { Grounding } from "../ask";
import type { PunditTakePlan, TakePlanPoint } from "./types";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

export function capitalizeTakeProse(prose: string): string {
  return prose
    .split("\n\n")
    .map((block) => block
      .split(SENTENCE_SPLIT)
      .map((sentence) => {
        const trimmed = sentence.trim();
        if (!trimmed) return trimmed;
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      })
      .filter(Boolean)
      .join(" "))
    .filter(Boolean)
    .join("\n\n");
}

export function scrubMyModelPhrasing(text: string): string {
  return text
    .replace(/\bmy model expects\b/gi, "I expect")
    .replace(/\bmy model\b/gi, "I")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Dossier last-5 is all venues — never imply a venue split in form copy. */
export function normalizeFormScopeInText(text: string): string {
  return text
    .replace(/\bat this venue stretch\b/gi, "across all venues")
    .replace(/\bat this venue\b/gi, "across all venues")
    .replace(
      /\b(last \d+ league games)(?! \(all venues\))/gi,
      "$1 (all venues)",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Ban "model" in user-facing take prose (table/footer may still say Model). */
export function scrubModelWordFromProse(text: string): string {
  let out = text
    .replace(/\bthe model expects\b/gi, "I expect")
    .replace(/\bthe model thinks\b/gi, "I think")
    .replace(/\bthe model has\b/gi, "I have")
    .replace(/\bthe model rates\b/gi, "I rate")
    .replace(/\bthe model's edge\b/gi, "My edge")
    .replace(/\bthe model\b/gi, "I")
    .replace(/\bmodel-only\b/gi, "our")
    .replace(/\bmodel\b/gi, "read");
  out = out
    .replace(/\bI's edge\b/gi, "My edge")
    .replace(/\bI thinks\b/gi, "I think")
    .replace(/\bI rates\b/gi, "I rate")
    .replace(/\bI has\b/gi, "I have");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Remove dangling "find the net even." fragments anywhere in prose (mid-paragraph or end). */
export function repairIncompleteEvenClause(text: string): string {
  const repaired = text.replace(/(\bfind the net)\s+even\./gi, "$1.");
  return repaired
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const trimmed = sentence.trim().replace(/\s+/g, " ");
      if (!trimmed) return trimmed;
      if (/\bfind the net even\.\s*$/i.test(trimmed)) {
        return trimmed.replace(/\s+even\.\s*$/i, ".").trim();
      }
      const dangling = trimmed.match(/^(.*?\bfind the net)\s+even(?:\s+when|\s+if|\s+though|\s+the|\s+I)?[^.!?]*$/i);
      if (dangling?.[1]) return `${dangling[1].trim()}.`;
      return trimmed;
    })
    .filter(Boolean)
    .join(" ");
}

export function polishTakeProseLine(text: string): string {
  const scrubbed = scrubModelWordFromProse(normalizeFormScopeInText(scrubMyModelPhrasing(text)));
  const repaired = repairIncompleteEvenClause(scrubbed);
  const capitalized = repaired.charAt(0).toUpperCase() + repaired.slice(1);
  return capitalized;
}

/** First pass on OpenRouter take copy — before post-check or assembly. */
export function polishLlmTakeProse(text: string): string {
  let out = polishTakeProseLine(text);
  out = out.replace(/\bI expects\b/gi, "I expect");
  return capitalizeTakeProse(out);
}

export function filterGoalPointsForGridLead(
  points: TakePlanPoint[],
  gridCall: PunditTakePlan["gridCall"],
  grounding: Grounding,
): TakePlanPoint[] {
  if (!gridCall) return points;
  const totalXg = grounding.totalXg;
  if (gridCall.sideKey === "under") {
    return points.filter((p) => {
      if (!/expects (about|close to|around)/i.test(p.text)) return true;
      if (Number.isFinite(totalXg) && totalXg <= 2.45) return true;
      return false;
    });
  }
  if (gridCall.sideKey === "no") {
    return points.filter((p) => !/expects (about|close to|around) (?:three|four|five)/i.test(p.text));
  }
  return points;
}

export function valueLegMatchesHeadline(plan: PunditTakePlan): boolean {
  if (!plan.valueLeg) return false;
  if (plan.gridCall) {
    const side = plan.gridCall.sideKey;
    if (side === "yes" || side === "no" || side === "over" || side === "under") return false;
  }
  return plan.valueLeg.outcome === plan.call.outcome;
}
