export const ELO_SCALE = 400;
export const DEFAULT_ELO = 1400;
export const BASE_GOALS = 1.35;
export const LAMBDA_CAP = 5;
export const RHO = -0.1;
export const MAX_GOALS = 10;
export const DEFAULT_HOME_ADVANTAGE_ELO = 42;

export type ScoreMatrix = number[][];

export function eloToLambdas(
  eloHome: number,
  eloAway: number,
  homeAdvantageElo = 0
): [number, number] {
  const eloFactor = 10 ** (((eloHome + homeAdvantageElo) - eloAway) / (2 * ELO_SCALE));
  return [
    Math.min(BASE_GOALS * eloFactor, LAMBDA_CAP),
    Math.min(BASE_GOALS / eloFactor, LAMBDA_CAP),
  ];
}

export function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho = RHO
): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function poissonProbabilities(lambda: number, maxGoals: number): number[] {
  const probabilities = new Array<number>(maxGoals + 1);
  probabilities[0] = Math.exp(-lambda);
  for (let goals = 1; goals <= maxGoals; goals += 1) {
    probabilities[goals] = probabilities[goals - 1] * lambda / goals;
  }
  return probabilities;
}

export function scoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho = RHO,
  maxGoals = MAX_GOALS
): ScoreMatrix {
  const home = poissonProbabilities(lambdaHome, maxGoals);
  const away = poissonProbabilities(lambdaAway, maxGoals);
  const matrix = Array.from({ length: maxGoals + 1 }, () =>
    new Array<number>(maxGoals + 1).fill(0)
  );
  let total = 0;
  for (let i = 0; i <= maxGoals; i += 1) {
    for (let j = 0; j <= maxGoals; j += 1) {
      const value = home[i] * away[j] * dixonColesTau(i, j, lambdaHome, lambdaAway, rho);
      matrix[i][j] = value;
      total += value;
    }
  }
  for (const row of matrix) {
    for (let index = 0; index < row.length; index += 1) row[index] /= total;
  }
  return matrix;
}

export function matrixTo1x2(matrix: ScoreMatrix): [number, number, number] {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix[i].length; j += 1) {
      if (i > j) home += matrix[i][j];
      else if (i === j) draw += matrix[i][j];
      else away += matrix[i][j];
    }
  }
  return [home, draw, away];
}

export function matrixToTotals(matrix: ScoreMatrix, line: number): [number, number] {
  let over = 0;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix[i].length; j += 1) {
      if (i + j > line) over += matrix[i][j];
    }
  }
  return [over, 1 - over];
}

export function matrixToBtts(matrix: ScoreMatrix): [number, number] {
  let yes = 0;
  for (let i = 1; i < matrix.length; i += 1) {
    for (let j = 1; j < matrix[i].length; j += 1) yes += matrix[i][j];
  }
  return [yes, 1 - yes];
}

export function matrixToCorrectScores(
  matrix: ScoreMatrix,
  count = 5
): Array<[[number, number], number]> {
  const scores: Array<[[number, number], number]> = [];
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix[i].length; j += 1) scores.push([[i, j], matrix[i][j]]);
  }
  return scores.sort((a, b) => b[1] - a[1]).slice(0, count);
}

// Every scoreline at or above the probability floor, sorted descending —
// so arbitrary "what about 3-2?" questions are answerable, not just the top 5.
export function matrixToScorelines(
  matrix: ScoreMatrix,
  minProbability = 0.001
): Array<[[number, number], number]> {
  return matrixToCorrectScores(matrix, matrix.length ** 2)
    .filter(([, probability]) => probability >= minProbability);
}

export function computeMatchModel(
  eloHome: number,
  eloAway: number,
  homeAdvantageElo = 0
) {
  const matrix = scoreMatrix(...eloToLambdas(eloHome, eloAway, homeAdvantageElo));
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
    topScores: matrixToCorrectScores(matrix, 5),
    scorelines: matrixToScorelines(matrix),
  };
}

export function samplePoisson(lambda: number, random: () => number = Math.random): number {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  knockout = false,
  random: () => number = Math.random
): [number, number] {
  let home = samplePoisson(lambdaHome, random);
  let away = samplePoisson(lambdaAway, random);
  if (!knockout || home !== away) return [home, away];
  const extraHome = samplePoisson(lambdaHome / 3, random);
  const extraAway = samplePoisson(lambdaAway / 3, random);
  home += extraHome;
  away += extraAway;
  if (home !== away) return [home, away];
  return random() < 0.5 ? [home + 1, away] : [home, away + 1];
}
