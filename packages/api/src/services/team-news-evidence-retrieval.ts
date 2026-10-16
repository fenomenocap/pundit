import { normalizeTeamName } from "../lib/team-names";
import { evidenceAuthority, type EvidenceTier } from "./evidence-authority";
import { mergeSearchResults } from "./federated-evidence";
import {
  clubNamedInNews,
  datedClubNewsSources,
  selectTeamNewsSources,
  type PlayerEvidenceSource,
  type PlayerFixtureRef,
} from "./player-evidence";
import type { WebSearchOutcome } from "./web-search";

type TeamNewsEvidenceRow = PlayerEvidenceSource & { tier: EvidenceTier };

/** Provider searches reserved so injury/manager site-beat retries can still run. */
export const SITE_BEAT_RETRY_PROVIDER_CALLS = 2;

/** National beats after club-local publishers in site-beat retries. */
export const NATIONAL_NEWS_SITE_BEAT_DEFAULTS = [
  "bbc.com/sport/football",
  "skysports.com/football/news",
] as const;

const CLUB_LOCAL_NEWS_SITE_BEATS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Arsenal", ["football.london"]],
  ["Aston Villa", ["birminghammail.co.uk"]],
  ["Brentford", ["football.london"]],
  ["Chelsea", ["football.london"]],
  ["Crystal Palace", ["football.london"]],
  ["Everton", ["liverpoolecho.co.uk"]],
  ["Fulham", ["football.london"]],
  ["Hull", ["hulldailymail.co.uk"]],
  ["Hull City", ["hulldailymail.co.uk"]],
  ["Liverpool", ["liverpoolecho.co.uk"]],
  ["Manchester City", ["manchestereveningnews.co.uk"]],
  ["Manchester United", ["manchestereveningnews.co.uk"]],
  ["Newcastle United", ["chroniclelive.co.uk"]],
  ["Newcastle", ["chroniclelive.co.uk"]],
  ["Tottenham", ["football.london"]],
  ["West Ham", ["football.london"]],
];

function localNewsSiteBeatsForClub(club: string): readonly string[] {
  const normalized = normalizeTeamName(club);
  for (const [name, beats] of CLUB_LOCAL_NEWS_SITE_BEATS) {
    if (normalizeTeamName(name) === normalized) return beats;
  }
  return [];
}

function uniqueSiteBeats(beats: readonly string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const beat of beats) {
    const key = beat.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(beat);
  }
  return ordered;
}

/** @deprecated Use injurySiteBeatFallbackOrder; kept for transitional imports. */
export const INJURY_ONLY_SITE_BEAT_FALLBACK_ORDER = NATIONAL_NEWS_SITE_BEAT_DEFAULTS;

export function injurySiteBeatFallbackOrder(home: string, away: string): string[] {
  return uniqueSiteBeats([
    ...localNewsSiteBeatsForClub(home),
    ...localNewsSiteBeatsForClub(away),
    ...NATIONAL_NEWS_SITE_BEAT_DEFAULTS,
  ]);
}

export function managerSiteBeatFallbackOrder(club: string): string[] {
  return uniqueSiteBeats([
    ...localNewsSiteBeatsForClub(club),
    ...NATIONAL_NEWS_SITE_BEAT_DEFAULTS,
  ]);
}

export function injurySiteBeatQueries(
  beat: string,
  home: string,
  away: string
): readonly [string, string] {
  return [
    `site:${beat} ${home} injury update`,
    `site:${beat} ${away} injury update`,
  ];
}

export function managerSiteBeatQueries(
  beat: string,
  club: string
): readonly [string] {
  return [`site:${beat} ${club} manager head coach`];
}

const CLUB_INJURY_HINT =
  /\b(?:injur\w*|sidelined|fitness|hamstring|muscle strain|suspension|ruled out)\b/i;

const CLUB_MANAGER_HINT =
  /\b(?:manager|head coach|boss|head-coach)\b/i;

