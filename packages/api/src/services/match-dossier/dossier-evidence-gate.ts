import { decodeHtmlEntitiesForEvidence } from "../article-body-extract";
import type { PagePublicationDateSource } from "../evidence-page-retrieval";
import type { ModelFixture } from "../model-data";
import type { DossierEvidenceCategory } from "./types";
import { categoryForQuery } from "./dossier-evidence";
import { isDossierSyntheticTestFixture } from "./dossier-synthetic-fixture";

const MS_PER_DAY = 86_400_000;

/** Max age from dossier asOf for each category (all also require current season). */
export const CATEGORY_WINDOW_DAYS: Record<DossierEvidenceCategory, number> = {
  injuries: 14,
  rotation: 14,
  manager: 120,
  motivation: 14,
  tactics: 14,
  "travel-congestion": 14,
};

const CLUB_ALIASES: Record<string, string[]> = {
  Arsenal: ["arsenal"],
  "Aston Villa": ["aston villa", "villa"],
  Bournemouth: ["bournemouth", "afc bournemouth"],
  Brentford: ["brentford"],
  Brighton: ["brighton", "brighton and hove albion", "brighton & hove albion"],
  Chelsea: ["chelsea"],
  Coventry: ["coventry", "coventry city"],
  "Crystal Palace": ["crystal palace", "palace", "cpfc"],
  Everton: ["everton"],
  Fulham: ["fulham"],
  Hull: ["hull", "hull city"],
  Ipswich: ["ipswich", "ipswich town"],
  Leeds: ["leeds", "leeds united"],
  Liverpool: ["liverpool"],
  "Man City": ["man city", "manchester city", "city"],
  "Man United": ["man united", "manchester united", "united"],
  Newcastle: ["newcastle", "newcastle united"],
  Forest: ["forest", "nottingham forest", "nott'm forest", "nottingham"],
  Sunderland: ["sunderland"],
  Tottenham: ["tottenham", "tottenham hotspur", "spurs"],
};

const NAV_BOILERPLATE =
  /skip to (main )?content|home\s+news\s+sport|business\s+innovation|culture\s+travel|bbc homepage/i;

const HUB_PAGE =
  /fantasy premier league|\bfpl\b.*hub|\/fantasy\//i;

const PROMO_CHROME =
  /hospitality on sale|matchday hospitality|shop hospitality|premier league matchday hospitality|search query for search|^search query/i;

const YAHOO_NAV =
  /search query for search|yahoo\s+home\s+news/i;

