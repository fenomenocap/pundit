import {
  type Fixture,
  type MarketKey,
  SETTLED_FIXTURES,
  getFixture as getStaticFixture,
} from "./data/fixtures";
import { applyLiveForm, FORM, type ResultMark } from "./data/form";
import type { TeamId } from "./data/teams";
import { TEAM_LIST, TEAMS, teamIdFromName } from "./data/teams";
import { pickDeskMarketQuote } from "./market-quote";
import { ratingComparison } from "./rating-words";
import { deskNumbersFromModelRow, projectedScore, type ModelRowLambdas } from "./grid";
import { roundedPercent } from "../../lib/fixture-presentation";

export const LIVE_API =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "https://thepundit.up.railway.app";

export { teamIdFromName };

export type LiveScorer = {
  id: string;
  name: string;
  pos: "GK" | "DEF" | "MID" | "FWD";
  goals: number;
};

const liveScorers: Partial<Record<TeamId, LiveScorer[]>> = {};

export function scorersForTeam(team: TeamId, n = 3): LiveScorer[] {
  return (liveScorers[team] ?? []).slice(0, n);
}

export function applyLiveScorers(rows: Partial<Record<TeamId, LiveScorer[]>>) {
  for (const team of TEAM_LIST) {
    delete liveScorers[team.id];
    if (rows[team.id]?.length) liveScorers[team.id] = [...rows[team.id]!];
  }
}

export function resetLiveScorers() {
  for (const team of TEAM_LIST) delete liveScorers[team.id];
}

type ClubFormSnapshot = {
  source?: "season-schedule" | "rolling-window" | "season-and-prior";
  teams: {
    team: string;
    form: ResultMark[];
    position?: number | null;
    playedGames?: number | null;
    points?: number | null;
    goalsFor?: number | null;
    goalsAgainst?: number | null;
    scorers: { id: string; name: string; position: LiveScorer["pos"]; goals: number }[];
  }[];
};

export type LiveClubStats = {
  position: number | null;
  playedGames: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
};

const liveStats: Partial<Record<TeamId, LiveClubStats>> = {};

export function statsForTeam(team: TeamId): LiveClubStats | null {
  return liveStats[team] ?? null;
}

function applyLiveStats(rows: Partial<Record<TeamId, LiveClubStats>>) {
  for (const team of TEAM_LIST) {
    delete liveStats[team.id];
    if (rows[team.id]) liveStats[team.id] = rows[team.id]!;
  }
}

export function resetLiveStats() {
  applyLiveStats({});
}

function applyClubForm(snapshot: ClubFormSnapshot) {
  const form: Partial<Record<TeamId, ResultMark[]>> = {};
  const scorers: Partial<Record<TeamId, LiveScorer[]>> = {};
  const stats: Partial<Record<TeamId, LiveClubStats>> = {};
  for (const row of snapshot.teams) {
    const id = teamIdFromName(row.team);
    if (!id) continue;
    form[id] = row.form;
    scorers[id] = row.scorers.map((player) => ({
      id: player.id,
      name: player.name,
      pos: player.position,
      goals: player.goals,
    }));
    stats[id] = {
      position: row.position ?? null,
      playedGames: row.playedGames ?? null,
      points: row.points ?? null,
      goalsFor: row.goalsFor ?? null,
      goalsAgainst: row.goalsAgainst ?? null,
    };
  }
  applyLiveForm(form);
  applyLiveScorers(scorers);
  applyLiveStats(stats);
}

type LiveModelRow = ModelRowLambdas & {
  pHome: number;
  pDraw: number;
  pAway: number;
  pBttsYes: number;
  topScores?: { score: string; probability: number }[];
  oddsSources?: {
    source: string;
    observedAt: string;
    pHome: number;
    pDraw: number;
    pAway: number;
  }[];
};

type LiveMatch = {
  id: number;
  competitionId: string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
  status: string;
  venue?: string | null;
  score?: { home: number; away: number } | null;
};

/** Goal estimates and totals come from the validated server forecast. */

function pickLean(pHome: number, pDraw: number, pAway: number, pBtts: number): MarketKey {
  const oneXTwo: { key: MarketKey; p: number }[] = [
    { key: "home", p: pHome },
    { key: "draw", p: pDraw },
    { key: "away", p: pAway },
  ];
  oneXTwo.sort((a, b) => b.p - a.p);
  if (oneXTwo[0].p < 0.42 && pBtts >= 0.55) return "bttsY";
  return oneXTwo[0].key;
}

function comparisonOdds(quote: ReturnType<typeof pickDeskMarketQuote>): Fixture["odds"] {
  if (!quote) return null;
  return {
    home: quote.decimals.home,
    draw: quote.decimals.draw,
    away: quote.decimals.away,
    over25: null,
    under25: null,
    bttsY: null,
    bttsN: null,
  };
}

function pct1(value: number): string {
  return roundedPercent(value, 1);
}

