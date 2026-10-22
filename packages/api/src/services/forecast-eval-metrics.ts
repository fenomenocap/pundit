/**
 * Offline scoring for EPL walk-forward experiments.
 * The 5-bucket ECE matches the club-season ledger: every home, draw and away
 * probability is binned by its own forecast, on cuts 0.2 / 0.4 / 0.6 / 0.8.
 */

export interface ScoredMatch {
  result: 0 | 1 | 2;
  oneXTwo: readonly [number, number, number];
  over25: number;
  over25Actual: 0 | 1;
  btts: number;
  bttsActual: 0 | 1;
  scorelineLogLoss: number;
}

export interface ReliabilityBin {
  bin: string;
  n: number;
  meanPredicted: number;
  observed: number;
}

const EDGES = [0, 0.2, 0.4, 0.6, 0.8];

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: readonly number[]): number {
  if (!values.length) throw new Error("Empty metric sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function oneXTwoLogLoss(probabilities: readonly [number, number, number], result: 0 | 1 | 2): number {
  return -Math.log(Math.max(probabilities[result], 1e-15));
}

export function oneXTwoBrier(probabilities: readonly [number, number, number], result: 0 | 1 | 2): number {
  return probabilities.reduce((sum, probability, index) => sum + (probability - (index === result ? 1 : 0)) ** 2, 0);
}

/** Home wins a tie, matching the club-season predicted-outcome rule. */
export function predictedResult(probabilities: readonly [number, number, number]): 0 | 1 | 2 {
  if (probabilities[0] >= probabilities[1] && probabilities[0] >= probabilities[2]) return 0;
  if (probabilities[1] >= probabilities[0] && probabilities[1] >= probabilities[2]) return 1;
  return 2;
}

export function binaryLogLoss(probability: number, actual: 0 | 1): number {
  return -Math.log(Math.max(actual ? probability : 1 - probability, 1e-15));
}

export function reliability(probabilities: readonly number[], actuals: readonly number[], bins = 10): {
  ece: number;
  bins: ReliabilityBin[];
} {
  if (probabilities.length !== actuals.length || !probabilities.length) throw new Error("Reliability sample mismatch");
  const out: ReliabilityBin[] = [];
  let ece = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const lower = bin / bins;
    const upper = (bin + 1) / bins;
    const indexes = probabilities.map((_, index) => index).filter((index) => {
      const probability = probabilities[index];
      return probability >= lower && (probability < upper || (bin === bins - 1 && probability <= 1));
    });
    if (!indexes.length) continue;
    const meanPredicted = mean(indexes.map((index) => probabilities[index]));
    const observed = mean(indexes.map((index) => actuals[index]));
    ece += (indexes.length / probabilities.length) * Math.abs(meanPredicted - observed);
    out.push({
      bin: `${lower.toFixed(1)}-${upper.toFixed(1)}`,
      n: indexes.length,
      meanPredicted: +meanPredicted.toFixed(4),
      observed: +observed.toFixed(4),
    });
  }
  return { ece: +ece.toFixed(4), bins: out };
}

/** Pooled home/draw/away ECE on the ledger's five buckets. */
export function eceFiveBuckets(matches: readonly ScoredMatch[]): { ece: number; bins: ReliabilityBin[] } {
  const buckets = EDGES.map((lower, index) => ({
    lower,
    upper: index === EDGES.length - 1 ? 1.01 : EDGES[index + 1],
    label: index === EDGES.length - 1 ? "0.8-1.0" : `${lower.toFixed(1)}-${EDGES[index + 1].toFixed(1)}`,
    n: 0,
    predicted: 0,
    observed: 0,
  }));
  for (const match of matches) {
    match.oneXTwo.forEach((probability, outcome) => {
      const bucket = buckets.find((entry) => probability >= entry.lower && probability < entry.upper);
      if (!bucket) throw new Error("Probability outside the five ECE buckets");
      bucket.n += 1;
      bucket.predicted += probability;
      bucket.observed += outcome === match.result ? 1 : 0;
    });
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.n, 0);
  let ece = 0;
  const bins: ReliabilityBin[] = [];
  for (const bucket of buckets) {
    if (!bucket.n) continue;
    const meanPredicted = bucket.predicted / bucket.n;
    const observed = bucket.observed / bucket.n;
    ece += (bucket.n / total) * Math.abs(meanPredicted - observed);
    bins.push({
      bin: bucket.label,
      n: bucket.n,
      meanPredicted: +meanPredicted.toFixed(4),
      observed: +observed.toFixed(4),
    });
  }
  return { ece: +ece.toFixed(4), bins };
}