const WOMENS_OR_YOUTH =
  /\b(wsl|women'?s|ladies|uwcl|fawsl|fa wsl)\b|\b(u-?21|under-?21|under 21|u23|under-?23|academy|youth team|development squad)\b/i;

/** Opponents named in injury/lineup pieces that are not this EPL fixture. */
const OTHER_COMPETITION_OPPONENT =
  /\b(?:vs\.?|v\.|against|versus)\s+(bayern|villarreal|viking|real madrid|barcelona|juventus|milan|inter milan|psg|paris saint-germain|ajax|benfica|sporting cp)\b/i;

const NON_PL_COMPETITION_CONTEXT =
  /\b(champions league|uefa champions|\bucl\b|europa league|\buel\b|uefa europa|conference league|\buecl\b|nations league|world cup|international friendly|club friendly|\bfriendly\b)\b|(?:^|[/-])(?:ucl|uel|uecl|champions-league|europa-league|conference-league|nations-league)(?:[/-]|$)/i;

const INTERNATIONAL_FIXTURE =
  /\b(scotland|slovenia|england|wales|northern ireland|norway|spain|france|germany|italy|portugal|brazil|argentina|usa|netherlands|belgium|croatia|serbia|turkey|ukraine|poland|denmark|sweden|austria|switzerland|hungary|romania|greece|czech republic|republic of ireland|ireland)\s+(?:vs\.?|v\.?|against|versus)\s+(scotland|slovenia|england|wales|northern ireland|norway|spain|france|germany|italy|portugal|brazil|argentina|usa|netherlands|belgium|croatia|serbia|turkey|ukraine|poland|denmark|sweden|austria|switzerland|hungary|romania|greece|czech republic|republic of ireland|ireland)\b/i;

const PRIOR_ROUND_LANGUAGE =
  /\b(pivotal weekend|last weekend|previous round|prior round|matchday|gameweek|round of|that weekend|this weekend's|weekend of)\b/i;

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** European / cup opponents referenced in team-news URLs and titles. */
const EURO_CLUB_ALIASES: Record<string, string[]> = {
  Villarreal: ["villarreal"],
  Bayern: ["bayern", "bayern munich"],
  Viking: ["viking", "fk viking"],
};

const FOOTBALL_FACT =
  /\b(injur|doubtful|suspended|ban|available|unavailable|line-?up|starting xi|rotation|manager|head coach|press conference|ruled out|fitness|hamstring|knock|card|sent off|goal|assist|clean sheet|form|relegation|title race|tactic|press|midfield|defence|defense)\b/i;

export type DossierPublishedAtSource = PagePublicationDateSource | "search-result";

export interface EvidenceGateContext {
  asOf: Date;
  kickoffUtc: string;
}

export interface EvidenceCandidateInput {
  title: string;
  snippet: string;
  url: string;
  publishedAtRaw: string;
  query: string;
}

export interface ResolvedEvidenceDate {
  iso: string;
  source: DossierPublishedAtSource;
}

function canonicalClub(label: string): string | null {
  const norm = label.trim().toLocaleLowerCase();
  for (const [canonical, aliases] of Object.entries(CLUB_ALIASES)) {
    if (canonical.toLocaleLowerCase() === norm) return canonical;
    if (aliases.includes(norm)) return canonical;
  }
  for (const [canonical, aliases] of Object.entries(EURO_CLUB_ALIASES)) {
    if (canonical.toLocaleLowerCase() === norm) return canonical;
    if (aliases.includes(norm)) return canonical;
  }
  return null;
}

function fixtureCanonicalTeams(fixture: ModelFixture): { home: string; away: string } {
  return {
    home: canonicalClub(fixture.home) ?? fixture.home,
    away: canonicalClub(fixture.away) ?? fixture.away,
  };
}

function allAliasPatterns(): Array<{ canonical: string; pattern: RegExp }> {
  const rows: Array<{ canonical: string; pattern: RegExp }> = [];
  for (const [canonical, aliases] of Object.entries(CLUB_ALIASES)) {
    const parts = [canonical, ...aliases].map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    rows.push({ canonical, pattern: new RegExp(`\\b(${parts.join("|")})\\b`, "i") });
  }
  return rows;
}

function clubsFoundInText(text: string): Set<string> {
  const found = new Set<string>();
  for (const { canonical, pattern } of allAliasPatterns()) {
    if (pattern.test(text)) found.add(canonical);
  }
  return found;
}

function parseVsPairLoose(text: string): [string, string] | null {
  const match = text.match(
    /([\w\s'&]+?)\s+(?:vs\.?|v)\s+([\w\s'&]+?)(?:\s+[:–-]|$|\s+team|\s+confirmed|\s+preview|\s+line|\s+injury|\s+news|\s+suspended|\s+players)/i,
  );
  if (!match) return null;
  const left = canonicalClub(match[1]!.trim());
  const right = canonicalClub(match[2]!.trim());
  if (!left || !right) return null;
  return [left, right];
}

function parseVsPair(text: string): [string, string] | null {
  return parseVsPairLoose(text);
}

export function parseVsPairFromUrl(url: string): [string, string] | null {
  try {
    const path = new URL(url).pathname.toLocaleLowerCase();
    const slug = path.match(/\/([a-z0-9]+(?:-[a-z0-9]+)*)-vs-([a-z0-9]+(?:-[a-z0-9]+)*)/);
    if (!slug) return null;
    const trimSlugSide = (raw: string) => raw
      .replace(/-(team-news|injury-news|preview|line-ups|lineups|predicted-lineups|suspended-players|player-news).*$/i, "")
      .replace(/-/g, " ");
    const left = canonicalClub(trimSlugSide(slug[1]!));
    const right = canonicalClub(trimSlugSide(slug[2]!));
    if (!left || !right) return null;
    return [left, right];
  } catch {
    return null;
  }
}

function fixturePairMatches(
  fixture: ModelFixture,
  pair: [string, string],
): boolean {
  const { home, away } = fixtureCanonicalTeams(fixture);
  const [a, b] = pair;
  return (a === home && b === away) || (a === away && b === home);
}

function gateFixtureVsPair(
  fixture: ModelFixture,
  pair: [string, string],
): string | null {
  if (fixturePairMatches(fixture, pair)) return null;
  const { home, away } = fixtureCanonicalTeams(fixture);
  const allowed = new Set([home, away]);
  const [a, b] = pair;
  if (allowed.has(a) || allowed.has(b)) return "match_context_wrong_opponent";
  return "fixture_mismatch:vs_pair";
}

function isFixtureSensitiveCategory(category: DossierEvidenceCategory): boolean {
  return category === "injuries" || category === "rotation";
}

export function parseEvidencePublishedAt(raw: string): Date | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T12:00:00.000Z`);
  return null;
}

export function resolveEvidencePublishedAt(
  searchDateRaw: string,
  pageDateRaw: string,
  pageDateSource: PagePublicationDateSource | undefined,
): ResolvedEvidenceDate | null {
  const fromSearch = parseEvidencePublishedAt(searchDateRaw);
  if (fromSearch) {
    return { iso: fromSearch.toISOString(), source: "search-result" };
  }
  const fromPage = parseEvidencePublishedAt(pageDateRaw);
  if (fromPage && pageDateSource) {
    return { iso: fromPage.toISOString(), source: pageDateSource };
  }
  return null;
}

export function seasonStartUtc(kickoffUtc: string): Date {
  const kickoff = new Date(kickoffUtc);
  const year = kickoff.getUTCFullYear();
  const month = kickoff.getUTCMonth();
  const startYear = month >= 7 ? year : year - 1;
  return new Date(Date.UTC(startYear, 7, 1));
}

export function seasonEndUtc(kickoffUtc: string): Date {
  const start = seasonStartUtc(kickoffUtc);
  return new Date(Date.UTC(start.getUTCFullYear() + 1, 6, 1));
}

/** (1) Fixture team match for injuries / lineups. */
export function gateFixtureTeamMatch(
  fixture: ModelFixture,
  title: string,
  claim: string,
  category: DossierEvidenceCategory,
  url = "",
): string | null {
  if (!isFixtureSensitiveCategory(category)) return null;
  if (isDossierSyntheticTestFixture(fixture)) return null;
  const { home, away } = fixtureCanonicalTeams(fixture);
  const metaText = `${title} ${url} ${claim}`;
  if (NON_PL_COMPETITION_CONTEXT.test(metaText)) return "match_context_non_pl_competition";
  if (INTERNATIONAL_FIXTURE.test(metaText)) return "claim_subject_international";
  for (const pair of [
    parseVsPair(title),
    parseVsPairFromUrl(url),
    parseVsPair(claim),
  ]) {
    if (!pair) continue;
    const reason = gateFixtureVsPair(fixture, pair);
    if (reason) return reason;
  }
  const text = `${title} ${claim}`;
  const mentioned = clubsFoundInText(text);
  const allowed = new Set([home, away]);
  for (const club of mentioned) {
    if (!allowed.has(club)) return "fixture_mismatch:foreign_club";
  }
  if (mentioned.size === 0) return "fixture_mismatch:no_fixture_club";
  return null;
}

/** (6) Current season + per-category recency window for every category. */
export function gateSeasonAndCategoryWindow(
  category: DossierEvidenceCategory,
  publishedAt: Date,
  claim: string,
  ctx: EvidenceGateContext,
): string | null {
  const seasonStart = seasonStartUtc(ctx.kickoffUtc);
  const seasonEnd = seasonEndUtc(ctx.kickoffUtc);
  if (publishedAt < seasonStart || publishedAt >= seasonEnd) {
    return "outside_current_season";
  }
  const ageDays = (ctx.asOf.getTime() - publishedAt.getTime()) / MS_PER_DAY;
  if (ageDays < -1) return "published_at_in_future";
  const windowDays = CATEGORY_WINDOW_DAYS[category];
  if (ageDays > windowDays) {
    return `category_window_exceeded_${windowDays}d`;
  }
  if (category === "manager") {
    const text = claim.toLocaleLowerCase();
    const currentRole = /\b(remains|continue|continues|still|current|head coach for|manager for)\b/.test(text)
      && /\b(2026|2026\/27|2026-27|this season|premier league season)\b/.test(text);
    if (!currentRole && /\bappointed\b|\bnamed\b|\bnew head coach\b/.test(text)) {
      if (publishedAt < seasonStart) return "manager_stale_appointment";
    }
  }
  return null;
}

/** (3) Stale previews / hub pages. */
export function gateStaleOrHub(
  title: string,
  claim: string,
  url: string,
  category: DossierEvidenceCategory,
  publishedAt: Date | null,
  ctx: EvidenceGateContext,
): string | null {
  const text = `${title} ${claim} ${url}`;
  if (HUB_PAGE.test(text)) return "stale_hub_page";
  if (!publishedAt || !isFixtureSensitiveCategory(category)) return null;
  const ageDays = (ctx.asOf.getTime() - publishedAt.getTime()) / MS_PER_DAY;
  if (ageDays > CATEGORY_WINDOW_DAYS[category]) {
    if (/confirmed team news|team news from|match preview|line-ups? confirmed/i.test(text)) {
      return "stale_prior_meeting";
    }
  }
  const kickoff = Date.parse(ctx.kickoffUtc);
  if (Number.isFinite(kickoff) && publishedAt.getTime() < kickoff - 120 * MS_PER_DAY) {
    if (/confirmed team news|starting xi|line-up/i.test(text)) {
      return "stale_prior_meeting";
    }
  }
  return null;
}

export function stripNavBoilerplate(pageText: string): string {
  const lines = pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const cleaned: string[] = [];
  let passedNav = false;
  for (const line of lines) {
    if (!passedNav) {
      if (NAV_BOILERPLATE.test(line) && line.length < 200) continue;
      if (/^(home|news|sport|menu)$/i.test(line)) continue;
      passedNav = true;
    }
    if (NAV_BOILERPLATE.test(line) && line.split(/\s+/).length > 8) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

export function claimLooksLikeBoilerplate(claim: string, snippet: string): boolean {
  const text = `${claim} ${snippet}`;
  if (NAV_BOILERPLATE.test(text)) return true;
  if (/^(home|news|sport|business)\s+(home|news|sport)/i.test(text)) return true;
  return false;
}

export function decodeEvidenceClaimText(text: string): string {
  return decodeHtmlEntitiesForEvidence(text).replace(/\s+/g, " ").trim();
}

function sentenceMentionsFixtureClub(fixture: ModelFixture, sentence: string): boolean {
  if (isDossierSyntheticTestFixture(fixture)) {
    const lower = sentence.toLocaleLowerCase();
    return lower.includes(fixture.home.toLocaleLowerCase()) || lower.includes(fixture.away.toLocaleLowerCase());
  }
  const { home, away } = fixtureCanonicalTeams(fixture);
  const mentioned = clubsFoundInText(sentence);
  return mentioned.has(home) || mentioned.has(away);
}

export function sentenceLooksLikePromoOrNav(sentence: string): boolean {
  const text = sentence.trim();
  if (text.length < 40) return true;
  if (NAV_BOILERPLATE.test(text)) return true;
  if (PROMO_CHROME.test(text)) return true;
  if (YAHOO_NAV.test(text)) return true;
  if (/^[\w\s'&]+ — [\w\s'&]+$/i.test(text) && text.split("—").every((part) => part.trim().split(/\s+/).length <= 6)) {
    return true;
  }
  return false;
}

export function sentenceHasFootballFact(sentence: string): boolean {
  return FOOTBALL_FACT.test(sentence);
}

export function gateTeamScope(title: string, bodyText: string): string | null {
  const text = `${title} ${bodyText}`;
  if (WOMENS_OR_YOUTH.test(text)) return "team_scope_womens_or_youth";
  return null;
}

function normalizeHeadlineTokens(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(the|and|for|with|from|that|this|have|will|are|was|were|has|had)$/.test(w));
}

export function gateHeadlineMismatch(searchTitle: string, articleHeadline: string): string | null {
  if (!articleHeadline.trim()) return null;
  const personName = /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/.exec(searchTitle)?.[1];
  if (personName && !articleHeadline.toLocaleLowerCase().includes(personName.toLocaleLowerCase())) {
    return "headline_mismatch";
  }
  const a = normalizeHeadlineTokens(searchTitle);
  const b = normalizeHeadlineTokens(articleHeadline);
  if (a.length < 2 || b.length < 2) return null;
  const setB = new Set(b);
  const overlap = a.filter((t) => setB.has(t)).length;
  const ratio = overlap / Math.min(a.length, b.length);
  if (ratio < 0.34) return "headline_mismatch";
  return null;
}

/** Injuries / lineups must target this fixture, not another opponent or prior meeting. */
export function gateClaimSubjectScope(
  fixture: ModelFixture,
  claim: string,
  title: string,
  category: DossierEvidenceCategory,
): string | null {
  if (isDossierSyntheticTestFixture(fixture)) return null;
  const combined = `${title} ${claim}`;
  if (INTERNATIONAL_FIXTURE.test(combined)) return "claim_subject_international";
  const { home, away } = fixtureCanonicalTeams(fixture);
  const allowed = new Set([home, away]);
  const mentioned = clubsFoundInText(combined);
  for (const club of mentioned) {
    if (!allowed.has(club)) return "claim_subject_foreign_club";
  }
  void category;
  return null;
}

export function gatePriorRoundReference(
  title: string,
  claim: string,
  ctx: EvidenceGateContext,
): string | null {
  const text = `${title} ${claim}`;
  if (!PRIOR_ROUND_LANGUAGE.test(text)) return null;
  const kickoff = new Date(ctx.kickoffUtc);
  if (!Number.isFinite(kickoff.getTime())) return null;
  const yearHint = kickoff.getUTCFullYear();
  let latestReferenced: Date | null = null;

  const range = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (range) {
    const endDay = Number.parseInt(range[2]!, 10);
    const monthKey = range[3]!.slice(0, 3).toLocaleLowerCase();
    const month = MONTH_NAME_TO_INDEX[monthKey];
    if (month != null) latestReferenced = new Date(Date.UTC(yearHint, month, endDay, 23, 59, 59));
  }
  const single = text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (single) {
    const day = Number.parseInt(single[1]!, 10);
    const monthKey = single[2]!.slice(0, 3).toLocaleLowerCase();
    const month = MONTH_NAME_TO_INDEX[monthKey];
    if (month != null) {
      const d = new Date(Date.UTC(yearHint, month, day, 23, 59, 59));
      if (!latestReferenced || d > latestReferenced) latestReferenced = d;
    }
  }
  if (!latestReferenced) return null;
  const minKickoffGapMs = 2 * MS_PER_DAY;
  if (latestReferenced.getTime() < kickoff.getTime() - minKickoffGapMs) {
    return "freshness_prior_round";
  }
  return null;
}

export function gateContractNotNewsGrade(
  title: string,
  claim: string,
  publishedAt: Date,
  ctx: EvidenceGateContext,
): string | null {
  const text = `${title} ${claim}`.toLocaleLowerCase();
  if (!/\b(contract|new deal|agreed a deal|extension|extended his|extended her|next season|2027\/28|2028\/29)\b/.test(text)) {
    return null;
  }
  const ageDays = (ctx.asOf.getTime() - publishedAt.getTime()) / MS_PER_DAY;
  if (ageDays > 30) return "contract_not_news_grade";
  return null;
}

export function gateUpcomingMatchContext(
  fixture: ModelFixture,
  claim: string,
  category: DossierEvidenceCategory,
  meta?: { title?: string; url?: string },
): string | null {
  if (!isFixtureSensitiveCategory(category)) return null;
  if (isDossierSyntheticTestFixture(fixture)) return null;
  const title = meta?.title ?? "";
  const url = meta?.url ?? "";
  const text = `${title} ${url} ${claim}`.toLocaleLowerCase();
  if (OTHER_COMPETITION_OPPONENT.test(text)) return "match_context_other_opponent";
  const fixtureReason = gateFixtureTeamMatch(fixture, title, claim, category, url);
  if (fixtureReason) return fixtureReason;
  return null;
}

export function findBodySentenceForSnippet(pageText: string, snippet: string): string | null {
  const body = stripNavBoilerplate(pageText);
  const snippetWords = snippet
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  if (snippetWords.length < 3) return null;
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 40);
  for (const sentence of sentences) {
    const lower = sentence.toLocaleLowerCase();
    const hits = snippetWords.filter((w) => lower.includes(w)).length;
    if (hits >= Math.min(4, Math.ceil(snippetWords.length * 0.5)) && !NAV_BOILERPLATE.test(sentence)) {
      return sentence.slice(0, 480);
    }
  }
  return null;
}

/** Pick one verified body sentence: names a fixture club and states a football fact. */
export function selectVerifiedBodyClaim(
  fixture: ModelFixture,
  category: DossierEvidenceCategory,
  articleBody: string,
  searchSnippet: string,
): string | null {
  const body = stripNavBoilerplate(articleBody);
  const snippetWords = searchSnippet
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  const sentences = body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => decodeEvidenceClaimText(s))
    .filter((s) => s.length >= 40 && s.length <= 480);

  let best: { sentence: string; score: number } | null = null;
  for (const sentence of sentences) {
    if (sentenceLooksLikePromoOrNav(sentence)) continue;
    if (!sentenceMentionsFixtureClub(fixture, sentence)) continue;
    if (!sentenceHasFootballFact(sentence)) continue;
    if (gateUpcomingMatchContext(fixture, sentence, category)) continue;
    const lower = sentence.toLocaleLowerCase();
    const hits = snippetWords.length >= 3
      ? snippetWords.filter((w) => lower.includes(w)).length
      : 0;
    const score = hits + (sentenceHasFootballFact(sentence) ? 2 : 0);
    if (!best || score > best.score) best = { sentence, score };
  }
  if (best) return best.sentence.slice(0, 480);
  return findBodySentenceForSnippet(body, searchSnippet);
}

export function evidenceClaimFromInput(input: EvidenceCandidateInput): string {
  return input.title.trim() && input.snippet.trim()
    ? `${input.title.trim()} — ${input.snippet.trim()}`
    : (input.title.trim() || input.snippet.trim());
}

/** Fixture pairing / foreign-club gate (CTO item 1); vacuous pass for non injury/lineup categories. */
export function gateFixtureMatchEvidence(
  fixture: ModelFixture,
  input: EvidenceCandidateInput,
): string | null {
  const category = categoryForQuery(input.query);
  const claim = evidenceClaimFromInput(input);
  return gateFixtureTeamMatch(fixture, input.title, claim, category, input.url);
}

/** Season, category window, and stale preview/hub freshness gates (CTO items 2–3, 6). */
export function gateFreshnessEvidence(
  fixture: ModelFixture,
  input: EvidenceCandidateInput,
  resolved: ResolvedEvidenceDate | null,
  ctx: EvidenceGateContext,
): string | null {
  return gatePostDateResolve(fixture, input, resolved, ctx);
}

export function gatePreFetch(
  fixture: ModelFixture,
  input: EvidenceCandidateInput,
  ctx: EvidenceGateContext,
): string | null {
  if (claimLooksLikeBoilerplate(input.title, input.snippet)) return "boilerplate_chrome";

  const category = categoryForQuery(input.query);
  const claim = evidenceClaimFromInput(input);
  const subjectReason = gateClaimSubjectScope(fixture, claim, input.title, category);
  if (subjectReason) return subjectReason;

  const fixtureReason = gateFixtureMatchEvidence(fixture, input);
  if (fixtureReason) return fixtureReason;

  if (HUB_PAGE.test(`${input.title} ${input.url}`)) return "stale_hub_page";

  void ctx;
  return null;
}

export function gatePostDateResolve(
  fixture: ModelFixture,
  input: EvidenceCandidateInput,
  resolved: ResolvedEvidenceDate | null,
  ctx: EvidenceGateContext,
): string | null {
  const category = categoryForQuery(input.query);
  const claim = evidenceClaimFromInput(input);

  if (!resolved) return "missing_published_at";

  const publishedAt = new Date(resolved.iso);
  const seasonReason = gateSeasonAndCategoryWindow(category, publishedAt, claim, ctx);
  if (seasonReason) return seasonReason;

  const staleReason = gateStaleOrHub(input.title, claim, input.url, category, publishedAt, ctx);
  if (staleReason) return staleReason;

  const priorRound = gatePriorRoundReference(input.title, claim, ctx);
  if (priorRound) return priorRound;

  const contractReason = gateContractNotNewsGrade(input.title, claim, publishedAt, ctx);
  if (contractReason) return contractReason;

  const subjectReason = gateClaimSubjectScope(fixture, claim, input.title, category);
  if (subjectReason) return subjectReason;

  return null;
}

export function gatePageBodyMatch(
  pageText: string,
  snippet: string,
  fixture: ModelFixture,
  category: DossierEvidenceCategory,
): string | null {
  const sentence = selectVerifiedBodyClaim(fixture, category, pageText, snippet);
  if (!sentence) return "boilerplate_no_body_sentence";
  if (sentenceLooksLikePromoOrNav(sentence)) return "boilerplate_chrome";
  if (!sentenceMentionsFixtureClub(fixture, sentence)) return "claim_missing_fixture_club";
  if (!sentenceHasFootballFact(sentence)) return "claim_missing_football_fact";
  const ctx = gateUpcomingMatchContext(fixture, sentence, category);
  if (ctx) return ctx;
  const subject = gateClaimSubjectScope(fixture, sentence, "", category);
  if (subject) return subject;
  return null;
}
