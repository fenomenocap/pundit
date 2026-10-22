import type { FplPlayer, Pos } from "./fpl-squad";

/** Public Fantasy Premier League game data (no key, no login). */
export const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";

export type FplClub = { code: string; name: string };

export type FplPlayerRow = FplPlayer & {
  clubName: string;
  /** FPL availability code: a = available, d = doubtful, i = injured, s = suspended, u = unavailable, n = not in squad. */
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
  clubs: FplClub[];
  players: FplPlayerRow[];
};

const POS_BY_TYPE: Record<number, Pos> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type RawBootstrap = {
  events?: { id: number; is_next?: boolean; is_current?: boolean }[];
  teams?: { id: number; short_name: string; name: string }[];
  elements?: Record<string, unknown>[];
};

/** Map the raw bootstrap payload. Fields the source lacks stay null; nothing is filled in. */
export function mapBootstrap(raw: RawBootstrap, fetchedAt: string): FplPayload {
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
    clubs: [...teams.values()].map((t) => ({ code: t.short_name, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)),
    players,
  };
}

export const STATUS_LABEL: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not in squad",
};
