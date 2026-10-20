import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";

/** Flip is always one pre-built sentence on the plan — never spliced from fragments. */
export function formatWhatFlipsItSentence(plan: PunditTakePlan, _grounding: Grounding | null = null): string | null {
  const flip = plan.flipCondition?.text?.trim();
  if (!flip) return null;
  if (/^I'd shift if/i.test(flip)) return flip.endsWith(".") ? flip : `${flip}.`;
  return `I'd shift if ${flip.replace(/\.$/, "")}.`;
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
