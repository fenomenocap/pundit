import type { ModelFixture } from "../../model-data";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";
import { resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import {
  findPlMatchInPayload,
  getPlFixturesCache,
  plFixtureFetchLog,
  type PlFixturesPayload,
} from "./pl-fixtures-client";
import { formatGroupQueryTemplate, getSourceGroup, sourceGroupForField } from "./source-groups";
import type { FixtureFirstFetchLog, FixtureIdentityValue } from "./types";

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard";

export function resolveFixtureIdentity(params: {
  fixture: ModelFixture;
  fplSnapshot: FplBootstrapSnapshot;
  plPayload: PlFixturesPayload | null;
  fetchedAt: string;
}): { identity: FixtureIdentityValue; fetchLogs: FixtureFirstFetchLog[] } {
  const { fixture, fplSnapshot, plPayload, fetchedAt } = params;
  const group = getSourceGroup(sourceGroupForField("fixtureIdentity"));
  const kickoffDate = fixture.utcDate.slice(0, 10);
  const query = formatGroupQueryTemplate(group.queryTemplate, {
    home: fixture.home,
    away: fixture.away,
    competition: fixture.competition,
    kickoffDate,
  });
  const fetchLogs: FixtureFirstFetchLog[] = [];
  const homeFplTeamId = resolveFplTeamIdForFixtureSide(fixture.home, fplSnapshot);
  const awayFplTeamId = resolveFplTeamIdForFixtureSide(fixture.away, fplSnapshot);

  let plMatchId: string | null = null;
  if (plPayload) {
    const row = findPlMatchInPayload({
      payload: plPayload,
      home: fixture.home,
      away: fixture.away,
      kickoffUtc: fixture.utcDate,
      fplSnapshot,
    });
    if (row) {
      plMatchId = String(row.id);
      fetchLogs.push(plFixtureFetchLog({
        fetchedAt,
        sourceTimestamp: new Date(row.kickoff.millis).toISOString(),
        query,
        url: `https://footballapi.pulselive.com/football/fixtures/${row.id}`,
      }));
    }
  }

  if (plMatchId) {
    return {
      identity: {
        plMatchId,
        espnEventId: fixture.fixtureId,
        fotmobMatchId: null,
        goalMatchUuid: null,
        bbcTipoId: null,
        homeFplTeamId,
        awayFplTeamId,
        resolvedVia: "pl-api",
      },
      fetchLogs,
    };
  }

  fetchLogs.push({
    groupKey: sourceGroupForField("fixtureIdentity"),
    fieldKey: "fixtureIdentity",
    sourceKey: "espn",
    fetchedAt,
    sourceTimestamp: fetchedAt,
    query,
    url: `${ESPN_SCOREBOARD}?dates=${kickoffDate.replaceAll("-", "")}`,
  });

  return {
    identity: {
      plMatchId: null,
      espnEventId: fixture.fixtureId,
      fotmobMatchId: null,
      goalMatchUuid: null,
      bbcTipoId: null,
      homeFplTeamId,
      awayFplTeamId,
      resolvedVia: "espn",
    },
    fetchLogs,
  };
}

export function cachedPlPayloadOrNull(): PlFixturesPayload | null {
  return getPlFixturesCache();
}
