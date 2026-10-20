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
    .replace(/\bmy model\b/gi, "I")
    .replace(/\bMy model\b/g, "I")
    .replace(/\s{2,}/g, " ")
    .trim();
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
