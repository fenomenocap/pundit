import type { Grounding } from "../ask";
import type { PunditTakePlan } from "./types";

const FLIP_SENTENCE_PATTERN = /^I'd shift\b|^What flips it:/i;

/** Remove LLM or seed flip lines — canonical flip is appended once at the end. */
export function stripFlipSentencesFromProse(prose: string): string {
  const sentences = prose
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter((sentence) => !FLIP_SENTENCE_PATTERN.test(sentence));
  return kept.join(" ").trim();
}

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
  const withoutFlip = stripFlipSentencesFromProse(prose);
  const flip = formatWhatFlipsItSentence(plan, grounding);
  if (!flip) return withoutFlip;
  if (withoutFlip.includes(flip)) return withoutFlip;
  if (!withoutFlip) return flip;
  return `${withoutFlip}\n\n${flip}`.trim();
}