function briefFor(row: LiveModelRow, home: TeamId, away: TeamId, lean: MarketKey, over: number, xg: [number, number]): string {
  const menH = scorersForTeam(home, 2).map((p) => p.name).join(", ");
  const menA = scorersForTeam(away, 2).map((p) => p.name).join(", ");
  const formH = FORM[home]?.join("") ?? "";
  const formA = FORM[away]?.join("") ?? "";
  let projection: ReturnType<typeof projectedScore> = null;
  try {
    projection = row.scoreGrid
      ? projectedScore({ xg, scoreGrid: row.scoreGrid, model: { home: row.pHome, draw: row.pDraw, away: row.pAway } })
      : null;
  } catch {
    projection = null;
  }
  const top = row.topScores?.[0];
  const cell = (c: { home: number; away: number }) => `${c.home}-${c.away}`;
  const parts = [
    ratingComparison(TEAMS[home].name, TEAMS[away].name, row.homeElo, row.awayElo),
    `Form ${formH} / ${formA}.`,
    `Expected goals ${xg[0].toFixed(2)}–${xg[1].toFixed(2)}.`,
    `1X2 ${(row.pHome * 100).toFixed(0)}/${(row.pDraw * 100).toFixed(0)}/${(row.pAway * 100).toFixed(0)}.`,
    `BTTS ${(row.pBttsYes * 100).toFixed(0)}% · Over 2.5 ${(over * 100).toFixed(0)}%.`,
    // Same rule and precision as the desk card, /fixtures and the chat (e.g. 2-0 16.4%).
    projection
      ? `Most likely: ${cell(projection.score)} (${pct1(projection.score.probability)}).`
        + (cell(projection.modal) !== cell(projection.score)
          ? ` Single likeliest score ${cell(projection.modal)} (${pct1(projection.modal.probability)}).`
          : "")
      : top ? `Single likeliest score ${top.score} (${pct1(top.probability)}).` : "",
    menH || menA ? `Recent scorers: ${menH} · ${menA}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function espnId(competitionId: string, fixtureId: number) {
  return `espn:${competitionId}:${fixtureId}`;
}

function toOpen(row: LiveModelRow, venue?: string | null): Fixture | null {
  if (row.competitionId !== "eng.1") return null;
  const home = teamIdFromName(row.home);
  const away = teamIdFromName(row.away);
  if (!home || !away) return null;
  const { xg, over25: over } = deskNumbersFromModelRow(row);
  const lean = pickLean(row.pHome, row.pDraw, row.pAway, row.pBttsYes);
  const marketQuote = pickDeskMarketQuote(row.oddsSources);
  return {
    id: espnId(row.competitionId, row.fixtureId),
    gw: 4,
    kickoff: row.utcDate.endsWith("Z") ? row.utcDate : `${row.utcDate}Z`,
    venue: venue || TEAMS[home].city,
    home,
    away,
    status: "upcoming",
    xg,
    ...(row.scoreGrid ? { scoreGrid: row.scoreGrid } : {}),
    ...(row.goalCalibration ? { goalCalibration: row.goalCalibration } : {}),
    model: {
      home: row.pHome,
      draw: row.pDraw,
      away: row.pAway,
      over25: over,
      btts: row.pBttsYes,
    },
    odds: comparisonOdds(marketQuote),
    marketQuote,
    brief: briefFor(row, home, away, lean, over, xg),
    modelPick: lean,
  };
}

function toSettled(m: LiveMatch): Fixture | null {
  if (m.competitionId !== "eng.1") return null;
  const home = teamIdFromName(m.homeTeam);
  const away = teamIdFromName(m.awayTeam);
  if (!home || !away) return null;
  const score: [number, number] | undefined = m.score ? [m.score.home, m.score.away] : undefined;
  const prior =
    SETTLED_FIXTURES.find((f) => f.home === home && f.away === away) ??
    getStaticFixture(`gw3-${home.toLowerCase()}-${away.toLowerCase()}`);
  const won =
    score && prior?.modelPick
      ? prior.modelPick === "home"
        ? score[0] > score[1]
        : prior.modelPick === "away"
          ? score[1] > score[0]
          : prior.modelPick === "draw"
            ? score[0] === score[1]
            : undefined
      : prior?.modelHit;
  return {
    id: espnId(m.competitionId, m.id),
    gw: 3,
    kickoff: m.utcDate.endsWith("Z") ? m.utcDate : `${m.utcDate}Z`,
    venue: m.venue || TEAMS[home].city,
    home,
    away,
    status: "ft",
    score,
    scorers: prior?.scorers,
    xg: prior?.xg ?? null,
    model: prior?.model ?? null,
    odds: prior?.odds ?? null,
    brief: prior?.brief ?? `${TEAMS[home].name} ${score ? score[0] : "?"}–${score ? score[1] : "?"} ${TEAMS[away].name}.`,
    modelPick: prior?.modelPick ?? null,
    modelHit: won,
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${LIVE_API}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Live API ${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export type LiveSlate = {
  open: Fixture[];
  settled: Fixture[];
  source: "live" | "no-fixtures" | "static" | "unavailable";
  asOf: string;
};

export async function fetchLiveSlate(): Promise<LiveSlate> {
  const [model, active, recent] = await Promise.all([
    getJson<{ fixtures: LiveModelRow[] }>("/api/model/active"),
    getJson<{ fixtures: LiveMatch[] }>("/api/matches/active"),
    getJson<{ matches: LiveMatch[]; clubForm?: ClubFormSnapshot }>(
      "/api/matches/recent?competition=eng.1",
    ),
  ]);
  applyClubForm(recent.clubForm ?? { teams: [] });
  const venueById = new Map(active.fixtures.map((m) => [m.id, m.venue]));
  const open = model.fixtures
    .filter((r) => r.competitionId === "eng.1")
    .map((r) => toOpen(r, venueById.get(r.fixtureId)))
    .filter((f): f is Fixture => Boolean(f))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const settled = recent.matches
    .map(toSettled)
    .filter((f): f is Fixture => Boolean(f))
    .slice(0, 10);
  return {
    open,
    settled,
    source: open.length > 0 ? "live" : "no-fixtures",
    asOf: new Date().toISOString(),
  };
}

export function liveFixtureContext(id: string) {
  return { fixtureId: id };
}