function mentionsFixtureClubInjury(
  source: PlayerEvidenceSource,
  fixture: PlayerFixtureRef
): boolean {
  const text = `${source.title}\n${source.snippet}`;
  return (clubNamedInNews(text, fixture.home) || clubNamedInNews(text, fixture.away))
    && CLUB_INJURY_HINT.test(text);
}

function mentionsClubManager(source: PlayerEvidenceSource, club: string): boolean {
  const text = `${source.title}\n${source.snippet}`;
  return clubNamedInNews(text, club) && CLUB_MANAGER_HINT.test(text);
}

/** Approved injury evidence on the post-selection bundle used by desk settlement. */
export function injuryOnlyTeamNewsHasApprovedEvidenceFromSelected(
  selected: readonly PlayerEvidenceSource[],
  fixture: PlayerFixtureRef,
  now = Date.now()
): boolean {
  if (datedClubNewsSources(selected, fixture, now).length > 0) return true;
  return selected.some((source) => mentionsFixtureClubInjury(source, fixture));
}

/** Approved injury evidence that survives team-news selection and dated filters. */
export function injuryOnlyTeamNewsHasApprovedEvidence(
  sources: readonly PlayerEvidenceSource[],
  fixture: PlayerFixtureRef,
  now = Date.now()
): boolean {
  return injuryOnlyTeamNewsHasApprovedEvidenceFromSelected(
    selectTeamNewsSources([...sources], fixture),
    fixture,
    now
  );
}

/** Retry only when no approved source would survive post-filter selection. */
export function injuryOnlyTeamNewsNeedsSiteBeatRetry(
  sources: readonly PlayerEvidenceSource[],
  fixture: PlayerFixtureRef,
  now = Date.now()
): boolean {
  return !injuryOnlyTeamNewsHasApprovedEvidence(sources, fixture, now);
}

export function managerLookupNeedsSiteBeatRetry(
  sources: readonly PlayerEvidenceSource[],
  club: string
): boolean {
  return !sources.some((source) =>
    evidenceAuthority(source.url) !== "other" && mentionsClubManager(source, club)
  );
}

export function appendTeamNewsSearchResults(
  existing: readonly TeamNewsEvidenceRow[],
  outcomes: readonly WebSearchOutcome[],
  fixture: PlayerFixtureRef,
  maxResults = 30
): TeamNewsEvidenceRow[] {
  return appendEvidenceSearchResults(existing, outcomes, maxResults, (rows) =>
    selectTeamNewsSources(rows, fixture));
}

export function appendManagerSearchResults(
  existing: readonly TeamNewsEvidenceRow[],
  outcomes: readonly WebSearchOutcome[],
  maxResults = 30
): TeamNewsEvidenceRow[] {
  return appendEvidenceSearchResults(existing, outcomes, maxResults, (rows) => rows);
}

function appendEvidenceSearchResults(
  existing: readonly TeamNewsEvidenceRow[],
  outcomes: readonly WebSearchOutcome[],
  maxResults: number,
  finalize: (rows: TeamNewsEvidenceRow[]) => TeamNewsEvidenceRow[]
): TeamNewsEvidenceRow[] {
  const seen = new Set(existing.map((row) => row.url.toLocaleLowerCase()));
  const merged = mergeSearchResults(outcomes, { maxResults });
  const combined: TeamNewsEvidenceRow[] = [...existing];
  for (const row of merged) {
    const url = row.link.trim();
    if (!url) continue;
    const key = url.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push({
      id: "",
      title: row.title,
      url,
      date: row.date,
      snippet: row.snippet,
      tier: row.tier,
    });
  }
  const reindexed = combined.slice(0, maxResults).map((source, index) => ({
    ...source,
    id: `S${index + 1}`,
  }));
  return finalize(reindexed);
}

export function siteBeatRetryWouldExceedBudget(
  providerCallsUsed: number,
  queriesNeeded: number,
  providerCallBudget: number
): boolean {
  return providerCallsUsed + queriesNeeded > providerCallBudget;
}
