import fs from "node:fs";
import path from "node:path";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";
import { getPlBuildPassCompSeasonId, plTeamPulseIdForSide } from "./pl-fixtures-client";

const PL_STAFF_ORIGIN = "https://www.premierleague.com";
const PL_STAFF_TIMEOUT_MS = 12_000;
const PL_STAFF_MAX_CONCURRENT = 3;
const PL_STAFF_MAX_ATTEMPTS = 2;

export interface PlStaffPlayerRow {
  id: number;
  altIds?: { opta?: string };
  name?: { display?: string };
}

export interface PlStaffPayload {
  team?: { id: number; name?: string };
  players?: PlStaffPlayerRow[];
}

export interface PlClubSquadIndex {
  optaIds: Set<string>;
  fplCodes: Set<number>;
}

export type PlClubSquadFetchState =
  | { ok: true; index: PlClubSquadIndex; fetchedAt: string }
  | { ok: false; error: string; fetchedAt: string };

let buildPassStaffCache: Map<number, PlClubSquadFetchState> | null = null;

export function resetPlStaffCacheForTests(): void {
  buildPassStaffCache = null;
}

export function setPlStaffCacheForTests(cache: Map<number, PlClubSquadFetchState>): void {
  buildPassStaffCache = cache;
}

export function getPlStaffFetchState(pulseTeamId: number): PlClubSquadFetchState | null {
  return buildPassStaffCache?.get(pulseTeamId) ?? null;
}

function recordedStaffFixturePath(pulseTeamId: number): string {
  return path.join(
    __dirname,
    "../__fixtures__/pl-pulselive-staff",
    `pl-staff-pulse-${pulseTeamId}-841-recorded.json`,
  );
}

export function loadRecordedPlStaffPayload(pulseTeamId: number): PlStaffPayload | null {
  const file = recordedStaffFixturePath(pulseTeamId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlStaffPayload;
}

/** @deprecated Use loadRecordedPlStaffPayload(9). Kept for test imports. */
export function loadPlStaffLeeds841Recorded(): PlStaffPayload {
  const payload = loadRecordedPlStaffPayload(9);
  if (!payload) {
    throw new Error("recorded_leeds_staff_missing");
  }
  return payload;
}

/** compSeason id from verbatim recorded Pulselive staff fixtures (e.g. 841 for 2026/27). */
export function recordedPlCompSeasonIdFromStaffFixtures(): number {
  const payload = loadPlStaffLeeds841Recorded();
  const id = (payload as { compSeason?: { id?: number } }).compSeason?.id;
  if (id == null) throw new Error("recorded_staff_comp_season_missing");
  return id;
}

export function squadIndexFromStaffPayload(payload: PlStaffPayload): PlClubSquadIndex {
  const optaIds = new Set<string>();
  const fplCodes = new Set<number>();
  for (const row of payload.players ?? []) {
    const raw = row.altIds?.opta?.trim();
    if (!raw) continue;
    const normalized = raw.toLowerCase();
    optaIds.add(normalized);
    if (normalized.startsWith("p")) {
      const numeric = Number(normalized.slice(1));
      if (Number.isFinite(numeric)) fplCodes.add(numeric);
    }
  }
  return { optaIds, fplCodes };
}

export function fplElementCodeInSquad(code: number | null | undefined, index: PlClubSquadIndex): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  if (index.fplCodes.has(code)) return true;
  return index.optaIds.has(`p${code}`);
}

function staffUrl(pulseTeamId: number, compSeasonId: number): string {
  return `https://footballapi.pulselive.com/football/teams/${pulseTeamId}/compseasons/${compSeasonId}/staff?pageSize=100&compSeasons=${compSeasonId}&altIds=true&page=0&type=player`;
}

async function fetchPlStaffPayloadOnce(
  pulseTeamId: number,
  compSeasonId: number,
  fetchFn: typeof fetch,
): Promise<PlStaffPayload> {
  const url = staffUrl(pulseTeamId, compSeasonId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PL_STAFF_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Origin: PL_STAFF_ORIGIN,
        Referer: `${PL_STAFF_ORIGIN}/`,
      },
    });
    if (!response.ok) {
      throw new Error(`pl_staff_http_${response.status}`);
    }
    return await response.json() as PlStaffPayload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlStaffPayloadWithRetry(
  pulseTeamId: number,
  compSeasonId: number,
  fetchFn: typeof fetch = fetch,
): Promise<PlStaffPayload> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PL_STAFF_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchPlStaffPayloadOnce(pulseTeamId, compSeasonId, fetchFn);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("pl_staff_fetch_failed");
}

