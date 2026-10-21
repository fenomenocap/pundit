import type { FootballMatch } from "../../football-data";
import type { ModelFixture } from "../../model-data";
import {
  buildFplInjuryEvidenceForFixture,
  type FplBootstrapSnapshot,
} from "../fpl-bootstrap-injuries";
import { fixtureSideLabelForFplTeam, resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import type { DossierEvidenceItem } from "../types";
import { passesFixtureFirstFreshness, previousMatchKickoffUtc } from "./previous-match-cutoff";
import { formatGroupQueryTemplate, getSourceGroup, sourceGroupForField } from "./source-groups";
import type { FixtureFirstFetchLog, FixtureIdentityValue } from "./types";

export interface FotMobUnavailableRow {
  playerId: number;
  name: string;
  teamId: number;
  status: string;
  sourceTimestamp: string;
}

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

function fplFetchLog(fetchedAt: string, sourceTimestamp: string | null, query: string): FixtureFirstFetchLog {
  return {
    groupKey: sourceGroupForField("teamNews"),
    fieldKey: "teamNews",
    sourceKey: "fpl",
    fetchedAt,
    sourceTimestamp,
    query,
    url: FPL_BOOTSTRAP_URL,
  };
}

function fotmobFetchLog(
  fetchedAt: string,
  sourceTimestamp: string | null,
  query: string,
  fotmobMatchId: string,
): FixtureFirstFetchLog {
  return {
    groupKey: sourceGroupForField("teamNews"),
    fieldKey: "teamNews",
    sourceKey: "fotmob",
    fetchedAt,
    sourceTimestamp,
    query,
    url: `https://www.fotmob.com/api/data/matchDetails?matchId=${fotmobMatchId}`,
  };
}

function playerKey(item: DossierEvidenceItem): string {
  return `${item.club}:${item.player}`.toLowerCase();
}

function applyFreshnessFilter(
  items: DossierEvidenceItem[],
  fixture: ModelFixture,
  schedule: readonly FootballMatch[],
): DossierEvidenceItem[] {
  const homePrev = previousMatchKickoffUtc(fixture.home, fixture.utcDate, schedule);
  const awayPrev = previousMatchKickoffUtc(fixture.away, fixture.utcDate, schedule);
  return items.filter((item) => passesFixtureFirstFreshness({
    sourceTimestampIso: item.newsAddedAt ?? item.publishedAt,
    kickoffUtc: fixture.utcDate,
    homePreviousKickoffUtc: homePrev,
    awayPreviousKickoffUtc: awayPrev,
  }));
}

function fotmobRowsToEvidence(
  rows: FotMobUnavailableRow[],
  fixture: ModelFixture,
  fplSnapshot: FplBootstrapSnapshot,
  retrievedAt: string,
): DossierEvidenceItem[] {
  const teamIds = new Set<number>();
  for (const side of [fixture.home, fixture.away]) {
    const id = resolveFplTeamIdForFixtureSide(side, fplSnapshot);
    if (id != null) teamIds.add(id);
  }
  const items: DossierEvidenceItem[] = [];
  for (const row of rows) {
    if (!teamIds.has(row.teamId)) continue;
    const team = fplSnapshot.teams.find((t) => t.id === row.teamId);
    if (!team) continue;
    const club = fixtureSideLabelForFplTeam(fixture.home, fixture.away, team);
    items.push({
      id: `fotmob:${row.playerId}:${fixture.fixtureId}`,
      claim: `${row.name} (${club})`,
      sourceUrl: "https://www.fotmob.com/",
      publisher: "fotmob.com",
      publishedAt: row.sourceTimestamp,
      retrievedAt,
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fotmob-match-details",
      player: row.name,
      club,
      status: row.status === "doubtful" ? "d" : row.status === "out" ? "i" : "n",
      chanceOfPlaying: null,
      newsAddedAt: row.sourceTimestamp,
      fixtureMatchVerified: true,
      freshnessVerified: true,
    });
  }
  return items;
}

export function buildInjuriesDoubtsTeamNews(params: {
  fixture: ModelFixture;
  identity: FixtureIdentityValue;
  fplSnapshot: FplBootstrapSnapshot;
  schedule: readonly FootballMatch[];
  fetchedAt: string;
  fotmobUnavailable?: FotMobUnavailableRow[];
  fotmobMatchId?: string | null;
}): { items: DossierEvidenceItem[]; fetchLogs: FixtureFirstFetchLog[] } {
  const group = getSourceGroup(sourceGroupForField("teamNews"));
  const kickoffDate = params.fixture.utcDate.slice(0, 10);
  const query = formatGroupQueryTemplate(group.queryTemplate, {
    home: params.fixture.home,
    away: params.fixture.away,
    competition: params.fixture.competition,
    kickoffDate,
  });

  const fetchLogs: FixtureFirstFetchLog[] = [];
  const primaryItems = applyFreshnessFilter(
    buildFplInjuryEvidenceForFixture(params.fixture, params.fetchedAt, params.fplSnapshot).map((item) => ({
      ...item,
      fixtureMatchVerified: true,
      freshnessVerified: true,
    })),
    params.fixture,
    params.schedule,
  );
  const latestFplNews = primaryItems.reduce<string | null>((best, item) => {
    const ts = item.newsAddedAt ?? item.publishedAt;
    if (!ts) return best;
    if (!best || ts > best) return ts;
    return best;
  }, null);
  fetchLogs.push(fplFetchLog(params.fetchedAt, latestFplNews, query));

  const seen = new Set(primaryItems.map(playerKey));
  let fallbackItems: DossierEvidenceItem[] = [];
  if (params.fotmobUnavailable?.length && params.fotmobMatchId) {
    fallbackItems = applyFreshnessFilter(
      fotmobRowsToEvidence(
        params.fotmobUnavailable,
        params.fixture,
        params.fplSnapshot,
        params.fetchedAt,
      ),
      params.fixture,
      params.schedule,
    ).filter((item) => !seen.has(playerKey(item)));
    const fotmobTs = fallbackItems.reduce<string | null>((best, item) => {
      const ts = item.newsAddedAt ?? item.publishedAt;
      if (!ts) return best;
      if (!best || ts > best) return ts;
      return best;
    }, null);
    fetchLogs.push(fotmobFetchLog(
      params.fetchedAt,
      fotmobTs,
      query,
      params.fotmobMatchId,
    ));
  }

  return { items: [...primaryItems, ...fallbackItems], fetchLogs };
}
