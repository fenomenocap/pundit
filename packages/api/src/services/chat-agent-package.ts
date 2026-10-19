import type { AskGrounding, EvidenceBundle } from "./ask";
import { assertsSquadAvailability } from "./answer-provenance";
import type { RetrievedEvidencePage } from "./evidence-page-retrieval";
import { formatDeskCitationDate, rewriteDeskCitationMarkdown } from "./desk-voice";
import { playerNamedInNewsBody } from "./player-evidence";
import type { ChatAgentCapHit } from "./chat-agent-limits";
import { planResponse, type ResponseMode } from "./response-plan";

/** Must stay aligned with `MAX_HISTORY_CONTENT_LENGTH` in routes/ask.ts */
export const AGENT_HISTORY_CONTENT_MAX = 4_000;

/** Aligns with Schema-17 `expectNarrowFollowup` length gate for agent delivery. */
export const AGENT_NARROW_DELIVERY_MAX = 900;

const SECTION_LABEL_LINE = /^\s*\*\*[^*\n]+\*\*:?\s*$/;

/** Agent delivery last resort when recovery and grounding copy are both empty. */
export const AGENT_DELIVERY_LAST_RESORT =
  "No bet — I'll keep this to the model sheet and verified sources only.";

export type AgentDeliveredProseRepair = {
  text: string;
  emptyAfterRecovery: boolean;
};

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

const AGENT_PROBABILITY_TAIL = /\b(?:(?:[Hh]ome|[Aa]way|[Dd]raw)\s+(?:(?:is|are|at)\s+)?|[A-Z][A-Za-z.'’-]{1,30}(?:\s+[A-Z][A-Za-z.'’-]{1,30}){0,3}\s+(?:is|are|at)\s+)\*{0,2}\d{1,3}(?:\.\d*)?\*{0,2}\.?\s*$/;

/** Mirrors Schema-17 structural ending checks for agent-packaged answers. */
export function agentDeliveryStructurallyComplete(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if ((trimmed.match(/\*\*/g) ?? []).length % 2 !== 0) return false;
  const probabilityTail = AGENT_PROBABILITY_TAIL.exec(trimmed);
  if (probabilityTail?.index !== undefined) {
    const clause = trimmed.slice(Math.max(
      trimmed.lastIndexOf(".", probabilityTail.index - 1),
      trimmed.lastIndexOf("!", probabilityTail.index - 1),
      trimmed.lastIndexOf("?", probabilityTail.index - 1),
      trimmed.lastIndexOf("\n", probabilityTail.index - 1),
    ) + 1, probabilityTail.index);
    const externalPrice = /\b(?:bet365|bookmakers?|bookies?|kalshi|polymarket|stake)\b[^.!?\n]{0,80}\b(?:has|have|price[sd]?|offers?|quotes?)\b/i.test(clause);
    if (trimmed.slice(Math.max(0, probabilityTail.index - 160), probabilityTail.index).includes("%") && !externalPrice) {
      return false;
    }
  }
  return /[.!?]["'”)]*\s*$/.test(trimmed);
}

function trimToLastCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.!?]["'”)]*\s*$/.test(trimmed)) return trimmed;
  const lastEnd = Math.max(
    trimmed.lastIndexOf(". "),
    trimmed.lastIndexOf("! "),
    trimmed.lastIndexOf("? "),
    trimmed.lastIndexOf(".\n"),
    trimmed.lastIndexOf("!\n"),
    trimmed.lastIndexOf("?\n"),
  );
  if (lastEnd >= 0) return trimmed.slice(0, lastEnd + 1).trim();
  const loneEnd = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("!"), trimmed.lastIndexOf("?"));
  if (loneEnd > trimmed.length * 0.45) return trimmed.slice(0, loneEnd + 1).trim();
  return "";
}

