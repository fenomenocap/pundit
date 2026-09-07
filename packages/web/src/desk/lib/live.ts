import {
  type Fixture,
  type MarketKey,
  SETTLED_FIXTURES,
  getFixture as getStaticFixture,
} from "./data/fixtures";
import { FORM } from "./data/form";
import { playersForTeam } from "./data/players";
import type { TeamId } from "./data/teams";
import { TEAMS } from "./data/teams";
import { mildLambdas, over25 } from "./grid";

export const LIVE_API =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "https://thepundit.up.railway.app";

const NAME_TO_ID: Record<string, TeamId> = {
  Arsenal: "ARS",
  "Aston Villa": "AVL",
  Bournemouth: "BOU",
  Brentford: "BRE",
  Brighton: "BHA",
  Chelsea: "CHE",
  Coventry: "COV",
  "Crystal Palace": "CRY",
  Everton: "EVE",
  Fulham: "FUL",
  Hull: "HUL",
  "Hull City": "HUL",
  Ipswich: "IPS",
  "Ipswich Town": "IPS",
  Leeds: "LEE",
  "Leeds United": "LEE",
  Liverpool: "LIV",
  "Man City": "MCI",
  "Manchester City": "MCI",
  "Man United": "MUN",
  "Manchester United": "MUN",
  Newcastle: "NEW",
  Forest: "NFO",
  "Nott'm Forest": "NFO",
  "Nottingham Forest": "NFO",
  Sunderland: "SUN",
  Tottenham: "TOT",
  Spurs: "TOT",
};

export function teamIdFromName(name: string): TeamId | null {
  return NAME_TO_ID[name] ?? null;
}

type LiveModelRow = {
  competitionId: string;
  fixtureId: number;
  utcDate: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pBttsYes: number;
  topScores?: { score: string; probability: number }[];
  oddsSources?: {
    source: string;
    observedAt: string;
    pHome: number;
    pDraw: number;
    pAway: number;
  }[];
  forecastProvenance?: {
    methodId?: string;
    ratingArtifactId?: string;
    homeAdvantageElo?: number;
    config?: { baseGoals?: number; eloScale?: number; dixonColesRho?: number };
  };
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

/** Frozen-total 2.70 split — production engine. Desk xG/O2.5 uses mildLambdas. */

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

function polyOdds(row: LiveModelRow) {
  const poly = row.oddsSources?.find((s) => s.source === "polymarket");
  const implied = (p: number, fallback: number) => (p > 0.02 ? 1 / p : fallback);
  return {
    home: implied(poly?.pHome ?? 0, 1 / Math.max(row.pHome, 0.05)),
    draw: implied(poly?.pDraw ?? 0, 1 / Math.max(row.pDraw, 0.05)),
    away: implied(poly?.pAway ?? 0, 1 / Math.max(row.pAway, 0.05)),
    over25: 1.9,
    under25: 1.9,
    bttsY: implied(row.pBttsYes, 1.85),
    bttsN: implied(1 - row.pBttsYes, 1.95),
  };
}

function briefFor(row: LiveModelRow, home: TeamId, away: TeamId, lean: MarketKey, over: number, xg: [number, number]): string {
  const menH = playersForTeam(home, 2).map((p) => p.name).join(", ");
  const menA = playersForTeam(away, 2).map((p) => p.name).join(", ");
  const formH = FORM[home]?.join("") ?? "";
  const formA = FORM[away]?.join("") ?? "";
  const top = row.topScores?.[0];
  const parts = [
    `${TEAMS[home].short} (${row.homeElo.toFixed(0)}) vs ${TEAMS[away].short} (${row.awayElo.toFixed(0)}).`,
    `Form ${formH} / ${formA}.`,
    `xG ${xg[0].toFixed(2)}–${xg[1].toFixed(2)}.`,
    `1X2 ${(row.pHome * 100).toFixed(0)}/${(row.pDraw * 100).toFixed(0)}/${(row.pAway * 100).toFixed(0)}.`,
    `BTTS ${(row.pBttsYes * 100).toFixed(0)} · O2.5 ${(over * 100).toFixed(0)} (desk).`,
    top ? `Modal ${top.score} (${(top.probability * 100).toFixed(0)}%).` : "",
    `Lean ${lean}.`,
    menH || menA ? `In form: ${menH} · ${menA}.` : "",
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
  const [lh, la] = mildLambdas(row.homeElo, row.awayElo);
  const over = over25(lh, la);
  const lean = pickLean(row.pHome, row.pDraw, row.pAway, row.pBttsYes);
  return {
    id: espnId(row.competitionId, row.fixtureId),
    gw: 4,
    kickoff: row.utcDate.endsWith("Z") ? row.utcDate : `${row.utcDate}Z`,
    venue: venue || TEAMS[home].city,
    home,
    away,
    status: "upcoming",
    xg: [Math.round(lh * 100) / 100, Math.round(la * 100) / 100],
    model: {
      home: row.pHome,
      draw: row.pDraw,
      away: row.pAway,
      over25: over,
      btts: row.pBttsYes,
    },
    odds: polyOdds(row),
    brief: briefFor(row, home, away, lean, over, [Math.round(lh * 100) / 100, Math.round(la * 100) / 100]),
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
    score && prior
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
    xg: prior?.xg ?? [1.2, 1.1],
    model: prior?.model ?? { home: 0.4, draw: 0.28, away: 0.32, over25: 0.5, btts: 0.5 },
    odds: prior?.odds ?? { home: 2.2, draw: 3.4, away: 3.2, over25: 1.9, under25: 1.9, bttsY: 1.8, bttsN: 2.0 },
    brief: prior?.brief ?? `${TEAMS[home].short} ${score ? score[0] : "?"}–${score ? score[1] : "?"} ${TEAMS[away].short}.`,
    modelPick: prior?.modelPick ?? "home",
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
  source: "live" | "static";
  asOf: string;
};

export async function fetchLiveSlate(): Promise<LiveSlate> {
  const [model, active, recent] = await Promise.all([
    getJson<{ fixtures: LiveModelRow[] }>("/api/model/active"),
    getJson<{ fixtures: LiveMatch[] }>("/api/matches/active"),
    getJson<{ matches: LiveMatch[] }>("/api/matches/recent"),
  ]);
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
  if (open.length < 6) throw new Error("Live slate too thin");
  return { open, settled, source: "live", asOf: new Date().toISOString() };
}

export function liveFixtureContext(id: string) {
  return { fixtureId: id };
}