export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
  return results;
}

async function ensureStaffCached(
  pulseTeamId: number,
  compSeasonId: number,
  fetchedAt: string,
  fetchFn: typeof fetch,
): Promise<PlClubSquadFetchState> {
  if (!buildPassStaffCache) buildPassStaffCache = new Map();
  const existing = buildPassStaffCache.get(pulseTeamId);
  if (existing) return existing;
  try {
    const payload = await fetchPlStaffPayloadWithRetry(pulseTeamId, compSeasonId, fetchFn);
    const state: PlClubSquadFetchState = {
      ok: true,
      index: squadIndexFromStaffPayload(payload),
      fetchedAt,
    };
    buildPassStaffCache.set(pulseTeamId, state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : "pl_staff_fetch_failed";
    const state: PlClubSquadFetchState = { ok: false, error: message, fetchedAt };
    buildPassStaffCache.set(pulseTeamId, state);
    console.log(JSON.stringify({
      event: "fixture_first_squad_fetch_failed",
      pulseTeamId,
      compSeasonId,
      error: message,
    }));
    return state;
  }
}

function failClosedStaffState(fetchedAt: string, error: string): PlClubSquadFetchState {
  return { ok: false, error, fetchedAt };
}

/** One Pulselive staff fetch per pulse team id for the current build pass. */
export async function prefetchPlStaffForBuildPass(
  sides: readonly string[],
  fplSnapshot: FplBootstrapSnapshot,
  fetchedAt: string = new Date().toISOString(),
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const compSeasonId = getPlBuildPassCompSeasonId();
  const pulseIds = new Set<number>();
  for (const side of sides) {
    const pulseId = plTeamPulseIdForSide(side, fplSnapshot);
    if (pulseId != null) pulseIds.add(pulseId);
  }
  const ids = [...pulseIds];
  if (compSeasonId == null) {
    if (!buildPassStaffCache) buildPassStaffCache = new Map();
    for (const pulseTeamId of ids) {
      buildPassStaffCache.set(
        pulseTeamId,
        failClosedStaffState(fetchedAt, "pl_comp_season_unresolved"),
      );
    }
    console.log(JSON.stringify({
      event: "fixture_first_squad_fetch_failed",
      pulseTeamId: null,
      compSeasonId: null,
      error: "pl_comp_season_unresolved",
    }));
    return;
  }
  await mapWithConcurrencyLimit(
    ids,
    PL_STAFF_MAX_CONCURRENT,
    (pulseTeamId) => ensureStaffCached(pulseTeamId, compSeasonId, fetchedAt, fetchFn),
  );
}

/** Seed staff cache from verbatim recorded Pulselive staff JSON (tests / guard proofs). */
export function seedPlStaffCacheForPulseTeams(
  pulseTeamIds: readonly number[],
  fetchedAt: string,
): void {
  const cache = new Map<number, PlClubSquadFetchState>();
  for (const pulseTeamId of pulseTeamIds) {
    const payload = loadRecordedPlStaffPayload(pulseTeamId);
    if (!payload) {
      cache.set(pulseTeamId, failClosedStaffState(fetchedAt, "recorded_staff_fixture_missing"));
      continue;
    }
    cache.set(pulseTeamId, {
      ok: true,
      index: squadIndexFromStaffPayload(payload),
      fetchedAt,
    });
  }
  setPlStaffCacheForTests(cache);
}

export function seedPlStaffCacheForFixtureSides(
  sides: readonly string[],
  fplSnapshot: FplBootstrapSnapshot,
  fetchedAt: string,
): void {
  const pulseIds = sides
    .map((side) => plTeamPulseIdForSide(side, fplSnapshot))
    .filter((id): id is number => id != null);
  seedPlStaffCacheForPulseTeams(pulseIds, fetchedAt);
}

/** All pulse team ids on the 841-recorded FPL bootstrap (GW8 slate staff seed). */
export function allRecordedPlStaffPulseTeamIds(snapshot: FplBootstrapSnapshot): number[] {
  return [...new Set(
    snapshot.teams
      .map((team) => team.pulse_id)
      .filter((id): id is number => id != null),
  )].sort((a, b) => a - b);
}
