import type { FootballMatch } from "../../football-data";
import type { ModelFixture } from "../../model-data";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";
import { resolveFixtureIdentity } from "./fixture-identity";
import { buildInjuriesDoubtsTeamNews, type FotMobUnavailableRow } from "./injuries-doubts";
import type { FixtureFirstTeamNewsBuild } from "./types";
import type { PlFixturesPayload } from "./pl-fixtures-client";

export function buildFixtureFirstTeamNews(params: {
  fixture: ModelFixture;
  fplSnapshot: FplBootstrapSnapshot;
  plPayload: PlFixturesPayload | null;
  schedule: readonly FootballMatch[];
  fetchedAt?: string;
  fotmobUnavailable?: FotMobUnavailableRow[];
  fotmobMatchId?: string | null;
}): FixtureFirstTeamNewsBuild {
  const fetchedAt = params.fetchedAt ?? new Date().toISOString();
  const { identity, fetchLogs: identityLogs } = resolveFixtureIdentity({
    fixture: params.fixture,
    fplSnapshot: params.fplSnapshot,
    plPayload: params.plPayload,
    fetchedAt,
  });
  const injuries = buildInjuriesDoubtsTeamNews({
    fixture: params.fixture,
    identity,
    fplSnapshot: params.fplSnapshot,
    schedule: params.schedule,
    fetchedAt,
    fotmobUnavailable: params.fotmobUnavailable,
    fotmobMatchId: params.fotmobMatchId ?? identity.fotmobMatchId,
  });
  return {
    identity,
    fetchLogs: [...identityLogs, ...injuries.fetchLogs],
    items: injuries.items,
  };
}
