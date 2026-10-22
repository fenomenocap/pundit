import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Public Fantasy Premier League game data (no key, no login), trimmed to the
 * fields the web FPL team builder uses. Served by GET /api/fpl/bootstrap.
 *
 * Cache: 1 hour in memory, mirrored to disk so a restart does not refetch.
 * If a refresh fails, the last good payload is served marked stale. Errors are
 * never cached: the next request tries the source again.
 */
export const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
export const FPL_CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "Mozilla/5.0 (compatible; PunditBot/1.0; +https://thepundit.vercel.app)";

export type FplPos = "GK" | "DEF" | "MID" | "FWD";

export type FplPlayerRow = {
  id: number;
  name: string;
  club: string;
  clubName: string;
  pos: FplPos;
  /** £m. null when the source has no price; never estimated. */
  price: number | null;
  status: string | null;
  chanceNextRound: number | null;
  news: string | null;
  totalPoints: number | null;
  form: number | null;
  selectedByPercent: number | null;
};

export type FplPayload = {
  source: "fpl-bootstrap-static";
  fetchedAt: string;
  gameweek: number | null;
  clubs: Array<{ code: string; name: string }>;
  players: FplPlayerRow[];
};

export type FplBootstrapResult =
  | { ok: true; payload: FplPayload; cache: "hit" | "miss" | "stale"; error?: string }
  | { ok: false; status: number; error: string };

const POS_BY_TYPE: Record<number, FplPos> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type RawBootstrap = {
  events?: Array<{ id: number; is_next?: boolean; is_current?: boolean }>;
  teams?: Array<{ id: number; short_name: string; name: string }>;
  elements?: Array<Record<string, unknown>>;
};

/** Map the raw bootstrap payload. Fields the source lacks stay null; nothing is filled in. */
export function mapFplBootstrap(raw: RawBootstrap, fetchedAt: string): FplPayload {
  const teams = new Map((raw.teams ?? []).map((t) => [t.id, t]));
  const players: FplPlayerRow[] = [];
  for (const e of raw.elements ?? []) {
    const pos = POS_BY_TYPE[num(e.element_type) ?? -1];
    const team = teams.get(num(e.team) ?? -1);
    const id = num(e.id);
    if (!pos || !team || id === null) continue;
    const cost = num(e.now_cost);
    players.push({
      id,
      name: String(e.web_name ?? e.second_name ?? `Player ${id}`),
      club: team.short_name,
      clubName: team.name,
      pos,
      price: cost === null ? null : cost / 10,
      status: typeof e.status === "string" ? e.status : null,
      chanceNextRound: num(e.chance_of_playing_next_round),
      news: typeof e.news === "string" && e.news ? e.news : null,
      totalPoints: num(e.total_points),
      form: num(e.form),
      selectedByPercent: num(e.selected_by_percent),
    });
  }
  const next = raw.events?.find((ev) => ev.is_next) ?? raw.events?.find((ev) => ev.is_current);
  return {
    source: "fpl-bootstrap-static",
    fetchedAt,
    gameweek: next?.id ?? null,
    clubs: [...teams.values()]
      .map((t) => ({ code: t.short_name, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    players,
  };
}

function isPayload(value: unknown): value is FplPayload {
  const v = value as FplPayload | null;
  return !!v && v.source === "fpl-bootstrap-static" && typeof v.fetchedAt === "string"
    && Array.isArray(v.players) && v.players.length > 0 && Array.isArray(v.clubs);
}

export function fplCacheFile(): string {
  const dataDir = process.env.PUNDIT_DATA_DIR?.trim();
  return dataDir
    ? path.join(dataDir, "fpl", "bootstrap.json")
    : path.join(os.tmpdir(), "pundit-fpl-bootstrap.json");
}

type CacheEntry = { payload: FplPayload; storedAt: number };
let memory: CacheEntry | null = null;
let inflight: Promise<FplBootstrapResult> | null = null;

function readDisk(file: string): CacheEntry | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { storedAt?: number; payload?: unknown };
    if (typeof parsed.storedAt === "number" && isPayload(parsed.payload)) {
      return { payload: parsed.payload, storedAt: parsed.storedAt };
    }
  } catch {
    // No disk cache yet, or unreadable: fall through to the source.
  }
  return null;
}

function writeDisk(file: string, entry: CacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entry));
    fs.renameSync(temp, file);
  } catch {
    // Disk mirror is best effort; the memory cache still serves.
  }
}

export type FplBootstrapDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheFile?: string;
};

async function fetchFresh(fetchImpl: typeof fetch, now: number): Promise<FplPayload | { error: string }> {
  try {
    const res = await fetchImpl(FPL_BOOTSTRAP_URL, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { error: `Player data source returned ${res.status}.` };
    const payload = mapFplBootstrap((await res.json()) as RawBootstrap, new Date(now).toISOString());
    if (payload.players.length === 0) return { error: "Player data source returned no players." };
    return payload;
  } catch {
    return { error: "Player data source is unavailable." };
  }
}

export async function getFplBootstrap(deps: FplBootstrapDeps = {}): Promise<FplBootstrapResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();
  const file = deps.cacheFile ?? fplCacheFile();
  if (!memory) memory = readDisk(file);
  if (memory && now - memory.storedAt < FPL_CACHE_TTL_MS) {
    return { ok: true, payload: memory.payload, cache: "hit" };
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<FplBootstrapResult> => {
    const fresh = await fetchFresh(fetchImpl, now);
    if ("error" in fresh) {
      // Never cache the error. Serve the last good payload if there is one.
      if (memory) return { ok: true, payload: memory.payload, cache: "stale", error: fresh.error };
      return { ok: false, status: 502, error: fresh.error };
    }
    memory = { payload: fresh, storedAt: now };
    writeDisk(file, memory);
    return { ok: true, payload: fresh, cache: "miss" };
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function resetFplBootstrapCacheForTests(): void {
  memory = null;
  inflight = null;
}
