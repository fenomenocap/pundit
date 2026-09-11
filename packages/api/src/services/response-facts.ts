import type { Grounding } from "./ask";
import { buildMatchPricing } from "./response-correctness";

function pricingFromGrounding(grounding: Grounding) {
  return buildMatchPricing({
    fixtureId: grounding.fixtureId,
    home: grounding.home,
    away: grounding.away,
    kickoff: grounding.date,
    pricedAt: grounding.oddsSources[0]?.observedAt ?? grounding.date,
    pHome: grounding.pHome,
    pDraw: grounding.pDraw,
    pAway: grounding.pAway,
    markets: grounding.oddsSources.map((source) => ({
      source: source.source,
      observedAt: source.observedAt,
      pHome: source.pHome,
      pDraw: source.pDraw,
      pAway: source.pAway,
      decimalOdds: null,
    })),
  });
}

export type FactProvenance =
  | "server-model"
  | "pundit-consensus"
  | "market-observation"
  | "verified-evidence"
  | "analyst-inference"
  | "abstention";

export type NumericUnit = "probability" | "percentage-points" | "decimal-odds" | "ev-fraction";

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

  if (grounding.consensus) {
    const consensus = grounding.consensus;
    ([
      ["consensus.home", `${consensus.label} ${grounding.home}`, consensus.pHome],
      ["consensus.draw", `${consensus.label} the draw`, consensus.pDraw],
      ["consensus.away", `${consensus.label} ${grounding.away}`, consensus.pAway],
      ["consensus.over-2.5", `${consensus.label} over 2.5 goals`, consensus.pOver2_5],
      ["consensus.under-2.5", `${consensus.label} under 2.5 goals`, consensus.pUnder2_5],
      ["consensus.btts-yes", `${consensus.label} both teams to score`, consensus.pBttsYes],
      ["consensus.btts-no", `${consensus.label} both teams not to score`, consensus.pBttsNo],
    ] as const).forEach(([id, subject, value]) => facts.push({
      id,
      kind: "probability",
      provenance: "pundit-consensus",
      subject,
      numeric: { value, unit: "probability" },
      observedAt: consensus.observedAt,
      sourceIds: [consensus.marketSource],
      allowedClaims: ["quote", "compare", "convert-to-fair-decimal-odds"],
      prohibitedClaims: ["present-as-fundamental", "recommend-wager"],
    }));
  }

  (grounding.marketDivergence ?? []).forEach((market) => market.legs.forEach((leg) => facts.push({
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

  const pricing = grounding.pricing ?? pricingFromGrounding(grounding);
  (["home", "draw", "away"] as const).forEach((outcome) => {
    const subject = outcome === "draw" ? "the draw" : grounding[outcome];
    facts.push({
      id: `pricing.model.${outcome}`,
      kind: "probability",
      provenance: "server-model",
      subject,
      numeric: { value: pricing.model[outcome].fairOdds, unit: "decimal-odds" },
      allowedClaims: ["quote", "convert-to-fair-decimal-odds"],
    });
  });

  if (pricing.userLine) {
    const line = pricing.userLine;
    const subject = line.outcome === "draw" ? "the draw" : grounding[line.outcome];
    facts.push({
      id: "pricing.user-line",
      kind: "market-comparison",
      provenance: "market-observation",
      subject,
      numeric: { value: line.evPct, unit: "ev-fraction" },
      allowedClaims: ["quote"],
      prohibitedClaims: ["infer-cause", "infer-lineup", "recommend-wager"],
    });
  }

  pricing.markets.forEach((market) => (["home", "draw", "away"] as const).forEach((outcome) => {
    const leg = market.legs[outcome];
    if (leg.decimalOdds == null && leg.evPct == null) return;
    facts.push({
      id: `pricing.market.${market.source}.${outcome}`,
      kind: "market-comparison",
      provenance: "market-observation",
      subject: outcome === "draw" ? "the draw" : grounding[outcome],
      ...(leg.evPct != null ? { numeric: { value: leg.evPct, unit: "ev-fraction" as const } } : {
        numeric: { value: leg.decimalOdds!, unit: "decimal-odds" as const },
      }),
      observedAt: market.observedAt,
      sourceIds: [market.source],
      allowedClaims: ["quote-model-price", "quote-market-price"],
      prohibitedClaims: ["infer-cause", "infer-lineup", "recommend-wager"],
    });
  }));

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
