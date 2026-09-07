import type { TeamId } from "./teams";

export type MarketKey = "home" | "draw" | "away" | "over25" | "under25" | "bttsY" | "bttsN";

export type Odds = Record<MarketKey, number>;

export type FixtureStatus = "ft" | "upcoming";

export type Fixture = {
  id: string;
  gw: 3 | 4;
  kickoff: string;
  venue: string;
  home: TeamId;
  away: TeamId;
  status: FixtureStatus;
  score?: [number, number];
  scorers?: string;
  xg: [number, number];
  model: { home: number; draw: number; away: number; over25: number; btts: number };
  odds: Odds;
  brief: string;
  modelPick: MarketKey;
  modelHit?: boolean;
};

export const MARKET_LABEL: Record<MarketKey, string> = {
  home: "Home",
  draw: "Draw",
  away: "Away",
  over25: "Over 2.5",
  under25: "Under 2.5",
  bttsY: "BTTS Yes",
  bttsN: "BTTS No",
};

export const FIXTURES: Fixture[] = [
  {
    id: "gw3-ips-liv",
    gw: 3,
    kickoff: "2026-09-04T19:00:00Z",
    venue: "Portman Road",
    home: "IPS",
    away: "LIV",
    status: "ft",
    score: [0, 2],
    scorers: "Isak 5', 8'",
    xg: [0.41, 2.18],
    model: { home: 0.11, draw: 0.18, away: 0.71, over25: 0.62, btts: 0.38 },
    odds: { home: 8.4, draw: 5.1, away: 1.36, over25: 1.66, under25: 2.2, bttsY: 2.05, bttsN: 1.75 },
    brief: "Iraola's first league win. Isak twice before the tenth minute. The model had Liverpool as a banker — it landed.",
    modelPick: "away",
    modelHit: true,
  },
  {
    id: "gw3-new-bou",
    gw: 3,
    kickoff: "2026-09-05T11:30:00Z",
    venue: "St James' Park",
    home: "NEW",
    away: "BOU",
    status: "ft",
    score: [2, 2],
    scorers: "Barnes 36', Ramsey 87' · Tavernier 8', Thiaw 34'",
    xg: [1.64, 1.51],
    model: { home: 0.48, draw: 0.26, away: 0.26, over25: 0.61, btts: 0.58 },
    odds: { home: 1.85, draw: 3.7, away: 4.1, over25: 1.7, under25: 2.15, bttsY: 1.67, bttsN: 2.2 },
    brief: "Cherries controlled the first half; Newcastle stole a point late through Ramsey. Model leaned home. Miss.",
    modelPick: "home",
    modelHit: false,
  },
  {
    id: "gw3-bre-sun",
    gw: 3,
    kickoff: "2026-09-05T14:00:00Z",
    venue: "Gtech Community Stadium",
    home: "BRE",
    away: "SUN",
    status: "ft",
    score: [1, 1],
    scorers: "Shared points at the Gtech",
    xg: [1.22, 1.08],
    model: { home: 0.42, draw: 0.29, away: 0.29, over25: 0.48, btts: 0.54 },
    odds: { home: 2.15, draw: 3.4, away: 3.4, over25: 1.95, under25: 1.85, bttsY: 1.72, bttsN: 2.1 },
    brief: "Promoted Sunderland match the Bees for 90. Model wanted a home edge that never arrived.",
    modelPick: "home",
    modelHit: false,
  },
  {
    id: "gw3-bha-lee",
    gw: 3,
    kickoff: "2026-09-05T14:00:00Z",
    venue: "Amex Stadium",
    home: "BHA",
    away: "LEE",
    status: "ft",
    score: [1, 1],
    scorers: "Share of the spoils on the south coast",
    xg: [1.47, 1.19],
    model: { home: 0.44, draw: 0.27, away: 0.29, over25: 0.55, btts: 0.57 },
    odds: { home: 2.05, draw: 3.5, away: 3.6, over25: 1.8, under25: 2.0, bttsY: 1.7, bttsN: 2.15 },
    brief: "Brighton should have put Leeds away. They didn't. Draw was the second ticket — it paid.",
    modelPick: "home",
    modelHit: false,
  },
  {
    id: "gw3-ful-cry",
    gw: 3,
    kickoff: "2026-09-05T14:00:00Z",
    venue: "Craven Cottage",
    home: "FUL",
    away: "CRY",
    status: "ft",
    score: [2, 3],
    scorers: "Palace win 3-2 at the Cottage",
    xg: [1.55, 1.88],
    model: { home: 0.34, draw: 0.26, away: 0.4, over25: 0.63, btts: 0.62 },
    odds: { home: 2.7, draw: 3.4, away: 2.55, over25: 1.72, under25: 2.1, bttsY: 1.65, bttsN: 2.25 },
    brief: "Five-goal chaos. Model had Palace + Over 2.5 as the stack. Both landed.",
    modelPick: "away",
    modelHit: true,
  },
  {
    id: "gw3-mci-cov",
    gw: 3,
    kickoff: "2026-09-05T14:00:00Z",
    venue: "Etihad Stadium",
    home: "MCI",
    away: "COV",
    status: "ft",
    score: [1, 0],
    scorers: "Haaland 25'",
    xg: [2.41, 0.38],
    model: { home: 0.78, draw: 0.15, away: 0.07, over25: 0.64, btts: 0.32 },
    odds: { home: 1.18, draw: 7.5, away: 15, over25: 1.55, under25: 2.45, bttsY: 2.4, bttsN: 1.55 },
    brief: "Haaland, one swing, job done. City never got out of second gear. Home banker, HIT. Over 2.5 missed.",
    modelPick: "home",
    modelHit: true,
  },
  {
    id: "gw3-nfo-tot",
    gw: 3,
    kickoff: "2026-09-05T14:00:00Z",
    venue: "The City Ground",
    home: "NFO",
    away: "TOT",
    status: "ft",
    score: [0, 0],
    scorers: "No goals",
    xg: [0.72, 0.81],
    model: { home: 0.29, draw: 0.3, away: 0.41, over25: 0.42, btts: 0.44 },
    odds: { home: 3.3, draw: 3.3, away: 2.2, over25: 2.05, under25: 1.75, bttsY: 1.9, bttsN: 1.9 },
    brief: "A genuine 0-0. Model wanted Spurs; the right ticket was Under. Miss on the 1X2.",
    modelPick: "away",
    modelHit: false,
  },
  {
    id: "gw3-hul-avl",
    gw: 3,
    kickoff: "2026-09-05T16:30:00Z",
    venue: "MKM Stadium",
    home: "HUL",
    away: "AVL",
    status: "ft",
    score: [0, 0],
    scorers: "No goals",
    xg: [0.61, 1.04],
    model: { home: 0.22, draw: 0.3, away: 0.48, over25: 0.4, btts: 0.41 },
    odds: { home: 4.4, draw: 3.5, away: 1.85, over25: 2.1, under25: 1.72, bttsY: 2.0, bttsN: 1.8 },
    brief: "Hull parked it. Villa couldn't pick the lock. Model away miss; Under 2.5 was the value.",
    modelPick: "away",
    modelHit: false,
  },
  {
    id: "gw3-eve-mun",
    gw: 3,
    kickoff: "2026-09-06T13:00:00Z",
    venue: "Hill Dickinson Stadium",
    home: "EVE",
    away: "MUN",
    status: "ft",
    score: [2, 2],
    scorers: "George 82', Maitland-Niles 90+5' · Mbeumo 46', Sesko 87'",
    xg: [1.38, 1.66],
    model: { home: 0.28, draw: 0.26, away: 0.46, over25: 0.58, btts: 0.57 },
    odds: { home: 3.6, draw: 3.5, away: 2.05, over25: 1.8, under25: 2.0, bttsY: 1.7, bttsN: 2.15 },
    brief: "Maitland-Niles in the 95th. Sesko's first United league goal. Model had United; the draw paid instead. Over HIT.",
    modelPick: "away",
    modelHit: false,
  },
  {
    id: "gw3-ars-che",
    gw: 3,
    kickoff: "2026-09-06T15:30:00Z",
    venue: "Emirates Stadium",
    home: "ARS",
    away: "CHE",
    status: "ft",
    score: [2, 1],
    scorers: "Calafiori 11', Havertz 24', Ødegaard 49' · Rogers 1'",
    xg: [1.92, 1.14],
    model: { home: 0.52, draw: 0.25, away: 0.23, over25: 0.57, btts: 0.55 },
    odds: { home: 1.85, draw: 3.7, away: 4.2, over25: 1.78, under25: 2.05, bttsY: 1.72, bttsN: 2.1 },
    brief: "Rogers scored with the first kick. Arsenal walked it back. Home + BTTS was the desk stack. HIT.",
    modelPick: "home",
    modelHit: true,
  },
  {
    id: "gw4-cry-ips",
    gw: 4,
    kickoff: "2026-09-12T14:00:00Z",
    venue: "Selhurst Park",
    home: "CRY",
    away: "IPS",
    status: "upcoming",
    xg: [1.72, 0.82],
    model: { home: 0.58, draw: 0.24, away: 0.18, over25: 0.54, btts: 0.47 },
    odds: { home: 1.7, draw: 3.8, away: 5.0, over25: 1.9, under25: 1.9, bttsY: 1.95, bttsN: 1.85 },
    brief: "Palace just took three at the Cottage. Ipswich shipped two to Isak before minute ten. Home is the number.",
    modelPick: "home",
  },
  {
    id: "gw4-avl-nfo",
    gw: 4,
    kickoff: "2026-09-12T14:00:00Z",
    venue: "Villa Park",
    home: "AVL",
    away: "NFO",
    status: "upcoming",
    xg: [1.55, 0.96],
    model: { home: 0.51, draw: 0.27, away: 0.22, over25: 0.5, btts: 0.49 },
    odds: { home: 1.95, draw: 3.5, away: 3.9, over25: 1.95, under25: 1.85, bttsY: 1.85, bttsN: 1.95 },
    brief: "Villa blanked at Hull. Forest blanked Spurs. Two sides who can't finish meeting at Villa Park — Under is live.",
    modelPick: "home",
  },
  {
    id: "gw4-liv-ful",
    gw: 4,
    kickoff: "2026-09-12T14:00:00Z",
    venue: "Anfield",
    home: "LIV",
    away: "FUL",
    status: "upcoming",
    xg: [2.12, 0.71],
    model: { home: 0.67, draw: 0.2, away: 0.13, over25: 0.61, btts: 0.45 },
    odds: { home: 1.44, draw: 4.6, away: 7.0, over25: 1.7, under25: 2.15, bttsY: 1.9, bttsN: 1.9 },
    brief: "Iraola at Anfield. Isak in the mood. Fulham leaked three to Palace. This is the desk's GW4 banker.",
    modelPick: "home",
  },
  {
    id: "gw4-che-hul",
    gw: 4,
    kickoff: "2026-09-12T14:00:00Z",
    venue: "Stamford Bridge",
    home: "CHE",
    away: "HUL",
    status: "upcoming",
    xg: [1.88, 0.64],
    model: { home: 0.64, draw: 0.22, away: 0.14, over25: 0.56, btts: 0.41 },
    odds: { home: 1.4, draw: 4.8, away: 8.0, over25: 1.78, under25: 2.05, bttsY: 2.05, bttsN: 1.75 },
    brief: "Chelsea lost at the Emirates but still create. Hull sat in a low block for a point against Villa. Home, not Over.",
    modelPick: "home",
  },
  {
    id: "gw4-bou-bre",
    gw: 4,
    kickoff: "2026-09-12T14:00:00Z",
    venue: "Vitality Stadium",
    home: "BOU",
    away: "BRE",
    status: "upcoming",
    xg: [1.48, 1.22],
    model: { home: 0.42, draw: 0.26, away: 0.32, over25: 0.57, btts: 0.58 },
    odds: { home: 2.2, draw: 3.5, away: 3.2, over25: 1.78, under25: 2.05, bttsY: 1.67, bttsN: 2.2 },
    brief: "Two open sides. Bournemouth took a point off Newcastle; Brentford couldn't see off Sunderland. BTTS is the cleanest number.",
    modelPick: "bttsY",
  },
  {
    id: "gw4-tot-eve",
    gw: 4,
    kickoff: "2026-09-12T16:30:00Z",
    venue: "Tottenham Hotspur Stadium",
    home: "TOT",
    away: "EVE",
    status: "upcoming",
    xg: [1.66, 1.05],
    model: { home: 0.5, draw: 0.26, away: 0.24, over25: 0.53, btts: 0.51 },
    odds: { home: 1.85, draw: 3.6, away: 4.2, over25: 1.85, under25: 1.95, bttsY: 1.8, bttsN: 2.0 },
    brief: "Spurs 0-0 at Forest. Everton just stole a point in the 95th. Tottenham should win this; the price is fair, not fat.",
    modelPick: "home",
  },
  {
    id: "gw4-sun-ars",
    gw: 4,
    kickoff: "2026-09-12T19:00:00Z",
    venue: "Stadium of Light",
    home: "SUN",
    away: "ARS",
    status: "upcoming",
    xg: [0.88, 1.74],
    model: { home: 0.18, draw: 0.24, away: 0.58, over25: 0.52, btts: 0.46 },
    odds: { home: 5.5, draw: 4.0, away: 1.6, over25: 1.85, under25: 1.95, bttsY: 1.95, bttsN: 1.85 },
    brief: "Night in the North East. Arsenal just beat Chelsea. Sunderland earned a point at Brentford. Away is the side, 1.60 is thin.",
    modelPick: "away",
  },
  {
    id: "gw4-cov-bha",
    gw: 4,
    kickoff: "2026-09-13T13:00:00Z",
    venue: "Coventry Building Society Arena",
    home: "COV",
    away: "BHA",
    status: "upcoming",
    xg: [0.92, 1.58],
    model: { home: 0.22, draw: 0.26, away: 0.52, over25: 0.51, btts: 0.48 },
    odds: { home: 4.2, draw: 3.6, away: 1.85, over25: 1.9, under25: 1.9, bttsY: 1.9, bttsN: 1.9 },
    brief: "Coventry lost 1-0 at the Etihad without a shot of note. Brighton should have beaten Leeds. Albion to grind it.",
    modelPick: "away",
  },
  {
    id: "gw4-mun-mci",
    gw: 4,
    kickoff: "2026-09-13T15:30:00Z",
    venue: "Old Trafford",
    home: "MUN",
    away: "MCI",
    status: "upcoming",
    xg: [1.22, 1.68],
    model: { home: 0.27, draw: 0.25, away: 0.48, over25: 0.56, btts: 0.55 },
    odds: { home: 3.6, draw: 3.5, away: 2.05, over25: 1.78, under25: 2.05, bttsY: 1.72, bttsN: 2.1 },
    brief: "Derby. City ground out Haaland's 1-0; United needed a 95th-minute equaliser at Everton. Model: City, BTTS on the side.",
    modelPick: "away",
  },
  {
    id: "gw4-lee-new",
    gw: 4,
    kickoff: "2026-09-14T19:00:00Z",
    venue: "Elland Road",
    home: "LEE",
    away: "NEW",
    status: "upcoming",
    xg: [1.34, 1.28],
    model: { home: 0.38, draw: 0.28, away: 0.34, over25: 0.54, btts: 0.56 },
    odds: { home: 2.45, draw: 3.4, away: 2.8, over25: 1.85, under25: 1.95, bttsY: 1.72, bttsN: 2.1 },
    brief: "Monday night. Elland Road. Two sides who both dropped points they felt they deserved. Coin flip — BTTS is the desk lean.",
    modelPick: "bttsY",
  },
];

