import { evidenceAuthority } from "./evidence-authority";
import { mergeSearchResults } from "./federated-evidence";
import {
  clubNamedInNews,
  datedClubNewsSources,
  selectTeamNewsSources,
  type PlayerEvidenceSource,
  type PlayerFixtureRef,
} from "./player-evidence";
import type { WebSearchOutcome } from "./web-search";

/** Beats tried after the initial federated pass when injury-only retrieval is thin. */
export const INJURY_ONLY_SITE_BEAT_FALLBACK_ORDER = [
  "football.london",
  "bbc.com/sport/football",
  "skysports.com/football/news",
] as const;

const CLUB_INJURY_HINT =
  /\b(?:injur\w*|sidelined|fitness|hamstring|muscle strain|suspension|ruled out)\b/i;

export function injurySiteBeatQueries(
  beat: (typeof INJURY_ONLY_SITE_BEAT_FALLBACK_ORDER)[number],
  home: string,
  away: string,
  day: string
): readonly [string, string] {
  return [
    `site:${beat} ${home} injury update ${day}`,
    `site:${beat} ${away} injury update ${day}`,
  ];
}

function mentionsFixtureClubInjury(
  source: PlayerEvidenceSource,
  fixture: PlayerFixtureRef
): boolean {
  const text = `${source.title}\n${source.snippet}`;
  return (clubNamedInNews(text, fixture.home) || clubNamedInNews(text, fixture.away))
    && CLUB_INJURY_HINT.test(text);
}

/** Dated candidates for desk/extractor, or allowlisted club-injury pages that may hydrate. */
export function injuryOnlyTeamNewsNeedsSiteBeatRetry(
  sources: readonly PlayerEvidenceSource[],
  fixture: PlayerFixtureRef,
  now = Date.now()
): boolean {
  if (datedClubNewsSources([...sources], fixture, now).length > 0) return false;
  return !sources.some((source) =>
    evidenceAuthority(source.url) !== "other" && mentionsFixtureClubInjury(source, fixture)
  );
}

export function appendTeamNewsSearchResults(
  existing: readonly PlayerEvidenceSource[],
  outcomes: readonly WebSearchOutcome[],
  fixture: PlayerFixtureRef,
  maxResults = 30
): PlayerEvidenceSource[] {
  const seen = new Set(existing.map((row) => row.url.toLocaleLowerCase()));
  const merged = mergeSearchResults(outcomes, { maxResults });
  const combined: PlayerEvidenceSource[] = [...existing];
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
    });
  }
  const reindexed = combined.slice(0, maxResults).map((source, index) => ({
    ...source,
    id: `S${index + 1}`,
  }));
  return selectTeamNewsSources(reindexed, fixture);
}
