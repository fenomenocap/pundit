export type VaultId = "alpha" | "neutral" | "yield";

export type Vault = {
  id: VaultId;
  name: string;
  code: string;
  tag: string;
  blurb: string;
  ytd: number;
  vol: number;
  maxdd: number;
  sharpe: number;
  min: number;
  holdings: { label: string; weight: number; edge: number }[];
  nav: number[];
};

export const VAULTS: Vault[] = [
  {
    id: "alpha",
    name: "Alpha",
    code: "PND-A",
    tag: "Directional",
    blurb: "High-conviction sides where the model is fat vs the board. Concentrated. Weekend-shaped. Paper only.",
    ytd: 0.186,
    vol: 0.22,
    maxdd: -0.074,
    sharpe: 1.42,
    min: 250,
    holdings: [
      { label: "LIV win vs FUL", weight: 0.34, edge: 0.042 },
      { label: "CRY win vs IPS", weight: 0.22, edge: 0.031 },
      { label: "MCI win at OT", weight: 0.2, edge: 0.028 },
      { label: "CHE win vs HUL", weight: 0.24, edge: 0.019 },
    ],
    nav: [100, 101.2, 99.4, 102.8, 104.1, 103.2, 106.4, 108.9, 107.6, 110.4, 112.8, 111.5, 114.2, 116.8, 118.6],
  },
  {
    id: "neutral",
    name: "Market Neutral",
    code: "PND-N",
    tag: "Spread",
    blurb: "No view on who wins. Harvests Over/Under and BTTS mispricings, hedged across the slate.",
    ytd: 0.094,
    vol: 0.08,
    maxdd: -0.021,
    sharpe: 1.88,
    min: 500,
    holdings: [
      { label: "BOU–BRE BTTS", weight: 0.28, edge: 0.037 },
      { label: "LEE–NEW BTTS", weight: 0.24, edge: 0.029 },
      { label: "AVL–NFO Under 2.5", weight: 0.26, edge: 0.024 },
      { label: "EVE–MUN leftover Under", weight: 0.22, edge: 0.011 },
    ],
    nav: [100, 100.4, 100.8, 100.6, 101.2, 101.8, 102.1, 102.0, 102.7, 103.4, 103.9, 104.2, 104.8, 105.3, 109.4],
  },
  {
    id: "yield",
    name: "Yield",
    code: "PND-Y",
    tag: "Grind",
    blurb: "Short-priced grinders. 1.30–1.55 range. Size up, swing small, compound the week.",
    ytd: 0.061,
    vol: 0.05,
    maxdd: -0.018,
    sharpe: 1.21,
    min: 1000,
    holdings: [
      { label: "LIV 1.44", weight: 0.3, edge: 0.018 },
      { label: "CHE 1.40", weight: 0.28, edge: 0.012 },
      { label: "ARS 1.60", weight: 0.22, edge: 0.008 },
      { label: "BHA 1.85", weight: 0.2, edge: 0.015 },
    ],
    nav: [100, 100.2, 100.5, 100.3, 100.8, 101.1, 101.0, 101.4, 101.8, 102.1, 102.6, 102.9, 103.3, 103.8, 106.1],
  },
];
