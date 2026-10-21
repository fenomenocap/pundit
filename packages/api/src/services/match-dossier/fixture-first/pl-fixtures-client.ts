import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureFirstFetchLog } from "./types";
import { formatGroupQueryTemplate, getSourceGroup, sourceGroupForField } from "./source-groups";
import { resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";

const PL_FIXTURES_URL = "https://footballapi.pulselive.com/football/fixtures";
const PL_ORIGIN = "https://www.premierleague.com";
const PL_TIMEOUT_MS = 12_000;

export interface PlFixtureRow {
  id: number;
  kickoff: { millis: number };
  teams: Array<{ team: { id: number; name: string }; score?: number; role: string }>;
}

export interface PlFixturesPayload {
  content: PlFixtureRow[];
}

let buildPassPlCache: { payload: PlFixturesPayload; fetchedAt: string } | null = null;

export function resetPlFixturesCacheForTests(): void {
  buildPassPlCache = null;
}

export function setPlFixturesCacheForTests(payload: PlFixturesPayload, fetchedAt: string): void {
  buildPassPlCache = { payload, fetchedAt };
}

export function loadPlFixturesFromRecordedFixture(): PlFixturesPayload {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../__fixtures__/pl-pulselive-fixtures-sample.json",
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlFixturesPayload;
}

function kickoffDateLocalUtc(isoKickoff: string): string {
  return isoKickoff.slice(0, 10);
}

function plTeamIdForSide(
  side: string,
  snapshot: FplBootstrapSnapshot,
): number | null {
  const fplId = resolveFplTeamIdForFixtureSide(side, snapshot);
  if (fplId == null) return null;
  const team = snapshot.teams.find((row) => row.id === fplId);
  return team?.code ?? null;
}

export function findPlMatchInPayload(params: {
  payload: PlFixturesPayload;
  home: string;
  away: string;
  kickoffUtc: string;
  fplSnapshot: FplBootstrapSnapshot;
}): PlFixtureRow | null {
  const homePlId = plTeamIdForSide(params.home, params.fplSnapshot);
  const awayPlId = plTeamIdForSide(params.away, params.fplSnapshot);
  if (homePlId == null || awayPlId == null) return null;
  const targetDay = kickoffDateLocalUtc(params.kickoffUtc);
  const targetMs = Date.parse(params.kickoffUtc);
  let best: PlFixtureRow | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of params.payload.content ?? []) {
    const kickIso = new Date(row.kickoff.millis).toISOString();
    if (kickoffDateLocalUtc(kickIso) !== targetDay) continue;
    const teamIds = row.teams.map((t) => t.team.id);
    if (!teamIds.includes(homePlId) || !teamIds.includes(awayPlId)) continue;
    const delta = Math.abs(row.kickoff.millis - targetMs);
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best;
}

export async function prefetchPlFixturesForBuildPass(
  fetchFn: typeof fetch = fetch,
  seasonQuery = "comps=1&compSeasons=719",
): Promise<PlFixturesPayload | null> {
  if (buildPassPlCache) return buildPassPlCache.payload;
  const url = `${PL_FIXTURES_URL}?${seasonQuery}`;
  const group = getSourceGroup(sourceGroupForField("fixtureIdentity"));
  const query = formatGroupQueryTemplate(group.queryTemplate, {
    home: "*",
    away: "*",
    competition: "Premier League",
    kickoffDate: "*",
  });
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        Origin: PL_ORIGIN,
        Referer: `${PL_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(PL_TIMEOUT_MS),
    });
    if (!response.ok) {
      logPlFetch({ url, query, fetchedAt, sourceTimestamp: null, ok: false, status: response.status });
      return null;
    }
    const payload = await response.json() as PlFixturesPayload;
    buildPassPlCache = { payload, fetchedAt };
    logPlFetch({ url, query, fetchedAt, sourceTimestamp: fetchedAt, ok: true, status: 200 });
    return payload;
  } catch {
    logPlFetch({ url, query, fetchedAt, sourceTimestamp: null, ok: false, status: null });
    return null;
  }
}

export function getPlFixturesCache(): PlFixturesPayload | null {
  return buildPassPlCache?.payload ?? null;
}

function logPlFetch(payload: {
  url: string;
  query: string;
  fetchedAt: string;
  sourceTimestamp: string | null;
  ok: boolean;
  status: number | null;
}): void {
  console.log(JSON.stringify({
    event: "fixture_first_fetch",
    groupKey: sourceGroupForField("fixtureIdentity"),
    fieldKey: "fixtureIdentity",
    sourceKey: "pl-api",
    ...payload,
  }));
}

export function plFixtureFetchLog(params: {
  fetchedAt: string;
  sourceTimestamp: string | null;
  query: string;
  url: string;
}): FixtureFirstFetchLog {
  return {
    groupKey: sourceGroupForField("fixtureIdentity"),
    fieldKey: "fixtureIdentity",
    sourceKey: "pl-api",
    fetchedAt: params.fetchedAt,
    sourceTimestamp: params.sourceTimestamp,
    query: params.query,
    url: params.url,
  };
}
