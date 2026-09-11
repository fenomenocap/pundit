import {
  DEFAULT_ELO,
  RHO,
  eloToLambdas,
  matrixTo1x2,
  matrixToBtts,
  matrixToCorrectScores,
  matrixToScorelines,
  matrixToTotals,
  scoreMatrix,
} from "./dixon-coles";
import {
  fairOdds,
  probabilityTotalWithinTolerance,
  type PricingConsensusBlock,
} from "./response-correctness";

/** Halfway shrink toward one timestamped no-vig 1X2. Not a production champion weight. */
export const CONSENSUS_MARKET_WEIGHT = 0.5;

export const PUNDIT_FUNDAMENTAL_LABEL = "Pundit Fundamental";
export const PUNDIT_CONSENSUS_LABEL = "Pundit Consensus";
export const CONSENSUS_METHOD_ID = "labelled-1x2-shrink-lambda-refit";

export interface OneXTwoProbabilities {
  pHome: number;
  pDraw: number;
  pAway: number;
}

export interface CompleteNoVigMarket extends OneXTwoProbabilities {
  source: string;
  observedAt: string;
}

export interface ConsensusScoreline {
  score: string;
  probability: number;
}

export interface PunditConsensusBlock {
  label: typeof PUNDIT_CONSENSUS_LABEL;
  fundamentalLabel: typeof PUNDIT_FUNDAMENTAL_LABEL;
  methodId: typeof CONSENSUS_METHOD_ID;
  marketSource: string;
  marketLabel: string;
  observedAt: string;
  marketWeight: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: ConsensusScoreline[];
  scorelines: ConsensusScoreline[];
  lambdaHome: number;
  lambdaAway: number;
  totalXg: number;
  shrunkTarget: OneXTwoProbabilities;
}

export interface ConsensusInput {
  fundamental: OneXTwoProbabilities;
  market: {
    source: string;
    observedAt: string;
    pHome: number;
    pDraw: number | null;
    pAway: number;
  };
  marketWeight?: number;
}

function finiteOpenUnit(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0 && value < 1;
}

export function isCompleteNoVig1x2(
  row: {
    pHome?: number | null;
    pDraw?: number | null;
    pAway?: number | null;
  } | null | undefined
): row is OneXTwoProbabilities {
  if (!row) return false;
  if (!finiteOpenUnit(row.pHome) || !finiteOpenUnit(row.pDraw) || !finiteOpenUnit(row.pAway)) {
    return false;
  }
  return probabilityTotalWithinTolerance([row.pHome, row.pDraw, row.pAway]);
}

export function completeNoVigMarket(
  row: {
    source?: string | null;
    observedAt?: string | null;
    pHome?: number | null;
    pDraw?: number | null;
    pAway?: number | null;
  } | null | undefined
): CompleteNoVigMarket | null {
  if (!row) return null;
  const source = row.source?.trim();
  const observedAt = row.observedAt?.trim();
  if (!source || !observedAt) return null;
  if (!isCompleteNoVig1x2(row)) return null;
  return {
    source,
    observedAt,
    pHome: row.pHome,
    pDraw: row.pDraw,
    pAway: row.pAway,
  };
}

/** First complete same-source row only. Never blends Stake with Kalshi/Polymarket. */
export function firstCompleteNoVigMarket(
  rows: ReadonlyArray<Parameters<typeof completeNoVigMarket>[0]>
): CompleteNoVigMarket | null {
  for (const row of rows) {
    const complete = completeNoVigMarket(row);
    if (complete) return complete;
  }
  return null;
}

export function marketNoVigLabel(source: string): string {
  const name = source.trim() || "Third-party";
  const titled = name[0].toLocaleUpperCase() + name.slice(1);
  return `${titled} market (no-vig)`;
}

export function shrinkOneXTwoTowardMarket(
  fundamental: OneXTwoProbabilities,
  market: OneXTwoProbabilities,
  marketWeight = CONSENSUS_MARKET_WEIGHT
): OneXTwoProbabilities | null {
  if (!isCompleteNoVig1x2(fundamental) || !isCompleteNoVig1x2(market)) return null;
  if (!Number.isFinite(marketWeight) || marketWeight < 0 || marketWeight > 1) return null;
  const fundamentalWeight = 1 - marketWeight;
  const mixed = {
    pHome: fundamentalWeight * fundamental.pHome + marketWeight * market.pHome,
    pDraw: fundamentalWeight * fundamental.pDraw + marketWeight * market.pDraw,
    pAway: fundamentalWeight * fundamental.pAway + marketWeight * market.pAway,
  };
  const total = mixed.pHome + mixed.pDraw + mixed.pAway;
  if (!(total > 0) || !Number.isFinite(total)) return null;
  const shrunk = {
    pHome: mixed.pHome / total,
    pDraw: mixed.pDraw / total,
    pAway: mixed.pAway / total,
  };
  return isCompleteNoVig1x2(shrunk) ? shrunk : null;
}

function oneXTwoDistance(left: OneXTwoProbabilities, right: OneXTwoProbabilities): number {
  return Math.abs(left.pHome - right.pHome)
    + Math.abs(left.pDraw - right.pDraw)
    + Math.abs(left.pAway - right.pAway);
}

