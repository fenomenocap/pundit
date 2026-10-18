import type { AskCitation, AskGrounding, AskVerification, EvidenceBundle } from "./ask";
import { assertsSquadAvailability } from "./answer-provenance";
import {
  formatDeskCitationDate,
  renderDatedClubNewsRecords,
  rewriteDeskCitationMarkdown,
  type DeskEvidenceRow,
} from "./desk-voice";
import { datedClubNewsSources } from "./player-evidence";
import { singleClubCurrentFactScope } from "./federated-evidence";
import { planResponse } from "./response-plan";
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

const DATED_CLUB_NEWS_QUESTION =
  /\b(?:latest|dated)\b[^?\n]{0,80}\b(?:club )?injur(?:y|ies)\b|\b(?:injury|injuries)\b[^?\n]{0,40}\b(?:updates?|reports?)\b/i;

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

function validCitationRow(source: AskCitation, nowMs: number): boolean {
  const day = ISO_DAY.exec(source?.date ?? "")?.[1];
  const published = Date.parse(source?.date ?? "");
  let validUrl = false;
  try {
    validUrl = ["http:", "https:"].includes(new URL(source.url).protocol);
  } catch {
    return false;
  }
  return validUrl && /^S\d+$/.test(source.id ?? "") && Boolean(source.title?.trim())
    && Boolean(day) && Number.isFinite(published) && published <= nowMs
    && nowMs - published <= 21 * 24 * 60 * 60 * 1000
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

function pickManagerCitation(citations: AskCitation[], bundle: EvidenceBundle, nowMs: number): AskCitation | undefined {
  const rows = citations.filter((c) => validCitationRow(c, nowMs));
  if (!rows.length) return undefined;
  const preferClubSite = (url: string) => /\.(com|co\.uk)\//.test(url) && !/(linkedin|twitter|x\.com|facebook)/i.test(url);
  return rows.sort((a, b) => Number(preferClubSite(b.url)) - Number(preferClubSite(a.url)))[0];
}

function extractManagerName(prose: string, club: string): string | undefined {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clubRe = escape(club);
  const name = "([\\p{Lu}][\\p{L}\\p{M}'’.-]+(?:\\s+[\\p{Lu}][\\p{L}\\p{M}'’.-]+){1,3})";
  const patterns = [
    new RegExp(`${clubRe}(?:['’]s|['’])?\\s+(?:current\\s+)?(?:manager|head coach|coach|boss)\\s+is\\s+${name}`, "iu"),
    new RegExp(`${name}\\s+(?:is|remains)\\s+(?:the\\s+)?(?:${clubRe}(?:['’]s|['’])?\\s+)?(?:current\\s+)?(?:manager|head coach|coach|boss)`, "iu"),
    new RegExp(`\\*\\*${name}\\*\\*`, "u"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prose.replace(/\*\*/g, ""));
    const value = match?.[1]?.trim();
    if (value && value.split(/\s+/).every((part) => /^\p{Lu}/u.test(part))
      && !/^(?:The|Current|Manager|Coach|Unknown)$/i.test(value)) {
      return value.replace(/\s+(?:today|currently)$/i, "");
    }
  }
  const bold = /\*\*([\p{Lu}][\p{L}\p{M}'’.-]+(?:\s+[\p{Lu}][\p{L}\p{M}'’.-]+){1,3})\*\*/u.exec(prose);
  if (bold?.[1]) return bold[1].trim();
  const loose = /\bmanager is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/.exec(prose.replace(/\*/g, ""));
  return loose?.[1]?.trim();
}

