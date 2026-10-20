import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";
import { isGenuineTossUp1x2, stripFalseTossUpLanguage } from "./take-headline";

export function formatWhatFlipsItSentence(plan: PunditTakePlan, grounding: Grounding | null = null): string | null {
  let flip = plan.flipCondition?.text?.trim();
  if (!flip) return null;
  if (grounding) {
    flip = stripFalseTossUpLanguage(flip, grounding);
    if (!flip.trim()) return null;
  }
  const body = flip.endsWith(".") ? flip.slice(0, -1) : flip;
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