export function completeAgentAnswerEnding(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return trimmed;
  const boldCount = (trimmed.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) {
    const lastOpen = trimmed.lastIndexOf("**");
    if (lastOpen > 0) trimmed = trimmed.slice(0, lastOpen).trim();
  }
  const probabilityTail = AGENT_PROBABILITY_TAIL.exec(trimmed);
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
  if (!/[.!?]["'”)]*\s*$/.test(trimmed)) {
    trimmed = trimToLastCompleteSentence(trimmed);
  }
  return trimmed.trim();
}

function unwrapAgentGuaranteeBoldWrapper(text: string): string {
  let trimmed = text.trim();
  trimmed = trimmed.replace(
    /^\*\*No\s*[—–-]\s*\*\*\s*(I\s+(?:can'?t|cannot)\s+guarantee[^.!?]*[.!?])\s*/i,
    "$1 ",
  );
  trimmed = trimmed.replace(
    /^\*\*No\s*[—–-]\s*([^*]+)\*\*\s*/i,
    "$1 ",
  );
  trimmed = trimmed.replace(/^\*\*No\s*[—–-]\s*\*\*\s*/i, "");
  return trimmed.trim();
}

/** Agent-only formatting: drop meta table prefaces and bold guarantee wrappers. */
export function ensureAgentDirectAnswerLead(text: string, _question?: string): string {
  let trimmed = text.trim();
  trimmed = trimmed.replace(
    /^Here(?:'|')?s how the (?:current )?(?:Premier League )?table looks[^:]*:\s*/i,
    "",
  );
  return unwrapAgentGuaranteeBoldWrapper(trimmed);
}

/**
 * Narrow delivery cap: sentence boundaries only — never mid-clause chop.
 * Falls back to the input when no structurally complete prefix fits.
 */
export function capAgentNarrowDelivery(text: string, maxLen = AGENT_NARROW_DELIVERY_MAX): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= maxLen) return trimmed;

  let working = completeAgentAnswerEnding(trimmed);
  let slice = working.slice(0, maxLen);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (lastSentenceEnd > maxLen * 0.45) slice = slice.slice(0, lastSentenceEnd + 1);
  working = completeAgentAnswerEnding(slice.trim());
  if (working.length > 0 && working.length <= maxLen && agentDeliveryStructurallyComplete(working)) {
    return working;
  }

  const sentenceOnly = trimToLastCompleteSentence(working.slice(0, maxLen));
  if (
    sentenceOnly.length > 0
    && sentenceOnly.length <= maxLen
    && agentDeliveryStructurallyComplete(sentenceOnly)
  ) {
    return sentenceOnly;
  }

  const fromFull = trimToLastCompleteSentence(trimmed.slice(0, maxLen));
  if (
    fromFull.length > 0
    && fromFull.length <= maxLen
    && agentDeliveryStructurallyComplete(fromFull)
  ) {
    return fromFull;
  }

  return trimmed;
}

const NARROW_AGENT_MODES: ReadonlySet<ResponseMode> = new Set([
  "pricing-desk",
  "totals",
  "btts",
  "exact-score",
  "fair-price",
  "match-follow-up",
  "player-or-scorer",
  "table",
  "season",
  "market-comparison",
  "stake-refusal",
  "user-line",
]);

function stripUnrequestedPricingEssay(text: string, mode: ResponseMode, question: string): string {
  if (mode !== "pricing-desk") return text;
  if (/\b(?:injur|team news|line-?up|availability)\b/i.test(question)) return text;
  const cut = text.search(/\n(?:##\s|\*\*(?:Team News|Form(?: Check)?)\*\*)/i);
  return cut >= 0 ? text.slice(0, cut).trim() : text;
}

function collapseExtraAgentSectionLabels(text: string, maxSections: number): string {
  if (maxSections >= 2) return text;
  const lines = text.split("\n");
  let labelsSeen = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (SECTION_LABEL_LINE.test(line)) {
      labelsSeen += 1;
      if (labelsSeen > maxSections) break;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function trimAgentDeliveryForPlan(
  text: string,
  question: string,
  options: { hasHistory?: boolean; groundingKind?: string | null } = {},
): string {
  const plan = planResponse(question, {
    hasHistory: Boolean(options.hasHistory),
    groundingKind: options.groundingKind ?? null,
  });
  let trimmed = ensureAgentDirectAnswerLead(text, question);
  trimmed = stripUnrequestedPricingEssay(trimmed, plan.mode, question);
  trimmed = collapseExtraAgentSectionLabels(trimmed, plan.maxSections);
  const narrow = Boolean(options.hasHistory) || NARROW_AGENT_MODES.has(plan.mode);
  if (narrow && trimmed.length > AGENT_NARROW_DELIVERY_MAX) {
    trimmed = capAgentNarrowDelivery(trimmed, AGENT_NARROW_DELIVERY_MAX);
  }
  return trimmed.trim();
}

export function capAgentAnswerForHistory(text: string, maxLen = AGENT_HISTORY_CONTENT_MAX): string {
  let trimmed = completeAgentAnswerEnding(text.trim());
  if (trimmed.length <= maxLen) return trimmed;
  let slice = trimmed.slice(0, maxLen);
  const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastSentenceEnd > maxLen * 0.45) slice = slice.slice(0, lastSentenceEnd + 1);
  trimmed = completeAgentAnswerEnding(slice.trim());
  if (trimmed.length <= maxLen && agentDeliveryStructurallyComplete(trimmed)) return trimmed;
  const sentenceOnly = trimToLastCompleteSentence(trimmed.slice(0, maxLen));
  if (sentenceOnly.length > 0 && sentenceOnly.length <= maxLen && agentDeliveryStructurallyComplete(sentenceOnly)) {
    return sentenceOnly;
  }
  if (trimmed.length <= maxLen && agentDeliveryStructurallyComplete(trimmed)) return trimmed;
  const fallback = sentenceOnly.length > 0 ? sentenceOnly : trimmed.slice(0, maxLen).trim();
  if (fallback.length > maxLen) {
    return (trimToLastCompleteSentence(fallback.slice(0, maxLen)) || fallback.slice(0, maxLen).trim()).slice(0, maxLen);
  }
  return fallback.length > 0 ? fallback : text.trim().slice(0, maxLen).trim();
}

function polishAgentDeliveredProse(
  prose: string,
  options: {
    voice?: "desk";
    question?: string;
    hasHistory?: boolean;
    groundingKind?: string | null;
  },
  trimStructuralTail: (text: string) => string,
): string {
  let text = trimStructuralTail(prose.trim());
  if (options.voice === "desk") text = rewriteDeskCitationMarkdown(text);
  text = completeAgentAnswerEnding(text);
  if (options.question) {
    text = trimAgentDeliveryForPlan(text, options.question, {
      hasHistory: options.hasHistory,
      groundingKind: options.groundingKind,
    });
  }
  return capAgentAnswerForHistory(text);
}

/**
 * Agent delivery must never return empty or mid-sentence prose after a cap or
 * truncated generation. Structural tail repair runs first; incomplete output
 * falls back to server-owned evidence or grounding copy.
 */
export function repairAgentDeliveredProse(
  prose: string,
  options: {
    voice?: "desk";
    capHit?: ChatAgentCapHit | null;
    question?: string;
    hasHistory?: boolean;
    groundingKind?: string | null;
    recover: () => string;
    groundedFallback?: () => string;
  },
  trimStructuralTail: (text: string) => string,
): AgentDeliveredProseRepair {
  let text = polishAgentDeliveredProse(prose, options, trimStructuralTail);
  if (!text.trim() || !agentDeliveryStructurallyComplete(text)) {
    text = polishAgentDeliveredProse(options.recover(), options, trimStructuralTail);
  }
  if (!text.trim()) {
    const grounded = options.groundedFallback?.().trim() ?? "";
    if (grounded) {
      text = polishAgentDeliveredProse(grounded, options, trimStructuralTail);
    }
  }
  if (!text.trim()) {
    text = AGENT_DELIVERY_LAST_RESORT;
  }
  return {
    text,
    emptyAfterRecovery: text === AGENT_DELIVERY_LAST_RESORT,
  };
}

export function finalizeAgentPackagedAnswer(
  prose: string,
  options: {
    voice?: "desk";
    question?: string;
    hasHistory?: boolean;
    groundingKind?: string | null;
  } = {},
  trimStructuralTail: (text: string) => string = (text) => text,
): string {
  return polishAgentDeliveredProse(prose, options, trimStructuralTail);
}
