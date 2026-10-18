import type { AskGrounding, EvidenceBundle } from "./ask";
import { assertsSquadAvailability } from "./answer-provenance";
import type { RetrievedEvidencePage } from "./evidence-page-retrieval";
import { formatDeskCitationDate, rewriteDeskCitationMarkdown } from "./desk-voice";
import { playerNamedInNewsBody } from "./player-evidence";

/** Must stay aligned with `MAX_HISTORY_CONTENT_LENGTH` in routes/ask.ts */
export const AGENT_HISTORY_CONTENT_MAX = 4_000;

const SOURCE_AND_DATE = new RegExp([
  /\([^)]*,[^)]*\d[^)]*\)/.source,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.source,
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.source,
  /\b20\d{2}\b/.source,
  /\b(?:\d+|a|an|one|two|three|four|five|six|seven)\s+(?:second|minute|hour|day|week|month)s?\s+ago\b/.source,
  /\b(?:yesterday|today|this (?:morning|afternoon|evening)|last night|earlier (?:today|this week))\b/.source,
  /\b(?:according to|reported|confirmed by)\b/.source,
].join("|"), "i");

const EVIDENCE_MARKER = /\[\[S(\d+)\]\]/;

function sentenceHasSourceAndDate(sentence: string): boolean {
  return SOURCE_AND_DATE.test(sentence)
    || /\(\[[^\]]+\]\(https?:\/\/[^\s)]+\)[^)]*\)/.test(sentence);
}

function fixtureRef(grounding: AskGrounding) {
  if (grounding?.kind !== "match") return undefined;
  return {
    fixtureId: grounding.fixtureId,
    home: grounding.home,
    away: grounding.away,
    kickoff: grounding.date,
  };
}

function sourceBodyText(
  source: EvidenceBundle["results"][number],
  pages?: readonly RetrievedEvidencePage[],
): string {
  const page = pages?.find((row) => row.id === source.id);
  if (page?.text?.trim()) return `${source.title}\n${page.text}`;
  return `${source.title}\n${source.snippet}`;
}

function namedPlayersInSentence(sentence: string): string[] {
  return [...sentence.matchAll(/\p{Lu}[\p{L}\p{M}'’.-]+(?:\s+\p{Lu}[\p{L}\p{M}'’.-]+){1,2}/gu)]
    .map((match) => match[0].trim())
    .filter((name) => name.split(/\s+/).length >= 2);
}

export function sanitizeAgentCitationArtifacts(text: string): string {
  return text
    .replace(/\]\]/g, "")
    .replace(/\)\(https?:\/\//g, " (")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Pre-render only: requires an explicit [[S#]] marker tied to source text that names the player. */
export function enrichAgentTeamNewsAttribution(
  answer: string,
  bundle: EvidenceBundle,
  grounding: AskGrounding,
  pages?: readonly RetrievedEvidencePage[],
): string {
  const byId = new Map((bundle.results ?? []).map((source) => [source.id, source]));
  const fixture = fixtureRef(grounding);
  const regions = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const enriched = regions.map((region) => {
    if (!assertsSquadAvailability(region) || sentenceHasSourceAndDate(region)) return region;
    const marker = EVIDENCE_MARKER.exec(region);
    if (!marker) return region;
    const source = byId.get(`S${Number(marker[1])}`);
    if (!source?.url || !fixture) return region;
    const body = sourceBodyText(source, pages);
    const players = namedPlayersInSentence(region);
    if (!players.some((name) => playerNamedInNewsBody(name, body, fixture))) return region;
    const pub = formatDeskCitationDate(source.date || "undated");
    const host = (() => {
      try {
        return new URL(source.url).hostname.replace(/^www\./, "");
      } catch {
        return source.title.split(/\s+/)[0];
      }
    })();
    const tail = ` (${host}, ${pub})`;
    return `${region.replace(/\s+$/, "")}${tail}.`;
  });
  return enriched.join(" ");
}

export function completeAgentAnswerEnding(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return trimmed;
  const boldCount = (trimmed.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) {
    const lastOpen = trimmed.lastIndexOf("**");
    if (lastOpen > 0) trimmed = trimmed.slice(0, lastOpen).trim();
  }
  const probabilityTail = /\b(?:(?:[Hh]ome|[Aa]way|[Dd]raw)\s+(?:(?:is|are|at)\s+)?|[A-Z][A-Za-z.'’-]{1,30}(?:\s+[A-Z][A-Za-z.'’-]{1,30}){0,3}\s+(?:is|are|at)\s+)\*{0,2}\d{1,3}(?:\.\d*)?\*{0,2}\.?\s*$/.exec(trimmed);
  if (probabilityTail?.index !== undefined && probabilityTail.index > 0) {
    const clause = trimmed.slice(Math.max(0, probabilityTail.index - 160), probabilityTail.index);
    if (clause.includes("%") && !/\b(?:bet365|bookmakers?|kalshi|polymarket|stake)\b/i.test(clause)) {
      trimmed = trimmed.slice(0, probabilityTail.index).trim();
    }
  }
  trimmed = trimmed.replace(
    /\.\s+(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+)?(?:is|are|at)\s+\d{1,3}(?:\.\d+)?\.?\s*$/,
    ".",
  );
  if (!/[.!?]["'”)]*\s*$/.test(trimmed) && trimmed.length > 20) {
    const lastEnd = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("!"), trimmed.lastIndexOf("?"));
    if (lastEnd > trimmed.length * 0.55) trimmed = trimmed.slice(0, lastEnd + 1).trim();
    else trimmed = `${trimmed.replace(/[,;:]\s*$/, "")}.`;
  }
  return trimmed;
}

export function capAgentAnswerForHistory(text: string, maxLen = AGENT_HISTORY_CONTENT_MAX): string {
  let trimmed = completeAgentAnswerEnding(text.trim());
  if (trimmed.length <= maxLen) return trimmed;
  let slice = trimmed.slice(0, maxLen);
  const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastSentenceEnd > maxLen * 0.45) slice = slice.slice(0, lastSentenceEnd + 1);
  trimmed = completeAgentAnswerEnding(slice.trim());
  if (trimmed.length <= maxLen) return trimmed;
  const hard = trimmed.slice(0, maxLen).replace(/\s+\S+$/, "").trim();
  return hard.length > 0 ? hard : trimmed.slice(0, maxLen);
}

export function finalizeAgentPackagedAnswer(
  prose: string,
  options: { voice?: "desk" } = {},
): string {
  let text = prose;
  if (options.voice === "desk") text = rewriteDeskCitationMarkdown(text);
  text = completeAgentAnswerEnding(text);
  return capAgentAnswerForHistory(text);
}
