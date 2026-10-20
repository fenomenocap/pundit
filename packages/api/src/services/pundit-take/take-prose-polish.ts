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
  return text
    .replace(/\bthe model expects\b/gi, "I expect")
    .replace(/\bthe model\b/gi, "I")
    .replace(/\bmodel-only\b/gi, "our")
    .replace(/\bmodel\b/gi, "read")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function polishTakeProseLine(text: string): string {
  return scrubModelWordFromProse(normalizeFormScopeInText(scrubMyModelPhrasing(text)));
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