function lambdasFromEloGap(eloGap: number): [number, number] {
  return eloToLambdas(DEFAULT_ELO + eloGap, DEFAULT_ELO, 0);
}

function gridFromLambdas(lambdaHome: number, lambdaAway: number) {
  const matrix = scoreMatrix(lambdaHome, lambdaAway, RHO);
  const [pHome, pDraw, pAway] = matrixTo1x2(matrix);
  const [pOver2_5, pUnder2_5] = matrixToTotals(matrix, 2.5);
  const [pBttsYes, pBttsNo] = matrixToBtts(matrix);
  return {
    pHome,
    pDraw,
    pAway,
    pOver2_5,
    pUnder2_5,
    pBttsYes,
    pBttsNo,
    topScores: matrixToCorrectScores(matrix, 5).map(([[home, away], probability]) => ({
      score: `${home}-${away}`,
      probability,
    })),
    scorelines: matrixToScorelines(matrix).map(([[home, away], probability]) => ({
      score: `${home}-${away}`,
      probability,
    })),
    lambdaHome,
    lambdaAway,
    totalXg: lambdaHome + lambdaAway,
  };
}

/**
 * Phase 0 fixed-total mapping: keep Σλ = 2.70 and search the Elo odds-ratio
 * split so the Dixon-Coles 1X2 stays close to the shrunk target. Totals,
 * BTTS and scorelines then come from that same grid.
 */
export function refitLambdasToTarget1x2(target: OneXTwoProbabilities) {
  if (!isCompleteNoVig1x2(target)) return null;
  let bestGap = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let best = gridFromLambdas(...lambdasFromEloGap(0));
  for (let gap = -800; gap <= 800; gap += 5) {
    const candidate = gridFromLambdas(...lambdasFromEloGap(gap));
    const distance = oneXTwoDistance(candidate, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestGap = gap;
      best = candidate;
    }
  }
  for (let gap = bestGap - 5; gap <= bestGap + 5; gap += 0.25) {
    const candidate = gridFromLambdas(...lambdasFromEloGap(gap));
    const distance = oneXTwoDistance(candidate, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function pricingConsensusFromBlock(
  consensus: PunditConsensusBlock
): PricingConsensusBlock {
  const fair = (p: number) => {
    const odds = fairOdds(p);
    return odds ?? (p > 0 ? 1 / p : 1);
  };
  return {
    label: consensus.label,
    fundamentalLabel: consensus.fundamentalLabel,
    marketSource: consensus.marketSource,
    marketLabel: consensus.marketLabel,
    observedAt: consensus.observedAt,
    marketWeight: consensus.marketWeight,
    model: {
      home: { p: consensus.pHome, fairOdds: fair(consensus.pHome) },
      draw: { p: consensus.pDraw, fairOdds: fair(consensus.pDraw) },
      away: { p: consensus.pAway, fairOdds: fair(consensus.pAway) },
    },
  };
}

export function buildPunditConsensus(input: ConsensusInput): PunditConsensusBlock | null {
  const market = completeNoVigMarket(input.market);
  if (!market || !isCompleteNoVig1x2(input.fundamental)) return null;
  const weight = input.marketWeight ?? CONSENSUS_MARKET_WEIGHT;
  const shrunkTarget = shrinkOneXTwoTowardMarket(input.fundamental, market, weight);
  if (!shrunkTarget) return null;
  const refit = refitLambdasToTarget1x2(shrunkTarget);
  if (!refit) return null;
  return {
    label: PUNDIT_CONSENSUS_LABEL,
    fundamentalLabel: PUNDIT_FUNDAMENTAL_LABEL,
    methodId: CONSENSUS_METHOD_ID,
    marketSource: market.source,
    marketLabel: marketNoVigLabel(market.source),
    observedAt: market.observedAt,
    marketWeight: weight,
    pHome: refit.pHome,
    pDraw: refit.pDraw,
    pAway: refit.pAway,
    pOver2_5: refit.pOver2_5,
    pUnder2_5: refit.pUnder2_5,
    pBttsYes: refit.pBttsYes,
    pBttsNo: refit.pBttsNo,
    topScores: refit.topScores,
    scorelines: refit.scorelines,
    lambdaHome: refit.lambdaHome,
    lambdaAway: refit.lambdaAway,
    totalXg: refit.totalXg,
    shrunkTarget,
  };
}

export function consensusCandidateRows(input: {
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  stakeObservedAt?: string;
  pricedAt: string;
  oddsSources: ReadonlyArray<{
    source: string;
    observedAt: string;
    pHome: number;
    pDraw: number | null;
    pAway: number;
  }>;
}): Array<Parameters<typeof completeNoVigMarket>[0]> {
  return [
    {
      source: "stake",
      observedAt: input.stakeObservedAt ?? input.pricedAt,
      pHome: input.stakePHome,
      pDraw: input.stakePDraw,
      pAway: input.stakePAway,
    },
    ...input.oddsSources,
  ];
}
