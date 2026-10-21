import fs from "node:fs";
import path from "node:path";
import type { FixtureFirstFetchLog } from "./types";
import { formatGroupQueryTemplate, getSourceGroup, sourceGroupForField } from "./source-groups";
import { resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";

const PL_FIXTURES_URL = "https://footballapi.pulselive.com/football/fixtures";
const PL_COMPSEASONS_URL = "https://footballapi.pulselive.com/football/competitions/1/compseasons";
const PL_ORIGIN = "https://www.premierleague.com";
const PL_TIMEOUT_MS = 12_000;
const PL_FIXTURE_PAGE_SIZE = 400;

export interface PlFixtureRow {
  id: number;
  kickoff: { millis: number };
  teams: Array<{ team: { id: number; name: string }; score?: number; role?: string }>;
}

export interface PlFixturesPayload {
  content: PlFixtureRow[];
  pageInfo?: { page: number; numPages: number; pageSize: number; numEntries: number };
}

interface PlCompSeasonRow {
  id: number;
  label: string;
}

let buildPassPlCache: { payload: PlFixturesPayload; fetchedAt: string; compSeasonId: number } | null = null;

export function resetPlFixturesCacheForTests(): void {
  buildPassPlCache = null;
}

/** Comp season id resolved during the current PL fixtures build pass (for staff URLs). */
export function getPlBuildPassCompSeasonId(): number | null {
  return buildPassPlCache?.compSeasonId ?? null;
}

export function setPlBuildPassCompSeasonIdForTests(compSeasonId: number | null): void {
  if (compSeasonId == null) {
    if (buildPassPlCache) buildPassPlCache = null;
    return;
  }
  if (buildPassPlCache) {
    buildPassPlCache = { ...buildPassPlCache, compSeasonId };
  } else {
    buildPassPlCache = {
      payload: { content: [] },
      fetchedAt: new Date().toISOString(),
      compSeasonId,
    };
  }
}

export function setPlFixturesCacheForTests(
  payload: PlFixturesPayload,
  fetchedAt: string,
  compSeasonId?: number,
): void {
  const resolved = compSeasonId
    ?? buildPassPlCache?.compSeasonId
    ?? resolvePlCompSeasonIdFromRows(
      [{ id: 0, label: "English Premier League Season 2026/2027" }],
      new Date(fetchedAt),
    );
  if (resolved == null) {
    throw new Error("pl_comp_season_unresolved_for_tests");
  }
  buildPassPlCache = { payload, fetchedAt, compSeasonId: resolved };
}

/** Chelsea v Spurs GW8 row 128995 from the recorded compSeason 841 fixtures slice. */
export function loadPlFixturesFromRecordedFixture(): PlFixturesPayload {
  const pl = loadPlFixtures841Recorded();
  const row = pl.content.find((entry) => entry.id === 128995);
  if (!row) {
    throw new Error("recorded_pl_fixture_128995_missing");
  }
  return { content: [row], pageInfo: { page: 0, numPages: 1, pageSize: 1, numEntries: 1 } };
}

/** Real Pulselive compSeason 841 slice (GW8 + Everton v Chelsea regression rows). */
export function loadPlFixtures841Recorded(): PlFixturesPayload {
  const file = path.join(__dirname, "../__fixtures__/pl-pulselive-fixtures-841-recorded.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlFixturesPayload;
}

/** Football season start year for a UTC reference instant (PL season starts in August). */
export function premierLeagueSeasonStartYear(ref: Date): number {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + 1;
  return m >= 8 ? y : y - 1;
}

export function compSeasonLabelMatchesReference(label: string, ref: Date): boolean {
  const start = premierLeagueSeasonStartYear(ref);
  const end = start + 1;
  const shortEnd = String(end).slice(-2);
  return label.includes(`${start}/${end}`) || label.includes(`${start}/${shortEnd}`);
}

export function resolvePlCompSeasonIdFromRows(rows: PlCompSeasonRow[], ref: Date): number | null {
  for (const row of rows) {
    if (compSeasonLabelMatchesReference(row.label, ref)) return row.id;
  }
  return null;
}

export function mergePlFixturePages(pages: PlFixturesPayload[]): PlFixturesPayload {
  const content = pages.flatMap((page) => page.content ?? []);
  return {
    content,
    pageInfo: {
      page: 0,
      numPages: 1,
      pageSize: PL_FIXTURE_PAGE_SIZE,
      numEntries: content.length,
    },
  };
}

function kickoffDateLocalUtc(isoKickoff: string): string {
  return isoKickoff.slice(0, 10);
}

/** Pulselive team id from FPL bootstrap `pulse_id` (not Opta `code`). */
export function plTeamPulseIdForSide(
  side: string,
  snapshot: FplBootstrapSnapshot,
): number | null {
  const fplId = resolveFplTeamIdForFixtureSide(side, snapshot);
  if (fplId == null) return null;
  const team = snapshot.teams.find((row) => row.id === fplId);
  if (team?.pulse_id == null) return null;
  return team.pulse_id;
}

function plSideTeamId(row: PlFixtureRow, role: "home" | "away"): number | null {
  const withRole = row.teams.find((t) => t.role?.toLowerCase() === role);
  if (withRole) return withRole.team.id;
  const index = role === "home" ? 0 : 1;
  return row.teams[index]?.team.id ?? null;
}

export function findPlMatchInPayload(params: {
  payload: PlFixturesPayload;
  home: string;
  away: string;
  kickoffUtc: string;
  fplSnapshot: FplBootstrapSnapshot;
}): PlFixtureRow | null {
  const homePlId = plTeamPulseIdForSide(params.home, params.fplSnapshot);
  const awayPlId = plTeamPulseIdForSide(params.away, params.fplSnapshot);
  if (homePlId == null || awayPlId == null) return null;
  const targetDay = kickoffDateLocalUtc(params.kickoffUtc);
  const targetMs = Date.parse(params.kickoffUtc);
  let best: PlFixtureRow | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of params.payload.content ?? []) {
    const kickIso = new Date(row.kickoff.millis).toISOString();
    if (kickoffDateLocalUtc(kickIso) !== targetDay) continue;
    if (plSideTeamId(row, "home") !== homePlId || plSideTeamId(row, "away") !== awayPlId) continue;
    const delta = Math.abs(row.kickoff.millis - targetMs);
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best;
}

/** Legacy join (Opta `code` vs Pulselive id, set membership) — wrong; for regression tests only. */
export function findPlMatchInPayloadUsingCodeJoin(params: {
  payload: PlFixturesPayload;
  home: string;
  away: string;
  kickoffUtc: string;
  fplSnapshot: FplBootstrapSnapshot;
}): PlFixtureRow | null {
  const codeForSide = (side: string): number | null => {
    const fplId = resolveFplTeamIdForFixtureSide(side, params.fplSnapshot);
    if (fplId == null) return null;
    return params.fplSnapshot.teams.find((row) => row.id === fplId)?.code ?? null;
  };
  const homePlId = codeForSide(params.home);
  const awayPlId = codeForSide(params.away);
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

async function fetchJson<T>(fetchFn: typeof fetch, url: string): Promise<T | null> {
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        Origin: PL_ORIGIN,
        Referer: `${PL_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(PL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function fetchAllCompSeasonRows(fetchFn: typeof fetch): Promise<PlCompSeasonRow[]> {
  const first = await fetchJson<{ content: PlCompSeasonRow[]; pageInfo?: { numPages: number } }>(
    fetchFn,
    `${PL_COMPSEASONS_URL}?page=0&pageSize=${PL_FIXTURE_PAGE_SIZE}`,
  );
  if (!first?.content) return [];
  const rows = [...first.content];
  const numPages = first.pageInfo?.numPages ?? 1;
  for (let page = 1; page < numPages; page += 1) {
    const next = await fetchJson<{ content: PlCompSeasonRow[] }>(
      fetchFn,
      `${PL_COMPSEASONS_URL}?page=${page}&pageSize=${PL_FIXTURE_PAGE_SIZE}`,
    );
    if (next?.content) rows.push(...next.content);
  }
  return rows;
}

async function fetchSeasonFixtures(
  fetchFn: typeof fetch,
  compSeasonId: number,
): Promise<PlFixturesPayload | null> {
  const first = await fetchJson<PlFixturesPayload>(
    fetchFn,
    `${PL_FIXTURES_URL}?comps=1&compSeasons=${compSeasonId}&page=0&pageSize=${PL_FIXTURE_PAGE_SIZE}`,
  );
  if (!first?.content) return null;
  const pages: PlFixturesPayload[] = [first];
  const numPages = first.pageInfo?.numPages ?? 1;
  for (let page = 1; page < numPages; page += 1) {
    const next = await fetchJson<PlFixturesPayload>(
      fetchFn,
      `${PL_FIXTURES_URL}?comps=1&compSeasons=${compSeasonId}&page=${page}&pageSize=${PL_FIXTURE_PAGE_SIZE}`,
    );
    if (next?.content) pages.push(next);
  }
  return mergePlFixturePages(pages);
}

export async function prefetchPlFixturesForBuildPass(
  fetchFn: typeof fetch = fetch,
  referenceDate: Date = new Date(),
): Promise<PlFixturesPayload | null> {
  if (buildPassPlCache) return buildPassPlCache.payload;
  const group = getSourceGroup(sourceGroupForField("fixtureIdentity"));
  const query = formatGroupQueryTemplate(group.queryTemplate, {
    home: "*",
    away: "*",
    competition: "Premier League",
    kickoffDate: "*",
  });
  const fetchedAt = referenceDate.toISOString();

  const compRows = await fetchAllCompSeasonRows(fetchFn);
  const compSeasonId = resolvePlCompSeasonIdFromRows(compRows, referenceDate);
  if (compSeasonId == null) {
    logPlFetch({
      url: PL_COMPSEASONS_URL,
      query,
      fetchedAt,
      sourceTimestamp: null,
      ok: false,
      status: null,
      reason: "comp_season_label_mismatch",
    });
    return null;
  }

  const seasonLabel = compRows.find((row) => row.id === compSeasonId)?.label ?? "";
  if (!compSeasonLabelMatchesReference(seasonLabel, referenceDate)) {
    logPlFetch({
      url: PL_COMPSEASONS_URL,
      query,
      fetchedAt,
      sourceTimestamp: null,
      ok: false,
      status: null,
      reason: "comp_season_label_mismatch",
    });
    return null;
  }

  const url = `${PL_FIXTURES_URL}?comps=1&compSeasons=${compSeasonId}&pageSize=${PL_FIXTURE_PAGE_SIZE}`;
  const payload = await fetchSeasonFixtures(fetchFn, compSeasonId);
  if (!payload) {
    logPlFetch({ url, query, fetchedAt, sourceTimestamp: null, ok: false, status: null });
    return null;
  }
  buildPassPlCache = { payload, fetchedAt, compSeasonId };
  logPlFetch({ url, query, fetchedAt, sourceTimestamp: fetchedAt, ok: true, status: 200 });
  return payload;
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
  reason?: string;
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
