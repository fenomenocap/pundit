import type { AskGrounding } from "./ask";
import {
  CALIBRATED_GOALS_SENTENCE,
  SHARED_TOTAL_XG_SENTENCE,
  STAKE_REFUSAL_SENTENCE,
  composeDeskLabelledOneXTwo,
  composeMarketDivergenceHeadline,
  composeUserLineAnswer,
} from "./response-composer";
import { planResponse, pricedGridMarketsAsked } from "./response-plan";

const PERCENT_RE = /\b(\d{1,2}(?:\.\d)?)\s*%/g;
const SECTION_LABEL_LINE = /^\s*\*\*[^*\n]+\*\*:?\s*$/;

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

function hasHeadlineOneXTwo(text: string): boolean {
  return text.split("\n").some((line) =>
    (line.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length >= 3 && /\bdraw\b/i.test(line)
  );
}

function stripOrphanSectionLabels(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!SECTION_LABEL_LINE.test(line)) {
      kept.push(line);
      continue;
    }
    let hasBody = false;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (SECTION_LABEL_LINE.test(lines[next])) break;
      hasBody = true;
      break;
    }
    if (hasBody) kept.push(line);
  }
  return kept.join("\n").trim();
}

function trimIncompleteTrailingBold(text: string): string {
  const trimmed = text.trim();
  const boldCount = (trimmed.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 0) return trimmed;
  const lastOpen = trimmed.lastIndexOf("**");
  if (lastOpen <= 0) return trimmed;
  return trimmed.slice(0, lastOpen).trim();
}

function needsMarketAttribution(
  question: string,
  text: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
): boolean {
  const asksMarket = /\b(?:market|kalshi|polymarket|stake|odds|compare|comparison|disagree|gap)\b/i.test(question);
  if (!asksMarket) return false;
  const attributionText = text.replace(/[‘’]/g, "'");
  const comparisonClaim = /\b(?:market|kalshi|polymarket|stake|bookmakers?|bookies?|price|odds|gap|disagree|higher|lower)\b/i.test(attributionText);
  return comparisonClaim;
}

function appendMarketAttribution(text: string, grounding: Extract<AskGrounding, { kind: "match" }>): string {
  const headline = composeMarketDivergenceHeadline(grounding);
  if (!headline || text.includes(headline.slice(0, 40))) return text;
  return `${text.trim()}\n\n${headline}`.trim();
}

function appendTotalsHonestyIfNeeded(
  question: string,
  text: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
): string {
  const asksTotals = pricedGridMarketsAsked(question).includes("totals")
    || /\bover 2\.5\b/i.test(question)
    || /\bunder 2\.5\b/i.test(question);
  if (!asksTotals) return text;
  const hasOverUnder = /\bover 2\.5\b/i.test(text) && /\bunder 2\.5\b/i.test(text);
  if (!hasOverUnder) return text;
  const calibrated = grounding.goalCalibration?.methodId === "outcome-anchored-shrunk-goals-v2";
  const assumptionPresent = calibrated
    ? /\b(?:estimate goals|historical scoring|forecasts?, not guarantees)\b/i.test(text)
    : /\b(?:fixed total-goals|more open or tighter)\b/i.test(text);
  if (assumptionPresent) return text;
  const sentence = calibrated ? CALIBRATED_GOALS_SENTENCE : SHARED_TOTAL_XG_SENTENCE;
  return `${text.trim()} ${sentence}`.trim();
}

function ensureStakeRefusal(text: string, planMode: string): string {
  if (planMode !== "stake-refusal") return text;
  if (text.includes(STAKE_REFUSAL_SENTENCE)) return text;
  return `${text.trim()}\n\n${STAKE_REFUSAL_SENTENCE}`.trim();
}

function ensureUserLineBlock(
  text: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
  planMode: string,
): string {
  if (planMode !== "user-line" || !grounding.pricing?.userLine) return text;
  const block = composeUserLineAnswer(grounding);
  if (/\bat 7\.00\b/.test(text) && /\bmodel vs that line\b/i.test(text)) return text;
  return `${block}\n\n${text.trim()}`.trim();
}

function matchHeadlineLine(grounding: Extract<AskGrounding, { kind: "match" }>): string {
  if (grounding.pricing?.model) return composeDeskLabelledOneXTwo(grounding);
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  return `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`;
}

function ensureMatchHeadline(
  text: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
  expectHeadline: boolean,
): string {
  if (!expectHeadline || hasHeadlineOneXTwo(text)) return text;
  return `${matchHeadlineLine(grounding)} ${text.trim()}`.trim();
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

/** Structural and contract envelopes before verification/delivery. */
export function envelopChatAgentAnswer(
  answer: string,
  question: string,
  grounding: AskGrounding,
  options: { hasHistory?: boolean; voice?: "desk" } = {},
): string {
  let text = typeof answer === "string" ? answer : "";
  text = stripOrphanSectionLabels(text);
  text = trimIncompleteTrailingBold(text);
  if (grounding?.kind !== "match") return text.trim();

  const plan = planResponse(question, {
    groundingKind: "match",
    hasHistory: options.hasHistory ?? false,
    hasUserLine: grounding.pricing?.userLine != null,
  });
  const expectHeadline = plan.mode !== "team-news" && plan.mode !== "player-or-scorer";
  text = ensureMatchHeadline(text, grounding, expectHeadline);
  text = ensureUserLineBlock(text, grounding, plan.mode);
  text = ensureStakeRefusal(text, plan.mode);
  text = appendTotalsHonestyIfNeeded(question, text, grounding);
  if (needsMarketAttribution(question, text, grounding)) {
    text = appendMarketAttribution(text, grounding);
  } else if (plan.mode === "market-comparison") {
    text = appendMarketAttribution(text, grounding);
  }
  return text.trim();
}
