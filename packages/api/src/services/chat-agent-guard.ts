import type { AskGrounding } from "./ask";

const PERCENT_RE = /\b(\d{1,2}(?:\.\d)?)\s*%/g;

function roundPct(probability: number): number {
  return Math.round(probability * 1000) / 10;
}

function allowedMatchPercentages(grounding: Extract<AskGrounding, { kind: "match" }>): number[] {
  const values: number[] = [];
  const add = (probability: number | undefined) => {
    if (typeof probability === "number" && Number.isFinite(probability)) {
      values.push(roundPct(probability));
    }
  };
  add(grounding.pHome);
  add(grounding.pDraw);
  add(grounding.pAway);
  add(grounding.pOver2_5);
  add(grounding.pUnder2_5);
  add(grounding.pBttsYes);
  add(grounding.pBttsNo);
  for (const row of grounding.topScores ?? []) add(row.probability);
  return values;
}

function percentageAllowed(value: number, allowed: number[]): boolean {
  return allowed.some((candidate) => Math.abs(candidate - value) <= 0.85);
}

function stripUnsupportedPercentages(answer: string, allowed: number[]): string {
  const sentences = answer.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => {
    PERCENT_RE.lastIndex = 0;
    const matches = [...sentence.matchAll(PERCENT_RE)];
    if (!matches.length) return true;
    return matches.every((match) => percentageAllowed(Number(match[1]), allowed));
  });
  return kept.join(" ").trim();
}

/** Drop LLM-invented probabilities on priced fixtures; keep honest abstains. */
export function finalizeChatAgentAnswer(answer: string, grounding: AskGrounding): string {
  const trimmed = answer.trim();
  if (!trimmed) {
    return "No bet — I don't have enough grounded data for a confident call.";
  }
  if (grounding?.kind !== "match") return trimmed;

  const allowed = allowedMatchPercentages(grounding);
  if (!allowed.length) return trimmed;

  const sanitized = stripUnsupportedPercentages(trimmed, allowed);
  if (sanitized) return sanitized;

  return [
    "No bet — I couldn't tie every number in that take to the Fundamental model or verified sources.",
    "Ask again for 1X2, totals, or BTTS and I'll stick to the model sheet only.",
  ].join(" ");
}
