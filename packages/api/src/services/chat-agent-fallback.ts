import type { AskGrounding, EvidenceBundle } from "./ask";
import { envelopChatAgentAnswer } from "./chat-agent-guard";

/** User-visible copy must never expose internal agent/runtime wording. */
export const AGENT_USER_BANNED_PHRASES: readonly RegExp[] = [
  /\bagent loop\b/i,
  /\btool budget\b/i,
  /\bexhausted\b/i,
  /\bbudget_exceeded\b/i,
  /\bgeneration_degraded\b/i,
  /\bhard budget exceeded\b/i,
  /\btool-calling agent\b/i,
  /\bwhat I already have on record\b/i,
  /\bsticking to what we already pulled\b/i,
];

export function containsAgentInternalWording(text: string): boolean {
  return AGENT_USER_BANNED_PHRASES.some((pattern) => pattern.test(text));
}

function formatSourceCitation(source: EvidenceBundle["results"][number]): string {
  const snippet = source.snippet.replace(/\s+/g, " ").trim().slice(0, 200);
  const lead = snippet || source.title;
  return `${lead} ([${source.title}](${source.url}) [[${source.id}]])`;
}

/**
 * Short grounded answer using evidence already on the bundle this turn (search tool hits).
 */
export function composeAgentEvidenceFallback(
  question: string,
  grounding: AskGrounding,
  bundle: EvidenceBundle,
  hasHistory: boolean,
): string {
  const sources = bundle.results.filter((row) => row.url && row.title).slice(0, 2);
  const cited = sources.map(formatSourceCitation).join(" ");

  if (grounding?.kind === "match") {
    const headline = envelopChatAgentAnswer("", question, grounding, { hasHistory }).trim();
    if (sources.length && headline) {
      return `${headline} ${cited}`.trim();
    }
    if (headline) {
      return `${headline} No bet — I'll keep this to the Fundamental sheet only.`.trim();
    }
  }

  if (sources.length) {
    return `Lean Avoid — ${cited}`.trim();
  }

  return "No bet — I'll keep this to verified sources and the model sheet only.";
}

export function sanitizeAgentUserText(text: string): string {
  if (!text.trim()) return "";
  if (!containsAgentInternalWording(text)) return text.trim();
  return "";
}
