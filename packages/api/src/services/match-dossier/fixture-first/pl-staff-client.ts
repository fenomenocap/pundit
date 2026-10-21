import fs from "node:fs";
import path from "node:path";
import type { FplBootstrapSnapshot } from "../fpl-bootstrap-injuries";
import { plTeamPulseIdForSide } from "./pl-fixtures-client";

const PL_STAFF_ORIGIN = "https://www.premierleague.com";
const PL_STAFF_TIMEOUT_MS = 12_000;
const PL_COMP_SEASON_ID = 841;

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

export function loadPlStaffLeeds841Recorded(): PlStaffPayload {
  const file = path.join(__dirname, "../__fixtures__/pl-pulselive-staff-leeds-841-recorded.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as PlStaffPayload;
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

function staffUrl(pulseTeamId: number): string {
  return `https://footballapi.pulselive.com/football/teams/${pulseTeamId}/compseasons/${PL_COMP_SEASON_ID}/staff?pageSize=100&compSeasons=${PL_COMP_SEASON_ID}&altIds=true&page=0&type=player`;
}

async function fetchPlStaffPayload(pulseTeamId: number): Promise<PlStaffPayload> {
  const url = staffUrl(pulseTeamId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PL_STAFF_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
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

async function ensureStaffCached(pulseTeamId: number, fetchedAt: string): Promise<PlClubSquadFetchState> {
  if (!buildPassStaffCache) buildPassStaffCache = new Map();
  const existing = buildPassStaffCache.get(pulseTeamId);
  if (existing) return existing;
  try {
    const payload = await fetchPlStaffPayload(pulseTeamId);
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
      compSeasonId: PL_COMP_SEASON_ID,
      error: message,
    }));
    return state;
  }
}

/** One Pulselive staff fetch per pulse team id for the current build pass. */
export async function prefetchPlStaffForBuildPass(
  sides: readonly string[],
  fplSnapshot: FplBootstrapSnapshot,
  fetchedAt: string = new Date().toISOString(),
): Promise<void> {
  const pulseIds = new Set<number>();
  for (const side of sides) {
    const pulseId = plTeamPulseIdForSide(side, fplSnapshot);
    if (pulseId != null) pulseIds.add(pulseId);
  }
  await Promise.all([...pulseIds].map((id) => ensureStaffCached(id, fetchedAt)));
}

/** Test helper: squad index that includes every coded FPL element on the club (except explicit drops). */
export function seedPlStaffCacheFromFplSnapshot(
  snapshot: FplBootstrapSnapshot,
  options?: {
    fetchedAt?: string;
    pulseOverrides?: Map<number, PlClubSquadIndex>;
  },
): void {
  const fetchedAt = options?.fetchedAt ?? new Date().toISOString();
  const cache = new Map<number, PlClubSquadFetchState>();
  for (const team of snapshot.teams) {
    if (team.pulse_id == null) continue;
    const override = options?.pulseOverrides?.get(team.pulse_id);
    const index = override ?? squadIndexFromFplClubElements(snapshot, team.id);
    cache.set(team.pulse_id, { ok: true, index, fetchedAt });
  }
  setPlStaffCacheForTests(cache);
}

export function squadIndexFromFplClubElements(
  snapshot: FplBootstrapSnapshot,
  fplTeamId: number,
  excludeElementIds: readonly number[] = [],
): PlClubSquadIndex {
  const excluded = new Set(excludeElementIds);
  const optaIds = new Set<string>();
  const fplCodes = new Set<number>();
  for (const player of snapshot.elements) {
    if (player.team !== fplTeamId || excluded.has(player.id)) continue;
    if (player.code == null) continue;
    fplCodes.add(player.code);
    optaIds.add(`p${player.code}`);
  }
  return { optaIds, fplCodes };
}
