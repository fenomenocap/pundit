import type { PunditTakeSourcesFooter } from "./types";

const FORBIDDEN = /\b(?:model|probabilities|probability|footer)\b/i;

/** Pundit-voice provenance body from footer fields actually present (no vendor names). */
export function provenanceBodyFromFooter(footer: PunditTakeSourcesFooter): string {
  const parts: string[] = ["how I rate each side"];
  if (footer.tableAsOfSgt) parts.push("the table");
  if (footer.formAsOfSgt) parts.push("recent results");
  const hasMarkets = footer.odds.length > 0;

  let lead = "My prices come from ";
  if (parts.length === 1) {
    lead += parts[0]!;
  } else if (parts.length === 2) {
    lead += `${parts[0]} and ${parts[1]}`;
  } else {
    lead += `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  }
  if (hasMarkets) {
    lead += ", checked against the live betting markets";
  }
  const sentence = `${lead}; every source and its as-of time is listed below.`;
  if (FORBIDDEN.test(sentence)) {
    throw new Error("provenance voice leaked forbidden audit term");
  }
  return sentence;
}
