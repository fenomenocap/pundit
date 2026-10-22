import type { Grounding } from "./ask";
import {
  deskPercentDisplay,
  displayOutcomeLabel,
  joinBasicsAnswer,
} from "./basics-answer-voice";

export function asksMarketGapFocusQuestion(question: string): boolean {
  const q = question.toLowerCase();
  if (/\bgap\b/.test(q) && /\bprove\b/.test(q)) return true;
  if (/\bwhere\b.{0,60}\bdisagree\b/.test(q)) return true;
  if (/\bdisagree\b.{0,40}\b(?:most|biggest|largest)\b/.test(q)) return true;
  if (/\b(?:does|do)\b.{0,40}\b(?:the )?gap\b/.test(q) && /\bprove\b/.test(q)) return true;
  return false;
}

export function composeMarketGapFocusAnswer(grounding: Grounding): string {
  const divergence = grounding.marketDivergence[0]!;
  const leg = divergence.largest;
  const label = displayOutcomeLabel(grounding, leg.outcome);
  const modelPct = deskPercentDisplay(leg.modelPercent / 100);
  const marketPct = deskPercentDisplay(leg.marketPercent / 100);
  const headline = `${grounding.home} v ${grounding.away} — the largest gap is on ${label}: `
    + `I have ${modelPct} vs the market ${marketPct}.`;
  return joinBasicsAnswer({
    headline,
    supports: [
      "A price gap only marks a disagreement between my read and the market; it does not explain the cause and says nothing about lineups on its own.",
    ],
  });
}