export function normalizeAgentManagerAnswer(
  question: string,
  grounding: AskGrounding,
  prose: string,
  citations: AskCitation[],
  bundle: EvidenceBundle,
  nowMs = Date.now(),
): { prose: string; verification: AskVerification } {
  const scope = singleClubCurrentFactScope(question, grounding);
  const fallbackVerification: AskVerification = {
    status: "not-required",
    supportedClaimCount: 0,
    removedClaimCount: 0,
  };
  if (scope?.kind !== "manager") {
    return { prose, verification: fallbackVerification };
  }
  const citation = pickManagerCitation(citations, bundle, nowMs);
  const name = extractManagerName(prose, scope.club);
  if (!citation || !name) {
    return { prose, verification: fallbackVerification };
  }
  const displayDate = formatDeskCitationDate(citation.date);
  const title = citation.title.replace(/[\[\]]/g, "").trim();
  const lead = `${scope.club}'s manager is ${name} ([${title}](${citation.url}) · ${displayDate}).`;
  const tail = prose
    .replace(/^\s*\*{0,2}[^*\n]+manager[^*\n]*\*{0,2}[^.!?]*[.!?]\s*/i, "")
    .trim();
  const merged = tail && !tail.toLowerCase().startsWith(name.toLowerCase())
    ? `${lead} ${tail}`.trim()
    : lead;
  return {
    prose: merged,
    verification: { status: "verified", supportedClaimCount: 1, removedClaimCount: 0 },
  };
}

function bundleToDeskRows(bundle: EvidenceBundle): DeskEvidenceRow[] {
  return (bundle.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    date: row.date,
    snippet: row.snippet,
    link: row.url,
  }));
}

function inferStatus(snippet: string): string {
  const lower = snippet.toLowerCase();
  if (/\bruled out\b/.test(lower)) return "is ruled out";
  if (/\bdoubtful\b/.test(lower)) return "may be doubtful";
  if (/\bsidelined\b/.test(lower)) return "is sidelined";
  if (/\bhamstring\b/.test(lower)) return "has been dealing with a hamstring issue";
  if (/\binjur/.test(lower)) return "was reported injured";
  if (/\bback in training\b/.test(lower)) return "has been spotted back in training";
  return "was reported unavailable";
}