export function summarize(matches: readonly ScoredMatch[]) {
  const oneXTwo = {
    logLoss: +mean(matches.map((match) => oneXTwoLogLoss(match.oneXTwo, match.result))).toFixed(4),
    brier: +mean(matches.map((match) => oneXTwoBrier(match.oneXTwo, match.result))).toFixed(4),
    accuracy: +mean(matches.map((match) => predictedResult(match.oneXTwo) === match.result ? 1 : 0)).toFixed(4),
    ece5: eceFiveBuckets(matches).ece,
  };
  const over25 = {
    logLoss: +mean(matches.map((match) => binaryLogLoss(match.over25, match.over25Actual))).toFixed(4),
    brier: +mean(matches.map((match) => (match.over25 - match.over25Actual) ** 2)).toFixed(4),
    ece: reliability(matches.map((match) => match.over25), matches.map((match) => match.over25Actual)).ece,
    meanPredicted: +mean(matches.map((match) => match.over25)).toFixed(4),
    observedRate: +mean(matches.map((match) => match.over25Actual)).toFixed(4),
  };
  const btts = {
    logLoss: +mean(matches.map((match) => binaryLogLoss(match.btts, match.bttsActual))).toFixed(4),
    brier: +mean(matches.map((match) => (match.btts - match.bttsActual) ** 2)).toFixed(4),
    ece: reliability(matches.map((match) => match.btts), matches.map((match) => match.bttsActual)).ece,
    meanPredicted: +mean(matches.map((match) => match.btts)).toFixed(4),
    observedRate: +mean(matches.map((match) => match.bttsActual)).toFixed(4),
  };
  return {
    n: matches.length,
    oneXTwo,
    over25,
    btts,
    scorelineLogLoss: +mean(matches.map((match) => match.scorelineLogLoss)).toFixed(4),
    compositeLogLoss: +(oneXTwo.logLoss + over25.logLoss + btts.logLoss).toFixed(4),
  };
}

export function perMatchCompositeDelta(candidate: readonly ScoredMatch[], baseline: readonly ScoredMatch[]): number[] {
  if (candidate.length !== baseline.length) throw new Error("Paired sample length mismatch");
  return candidate.map((match, index) => {
    const other = baseline[index];
    return oneXTwoLogLoss(match.oneXTwo, match.result) - oneXTwoLogLoss(other.oneXTwo, other.result)
      + binaryLogLoss(match.over25, match.over25Actual) - binaryLogLoss(other.over25, other.over25Actual)
      + binaryLogLoss(match.btts, match.bttsActual) - binaryLogLoss(other.btts, other.bttsActual);
  });
}

export function bootstrapStatistic(size: number, statistic: (indexes: readonly number[]) => number,
  seed = 20261022, resamples = 2000): {
  estimate: number;
  ci95: [number, number];
  shareBelowZero: number;
  resamples: number;
  seed: number;
} {
  if (size < 1) throw new Error("Empty bootstrap sample");
  const rand = mulberry32(seed);
  const point = statistic([...Array(size).keys()]);
  const samples: number[] = [];
  const indexes = new Array<number>(size);
  for (let sample = 0; sample < resamples; sample += 1) {
    for (let index = 0; index < size; index += 1) indexes[index] = Math.floor(rand() * size);
    samples.push(statistic(indexes));
  }
  samples.sort((left, right) => left - right);
  return {
    estimate: +point.toFixed(6),
    ci95: [+samples[Math.floor(0.025 * resamples)].toFixed(6), +samples[Math.floor(0.975 * resamples)].toFixed(6)],
    shareBelowZero: +(samples.filter((value) => value < 0).length / resamples).toFixed(4),
    resamples,
    seed,
  };
}

export function bootstrapMean(values: readonly number[], seed = 20261022, resamples = 2000): {
  estimate: number;
  ci95: [number, number];
  shareBelowZero: number;
  resamples: number;
  seed: number;
} {
  const rand = mulberry32(seed);
  const samples: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) sum += values[Math.floor(rand() * values.length)];
    samples.push(sum / values.length);
  }
  samples.sort((left, right) => left - right);
  return {
    estimate: +mean(values).toFixed(6),
    ci95: [+samples[Math.floor(0.025 * resamples)].toFixed(6), +samples[Math.floor(0.975 * resamples)].toFixed(6)],
    shareBelowZero: +(samples.filter((value) => value < 0).length / resamples).toFixed(4),
    resamples,
    seed,
  };
}
