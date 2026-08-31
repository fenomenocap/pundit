import type { Grounding } from "./ask";

export type FactProvenance =
  | "server-model"
  | "market-observation"
  | "verified-evidence"
  | "analyst-inference"
  | "abstention";

export type NumericUnit = "probability" | "percentage-points" | "decimal-odds";

export interface ResponseFact {
  id: string;
  kind: "probability" | "scoreline" | "market-comparison" | "fixture" | "limitation";
  provenance: FactProvenance;
  subject: string;
  numeric?: { value: number; unit: NumericUnit };
  /** Complete comparison tuple; none of these values may be reconstructed by expression code. */
  marketObservation?: {
    modelProbability: number;
    marketProbability: number;
    gapPoints: number;
  };
  observedAt?: string;
  sourceIds?: string[];
  allowedClaims: string[];
  prohibitedClaims?: string[];
}

export interface ResponseFacts {
  fixture: Pick<Grounding, "fixtureId" | "home" | "away" | "date" | "homeFieldAdvantage">;
  facts: ResponseFact[];
}

export function buildResponseFacts(grounding: Grounding): ResponseFacts {
  const facts: ResponseFact[] = [
    ["match.home", grounding.home, grounding.pHome],
    ["match.draw", "the draw", grounding.pDraw],
    ["match.away", grounding.away, grounding.pAway],
    ["total.over-2.5", "over 2.5 goals", grounding.pOver2_5],
    ["total.under-2.5", "under 2.5 goals", grounding.pUnder2_5],
    ["btts.yes", "both teams to score", grounding.pBttsYes],
    ["btts.no", "both teams not to score", grounding.pBttsNo],
  ].map(([id, subject, value]) => ({
    id: String(id), kind: "probability" as const, provenance: "server-model" as const,
    subject: String(subject), numeric: { value: Number(value), unit: "probability" as const },
    allowedClaims: ["quote", "compare", "convert-to-fair-decimal-odds"],
  }));

  grounding.scorelines.forEach((row) => facts.push({
    id: `score.${row.score}`,
    kind: "scoreline",
    provenance: "server-model",
    subject: row.score,
    numeric: { value: row.probability, unit: "probability" },
    allowedClaims: ["quote", "rank", "convert-to-fair-decimal-odds"],
  }));

  grounding.marketDivergence.forEach((market) => market.legs.forEach((leg) => facts.push({
    id: `market.${market.source}.${leg.outcome}`,
    kind: "market-comparison",
    provenance: "market-observation",
    subject: leg.label,
    numeric: { value: leg.gapPoints, unit: "percentage-points" },
    marketObservation: {
      modelProbability: leg.modelPercent / 100,
      marketProbability: leg.marketPercent / 100,
      gapPoints: leg.gapPoints,
    },
    observedAt: market.observedAt,
    sourceIds: [market.source],
    allowedClaims: ["quote-model-price", "quote-market-price", "state-gap-direction"],
    prohibitedClaims: ["infer-cause", "infer-lineup", "recommend-wager"],
  })));

  facts.push({
    id: "limit.player-pricing",
    kind: "limitation",
    provenance: "abstention",
    subject: "player pricing",
    allowedClaims: ["cannot-price-with-match-facts"],
  }, {
    id: "limit.lineup-counterfactual",
    kind: "limitation",
    provenance: "abstention",
    subject: "lineup counterfactual",
    allowedClaims: ["cannot-quantify-without-revised-forecast"],
  });

  return {
    fixture: {
      fixtureId: grounding.fixtureId,
      home: grounding.home,
      away: grounding.away,
      date: grounding.date,
      homeFieldAdvantage: grounding.homeFieldAdvantage,
    },
    facts,
  };
}

export function factById(contract: ResponseFacts, id: string): ResponseFact | undefined {
  return contract.facts.find((fact) => fact.id === id);
}
