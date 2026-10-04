export type VaultId = "alpha" | "neutral" | "yield";

export type Vault = {
  id: VaultId;
  name: string;
  code: string;
  tag: string;
  blurb: string;
  min: number;
};

// Illustrative practice buckets. No performance, holdings or forecast claims.
export const VAULTS: Vault[] = [
  {
    id: "alpha", name: "Alpha", code: "PND-A", tag: "Directional",
    blurb: "A practice bucket for thinking about match-result exposure.", min: 250,
  },
  {
    id: "neutral", name: "Market Neutral", code: "PND-N", tag: "Spread",
    blurb: "A practice bucket for comparing different goal-market ideas. The name does not establish a hedge or neutral exposure.", min: 500,
  },
  {
    id: "yield", name: "Yield", code: "PND-Y", tag: "Grind",
    blurb: "A practice bucket for exploring short-priced outcomes. The name does not imply earned income or a return.", min: 1000,
  },
];