function playerFromSnippet(text: string): string | undefined {
  const match = /\b([A-Z][a-z]+(?:['’][A-Z][a-z]+)?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/.exec(text);
  return match?.[1]?.trim();
}

export function tryComposeAgentDatedClubNews(
  question: string,
  grounding: AskGrounding,
  bundle: EvidenceBundle,
  nowMs = Date.now(),
): string | null {
  if (grounding?.kind !== "match" || !DATED_CLUB_NEWS_QUESTION.test(question)) return null;
  const fixture = {
    fixtureId: grounding.fixtureId,
    home: grounding.home,
    away: grounding.away,
    kickoff: grounding.date,
  };
  const sources = datedClubNewsSources(bundle.results ?? [], fixture, nowMs);
  if (!sources.length) return null;
  const evidence = bundleToDeskRows(bundle);
  const updates: { club: string; playerName: string; sourceId: string; statusText: string }[] = [];
  for (const source of sources.slice(0, 3)) {
    const club = [grounding.home, grounding.away].find((side) =>
      `${source.title}\n${source.snippet}`.toLowerCase().includes(side.toLowerCase().split(" ")[0])
    ) ?? grounding.home;
    const playerName = playerFromSnippet(`${source.title}\n${source.snippet}`);
    if (!playerName) continue;
    updates.push({
      club,
      playerName,
      sourceId: source.id,
      statusText: inferStatus(source.snippet),
    });
  }
  if (!updates.length) return null;
  const rendered = renderDatedClubNewsRecords(JSON.stringify({ updates }), evidence, grounding, nowMs);
  if (!rendered) return null;
  return `${rendered} These dated club updates do not establish the starting XI or availability at the future kickoff.`;
}

export function sanitizeAgentCitationArtifacts(text: string): string {
  return text
    .replace(/\]\]/g, "")
    .replace(/\)\(https?:\/\//g, " (")
    .replace(/\[\[S\d+\]\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sentenceHasSourceAndDate(sentence: string): boolean {
  return SOURCE_AND_DATE.test(sentence)
    || /\(\[[^\]]+\]\(https?:\/\/[^\s)]+\)[^)]*\)/.test(sentence);
}

export function enrichAgentTeamNewsAttribution(answer: string, bundle: EvidenceBundle): string {
  const byId = new Map((bundle.results ?? []).map((source) => [source.id, source]));
  const regions = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const enriched = regions.map((region) => {
    if (!assertsSquadAvailability(region) || sentenceHasSourceAndDate(region)) return region;
    const marker = /(?:\[\[|\[\()(S\d+)\]?/.exec(region)?.[1] ?? /S(\d+)/.exec(region)?.[1];
    const source = marker ? byId.get(`S${Number(marker)}`) ?? byId.get(marker) : bundle.results?.[0];
    if (!source?.url) return region;
    const pub = formatDeskCitationDate(source.date || "undated");
    const host = (() => {
      try {
        return new URL(source.url).hostname.replace(/^www\./, "");
      } catch {
        return source.title.split(/\s+/)[0];
      }
    })();
    const tail = ` (${host}, ${pub}) ([${source.title.replace(/[\[\]]/g, "")}](${source.url}), ${source.date || "undated"})`;
    return `${region.replace(/\s+$/, "")}${tail}.`;
  });
  return enriched.join(" ");
}

function countDatedClubNewsRecords(answer: string, citations: AskCitation[], nowMs: number): number {
  const sourceRows = citations.filter((c) => {
    const published = Date.parse(c.date);
    const day = ISO_DAY.exec(c.date)?.[1];
    return validCitationRow(c, nowMs) && published <= nowMs && nowMs - published <= 7 * 24 * 60 * 60 * 1000 && day;
  });
  const linkPattern = /\[(?:[^\[\]]|\[[^\[\]]*\])+\]\((https?:\/\/[^\s)]+)\)/g;
  const regions = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  return regions.filter((region) => {
    const publicationDay = /\bIn an update published on (\d{4}-\d{2}-\d{2}),/i.exec(region)?.[1];
    if (!publicationDay) return false;
    const urls = [...region.matchAll(linkPattern)].map((match) => match[1]);
    return /[\p{L}\p{M}][\p{L}\p{M} .-]{1,50}['’]s\s+\p{Lu}/u.test(region)
      && sourceRows.some((source) => source.date.slice(0, 10) === publicationDay && urls.includes(source.url));
  }).length;
}

export function agentTeamNewsVerification(
  question: string,
  answer: string,
  citations: AskCitation[],
  nowMs = Date.now(),
): AskVerification {
  const plan = planResponse(question, { groundingKind: "match" });
  const datedQuestion = DATED_CLUB_NEWS_QUESTION.test(question);
  if (plan.mode !== "team-news" && !datedQuestion) {
    return { status: "not-required", supportedClaimCount: 0, removedClaimCount: 0 };
  }
  const datedCount = countDatedClubNewsRecords(answer, citations, nowMs);
  if (datedCount > 0) {
    return { status: "verified", supportedClaimCount: datedCount, removedClaimCount: 0 };
  }
  const hasSourced = answer.split(/(?<=[.!?])\s+|\n+/).some((region) =>
    assertsSquadAvailability(region) && sentenceHasSourceAndDate(region)
  );
  if (hasSourced && citations.length > 0) {
    return { status: "verified", supportedClaimCount: citations.length, removedClaimCount: 0 };
  }
  return { status: "not-required", supportedClaimCount: 0, removedClaimCount: 0 };
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
  question: string,
  grounding: AskGrounding,
  bundle: EvidenceBundle,
  prose: string,
  citations: AskCitation[],
  options: { hasHistory?: boolean; voice?: "desk" } = {},
): { prose: string; citations: AskCitation[]; verification: AskVerification } {
  let text = sanitizeAgentCitationArtifacts(prose);
  const composed = tryComposeAgentDatedClubNews(question, grounding, bundle);
  if (composed) text = composed;
  else if (planResponse(question, { groundingKind: grounding?.kind ?? null }).mode === "team-news") {
    text = enrichAgentTeamNewsAttribution(text, bundle);
  }
  if (options.voice === "desk") text = rewriteDeskCitationMarkdown(text);
  text = completeAgentAnswerEnding(text);
  text = capAgentAnswerForHistory(text);
  const manager = normalizeAgentManagerAnswer(question, grounding, text, citations, bundle);
  text = manager.prose;
  const teamNews = agentTeamNewsVerification(question, text, citations);
  const verification = manager.verification.status === "verified"
    ? manager.verification
    : teamNews;
  return { prose: text, citations, verification };
}
