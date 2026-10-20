import type { Grounding } from "../ask";
import {
  genericMarketFlipFallback,
  isCleanFlipClause,
  normalizeFlipClause,
} from "./take-flip-clause";
import { isGenuineTossUp1x2, stripFalseTossUpLanguage } from "./take-headline";
import type { PunditTakePlan } from "./types";

export function formatWhatFlipsItSentence(plan: PunditTakePlan, grounding: Grounding | null = null): string | null {
  let flip = plan.flipCondition?.text?.trim();
  if (!flip) return null;
  if (grounding) {
    flip = stripFalseTossUpLanguage(flip, grounding);
    if (!flip.trim()) return null;
    flip = normalizeFlipClause(flip, grounding.home, grounding.away)
      ?? (isCleanFlipClause(flip.replace(/\.$/, "")) ? flip.replace(/\.$/, "") : null)
      ?? genericMarketFlipFallback(plan, grounding, plan.gridCall);
  }
  const body = flip.endsWith(".") ? flip.slice(0, -1) : flip;
  if (!isCleanFlipClause(body)) return null;
  return `I'd shift if ${body}.`;
}

export function appendWhatFlipsItClosing(
  plan: PunditTakePlan,
  prose: string,
  grounding: Grounding | null = null,
): string {
  const flip = formatWhatFlipsItSentence(plan, grounding);
  if (!flip) return prose.trim();
  if (prose.includes(flip)) return prose.trim();
  return `${prose.trim()}\n\n${flip}`.trim();
}
