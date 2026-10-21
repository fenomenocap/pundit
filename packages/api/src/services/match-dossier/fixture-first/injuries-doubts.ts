import type { FootballMatch } from "../../football-data";
import type { ModelFixture } from "../../model-data";
import {
  buildFplInjuryEvidenceForFixture,
  type FplBootstrapSnapshot,
} from "../fpl-bootstrap-injuries";
import { fixtureSideLabelForFplTeam, resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import type { DossierEvidenceItem, FplPlayerAvailabilityStatus } from "../types";
import {
  fplElementCodeInSquad,
  getPlStaffFetchState,
  type PlClubSquadIndex,
} from "./pl-staff-client";
import { plTeamPulseIdForSide } from "./pl-fixtures-client";
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

const ONGOING_ABSENTEE: FplPlayerAvailabilityStatus[] = ["i", "s"];

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

function isOngoingAbsentee(status: FplPlayerAvailabilityStatus | undefined): boolean {
  return status != null && ONGOING_ABSENTEE.includes(status);
}

/** Doubt/news rows only: own-club previous match + newsAddedAt. FPL i/s skip news freshness. */
export function applyFixtureFirstFreshnessFilter(
  items: DossierEvidenceItem[],
  fixture: ModelFixture,
  schedule: readonly FootballMatch[],
): DossierEvidenceItem[] {
  return items.filter((item) => {
    if (!item.club) return false;
    const kickoffMs = Date.parse(fixture.utcDate);
    if (!Number.isFinite(kickoffMs)) return false;
    if (isOngoingAbsentee(item.status)) return true;
    const clubPrev = previousMatchKickoffUtc(item.club, fixture.utcDate, schedule);
    if (!item.newsAddedAt) return false;
    return passesFixtureFirstFreshness({
      sourceTimestampIso: item.newsAddedAt,
      kickoffUtc: fixture.utcDate,
      clubPreviousKickoffUtc: clubPrev,
    });
  });
}

const SQUAD_GUARD_STATUSES: FplPlayerAvailabilityStatus[] = ["i", "s", "d"];

function squadBlockedClubs(
  fixture: ModelFixture,
  snapshot: FplBootstrapSnapshot,
): Set<string> {
  const blocked = new Set<string>();
  for (const club of [fixture.home, fixture.away]) {
    const pulseId = plTeamPulseIdForSide(club, snapshot);
    if (pulseId == null) continue;
    const state = getPlStaffFetchState(pulseId);
    if (!state || !state.ok) blocked.add(club);
  }
  return blocked;
}

function squadIndexForClub(club: string, snapshot: FplBootstrapSnapshot): PlClubSquadIndex | null {
  const pulseId = plTeamPulseIdForSide(club, snapshot);
  if (pulseId == null) return null;
  const state = getPlStaffFetchState(pulseId);
  if (!state?.ok) return null;
  return state.index;
}

/** i/s/d rows must appear on the club's current PL compSeason staff list (Opta id, then FPL code). */
export function applyPlSquadMembershipGuard(
  items: DossierEvidenceItem[],
  fixture: ModelFixture,
  snapshot: FplBootstrapSnapshot,
): DossierEvidenceItem[] {
  const blockedClubs = squadBlockedClubs(fixture, snapshot);
  return items.filter((item) => {
    if (!item.club) return false;
    if (blockedClubs.has(item.club)) return false;
    if (item.status == null || !SQUAD_GUARD_STATUSES.includes(item.status)) return true;
    const index = squadIndexForClub(item.club, snapshot);
    if (!index) return false;
    const code = item.fplElementCode
      ?? snapshot.elements.find((row) => row.id === item.fplElementId)?.code
      ?? null;
    if (fplElementCodeInSquad(code, index)) return true;
    console.log(JSON.stringify({
      event: "fixture_first_squad_member_drop",
      player: item.player,
      club: item.club,
      fplElementId: item.fplElementId ?? null,
      fplElementCode: code,
      status: item.status,
    }));
    return false;
  });
}

export function applyFplTeamIdClubGuard(
  items: DossierEvidenceItem[],
  snapshot: FplBootstrapSnapshot,
): DossierEvidenceItem[] {
  return items.filter((item) => {
    if (item.fplTeamId == null || !item.club) return false;
    const expected = resolveFplTeamIdForFixtureSide(item.club, snapshot);
    if (expected == null || item.fplTeamId !== expected) {
      console.log(JSON.stringify({
        event: "fixture_first_wrong_club_drop",
        player: item.player,
        club: item.club,
        fplElementId: item.fplElementId ?? null,
        fplTeamId: item.fplTeamId,
        expectedFplTeamId: expected,
      }));
      return false;
    }
    return true;
  });
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
      status: row.status === "doubtful" ? "d" : "n",
      chanceOfPlaying: null,
      newsAddedAt: row.sourceTimestamp,
      fplTeamId: row.teamId,
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
  const rawPrimary = buildFplInjuryEvidenceForFixture(
    params.fixture,
    params.fetchedAt,
    params.fplSnapshot,
    { requireNewsAdded: true, dropUnavailable: true },
  ).map((item) => ({
    ...item,
    fixtureMatchVerified: true,
    freshnessVerified: true,
  }));
  const guarded = applyFplTeamIdClubGuard(rawPrimary, params.fplSnapshot);
  const primaryItems = applyFixtureFirstFreshnessFilter(
    applyPlSquadMembershipGuard(
      guarded,
      params.fixture,
      params.fplSnapshot,
    ),
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
    fallbackItems = applyFixtureFirstFreshnessFilter(
      applyPlSquadMembershipGuard(
        applyFplTeamIdClubGuard(
          fotmobRowsToEvidence(
            params.fotmobUnavailable,
            params.fixture,
            params.fplSnapshot,
            params.fetchedAt,
          ),
          params.fplSnapshot,
        ),
        params.fixture,
        params.fplSnapshot,
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
