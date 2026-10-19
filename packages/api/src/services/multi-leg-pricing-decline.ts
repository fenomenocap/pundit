import { getLeadFeaturedModelFixture } from "./featured-fixtures";

/** Parlay / acca / named multi-match pricing — honest decline, not maths or tactics. */
export function isMultiLegPricingQuestion(question: string): boolean {
  if (/\bin general\b/i.test(question)) return false;

  if (/\b(?:parlay|acca|accumulator)\b/i.test(question)) return true;
  if (/\b\d+[\s-]*fold\b/i.test(question)) return true;
  if (/\b(?:five|four|three|two)[\s-]*fold\b/i.test(question)) return true;

  const namedLegs = question.split(/\band\b/i).filter((part) => /\bto\s+(?:beat|win)\b/i.test(part));
  if (namedLegs.length >= 2) return true;

  const bettingSlate = /\b(?:today|tonight|this\s+weekend|(?:the\s+)?next\s+slate|slate|card|desk|kick[\s-]?offs?|matches?|fixtures?|combined|price|prices|odds|\d+\s*pm)\b/i.test(question);
  if (bettingSlate && /\b(?:parlay|acca|accumulator|\d+[\s-]*fold)\b/i.test(question)) {
    return true;
  }

  return false;
}

export function composeMultiLegPricingDeclineAnswer(): string {
  const lead = getLeadFeaturedModelFixture();
  const fixtureLabel = lead ? `${lead.home} vs ${lead.away}` : "a match on the desk";
  return `I price single matches for now; multi-leg pricing is coming soon. Want the numbers on ${fixtureLabel}?`;
}