export const OPEN_FIXTURES = FIXTURES.filter((f) => f.status === "upcoming");
export const SETTLED_FIXTURES = FIXTURES.filter((f) => f.status === "ft");

export function applyLiveSlate(open: Fixture[], settled: Fixture[]) {
  OPEN_FIXTURES.splice(0, OPEN_FIXTURES.length, ...open);
  SETTLED_FIXTURES.splice(0, SETTLED_FIXTURES.length, ...settled);
  FIXTURES.splice(0, FIXTURES.length, ...settled, ...open);
}

export function getFixture(id: string) {
  return FIXTURES.find((f) => f.id === id) ?? OPEN_FIXTURES.find((f) => f.id === id) ?? SETTLED_FIXTURES.find((f) => f.id === id);
}

export function implied(price: number) {
  return 1 / price;
}

export function edge(modelProb: number, price: number) {
  return modelProb - implied(price);
}

export function modelProbFor(f: Fixture, key: MarketKey): number {
  switch (key) {
    case "home":
      return f.model.home;
    case "draw":
      return f.model.draw;
    case "away":
      return f.model.away;
    case "over25":
      return f.model.over25;
    case "under25":
      return 1 - f.model.over25;
    case "bttsY":
      return f.model.btts;
    case "bttsN":
      return 1 - f.model.btts;
  }
}

export function selectionLabel(f: Fixture, key: MarketKey): string {
  const home = f.home;
  const away = f.away;
  switch (key) {
    case "home":
      return `${home} win`;
    case "draw":
      return `${home}–${away} draw`;
    case "away":
      return `${away} win`;
    case "over25":
      return `${home}–${away} over 2.5`;
    case "under25":
      return `${home}–${away} under 2.5`;
    case "bttsY":
      return `${home}–${away} BTTS`;
    case "bttsN":
      return `${home}–${away} BTTS no`;
  }
}

export function settlesWon(score: [number, number], key: MarketKey): boolean {
  const [h, a] = score;
  switch (key) {
    case "home":
      return h > a;
    case "draw":
      return h === a;
    case "away":
      return a > h;
    case "over25":
      return h + a > 2;
    case "under25":
      return h + a <= 2;
    case "bttsY":
      return h > 0 && a > 0;
    case "bttsN":
      return h === 0 || a === 0;
  }
}

export function gw3Record() {
  const settled = SETTLED_FIXTURES;
  const hits = settled.filter((f) => f.modelHit).length;
  return { hits, n: settled.length, pct: hits / settled.length };
}
