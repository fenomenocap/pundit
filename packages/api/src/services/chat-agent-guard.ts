import type { AskGrounding } from "./ask";
import { composeDeskLabelledOneXTwo } from "./response-composer";
import { planResponse } from "./response-plan";

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

function isAgentOneXTwoHeadlineLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^My 1X2 is\b/i.test(trimmed)) return true;
  return (trimmed.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length >= 3 && /\bdraw\b/i.test(trimmed);
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

/** Server-owned 1X2 headline from grounding only — never from agent prose. */
export function serverMatchHeadlineLine(grounding: Extract<AskGrounding, { kind: "match" }>): string {
  if (grounding.pricing?.model) return composeDeskLabelledOneXTwo(grounding);
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  return `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`;
}

const AGENT_HEADLINE_LINE =
  /^(?:My 1X2 is|Lean ).+\bdraw\b.+\d+(?:\.\d+)?\s*%.+\.\s*/im;

function stripInjectedMatchHeadline(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const keptSentences = sentences.filter((sentence) => !isAgentOneXTwoHeadlineLine(sentence));
  let trimmed = keptSentences.join(" ").trim();
  const lines = trimmed.split("\n");
  const keptLines = lines.filter((line) => !isAgentOneXTwoHeadlineLine(line));
  trimmed = keptLines.join("\n").trim();
  return trimmed.replace(AGENT_HEADLINE_LINE, "").trim();
}

function applyServerOwnedMatchHeadline(
  text: string,
  grounding: Extract<AskGrounding, { kind: "match" }>,
  expectHeadline: boolean,
): string {
  let body = stripInjectedMatchHeadline(text);
  if (!expectHeadline) return body;
  const headline = serverMatchHeadlineLine(grounding);
  if (!body) return headline;
  if (body.startsWith(headline)) return body;
  return `${headline} ${body}`.trim();
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

/** Minimal server-owned W/D/W headline only; agent prose carries the rest. */
export function envelopChatAgentAnswer(
  answer: string,
  question: string,
  grounding: AskGrounding,
  options: { hasHistory?: boolean; voice?: "desk" } = {},
): string {
  let text = typeof answer === "string" ? answer : "";
  text = stripOrphanSectionLabels(text);
  text = trimIncompleteTrailingBold(text);
  if (grounding?.kind !== "match") {
    return stripInjectedMatchHeadline(text).trim();
  }

  const hasHistory = options.hasHistory ?? false;
  const plan = planResponse(question, {
    groundingKind: "match",
    hasHistory,
    hasUserLine: grounding.pricing?.userLine != null,
  });
  const expectHeadline = !hasHistory
    && plan.mode !== "team-news"
    && plan.mode !== "player-or-scorer";
  text = hasHistory
    ? stripInjectedMatchHeadline(text)
    : applyServerOwnedMatchHeadline(text, grounding, expectHeadline);
  return text.trim();
}
