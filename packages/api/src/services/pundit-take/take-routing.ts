import type { ResponsePlan } from "../response-plan";
import { asksHonestWinnerGuarantee, asksOddsProvenance } from "../response-plan";

export function asksWhatFlipsItQuestion(question: string): boolean {
  const q = question.trim();
  return /\bwhat (?:would )?flip(?:s)?(?: it| this| the call| my (?:read|call))?\b/i.test(q)
    || /\bwhat would (?:have to )?change\b/i.test(q)
    || /\bwhat changes (?:this|the call|my read)\b/i.test(q);
}

export function asksDrawSideTakeQuestion(question: string): boolean {
  const q = question.trim();
  return (/\b(?:what about|how about)\b/i.test(q) && /\b(?:the )?draw\b/i.test(q))
    || /^\s*(?:the\s+)?draw\s*\??\s*$/i.test(q)
    || /^(?:what about |how about )?(?:the )?draw\??\s*$/i.test(q)
    || /\bdraw (?:side|angle|price|odds)\b/i.test(q);
}

/** Draw, guarantee, and provenance prompts always use the v2 take composer. */
export function asksTakeV2PolicyPrompt(question: string): boolean {
  return asksDrawSideTakeQuestion(question)
    || asksHonestWinnerGuarantee(question)
    || asksOddsProvenance(question);
}

export function asksMatchWhyTakeQuestion(question: string, plan: ResponsePlan): boolean {
  if (!/\bwhy\b/i.test(question.trim())) return false;
  return plan.mode === "priced-why"
    || plan.mode === "match-follow-up"
    || plan.mode === "pricing-desk"
    || plan.mode === "market-comparison";
}

export function punditTakeV2AppliesToPlan(plan: ResponsePlan, question: string): boolean {
  if (asksTakeV2PolicyPrompt(question)) return true;
  if (asksWhatFlipsItQuestion(question)) return true;
  if (plan.mode === "winner-guarantee-honesty") return true;
  if (plan.mode === "odds-provenance") return true;
  if (asksDrawSideTakeQuestion(question)) return true;
  if (asksMatchWhyTakeQuestion(question, plan)) return true;
  return false;
}
