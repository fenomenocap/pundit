import type { ScoreMatrix } from "./dixon-coles";

const COHERENCE_TOLERANCE = 1e-12;

export interface OutcomeAnchoredScoreGrid {
  matrix: ScoreMatrix;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
}

function outcome(homeGoals: number, awayGoals: number): number {
  return homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
}

// Compensated positive sums keep full tails coherent beyond the displayed board.
function add(sums: number[], errors: number[], index: number, value: number): void {
  const adjusted = value - errors[index];
  const next = sums[index] + adjusted;
  errors[index] = (next - sums[index]) - adjusted;
  sums[index] = next;
}

/** Preserve score shape within each outcome; rows are home goals, columns away. */
export function anchorScoreGridTo1x2(
  matrix: readonly (readonly number[])[],
  target: readonly [number, number, number]
): OutcomeAnchoredScoreGrid {
  if (!Array.isArray(matrix) || matrix.length < 2 ||
      matrix.some(row => !Array.isArray(row) || row.length !== matrix.length)) {
    throw new RangeError("Score grid must be square with all three outcome regions");
  }
  if (!Array.isArray(target) || target.length !== 3 ||
      target.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Target 1X2 must contain three finite, strictly positive probabilities");
  }
  const targetTotal = target[0] + target[1] + target[2];
  if (Math.abs(targetTotal - 1) > COHERENCE_TOLERANCE) {
    throw new RangeError("Target 1X2 probabilities must sum to one");
  }
  const masses = [0, 0, 0];
  const massErrors = [0, 0, 0];
  const largest: Array<[number, number]> = [[1, 0], [0, 0], [0, 1]];
  for (let home = 0; home < matrix.length; home += 1) {
    for (let away = 0; away < matrix.length; away += 1) {
      const value = matrix[home][away];
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError("Score grid probabilities must be finite and nonnegative");
      }
      const region = outcome(home, away);
      add(masses, massErrors, region, value);
      const [largestHome, largestAway] = largest[region];
      if (value > matrix[largestHome][largestAway]) largest[region] = [home, away];
    }
  }
  if (masses.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Score grid must have positive mass in every outcome region");
  }
  if (Math.abs(masses[0] + masses[1] + masses[2] - 1) > COHERENCE_TOLERANCE) {
    throw new RangeError("Score grid probabilities must sum to one");
  }
  const desired = target.map((value: number) => value / targetTotal);
  const anchoredMasses = [0, 0, 0];
  const anchoredErrors = [0, 0, 0];
  const anchored = matrix.map((row: readonly number[], home: number) => row.map((value: number, away: number) => {
    const region = outcome(home, away);
    // Divide first: target / tiny original mass can overflow even for valid grids.
    const probability = (value / masses[region]) * desired[region];
    add(anchoredMasses, anchoredErrors, region, probability);
    return probability;
  }));
  // Account for roundoff/subnormal underflow on a supported cell, never on a zero.
  for (let region = 0; region < 3; region += 1) {
    const [home, away] = largest[region];
    anchored[home][away] += desired[region] - anchoredMasses[region];
  }
  const checkedMasses = [0, 0, 0];
  const checkedErrors = [0, 0, 0];
  const means = [0, 0];
  const meanErrors = [0, 0];
  for (let home = 0; home < anchored.length; home += 1) {
    for (let away = 0; away < anchored.length; away += 1) {
      const value = anchored[home][away];
      if (!Number.isFinite(value) || value < 0) throw new RangeError("Anchored grid is not finite and nonnegative");
      add(checkedMasses, checkedErrors, outcome(home, away), value);
      add(means, meanErrors, 0, home * value);
      add(means, meanErrors, 1, away * value);
    }
  }
  if (checkedMasses.some((value, region) => value <= 0 || Math.abs(value - target[region]) > COHERENCE_TOLERANCE) ||
      Math.abs(checkedMasses[0] + checkedMasses[1] + checkedMasses[2] - 1) > COHERENCE_TOLERANCE ||
      means.some(value => !Number.isFinite(value))) {
    throw new RangeError("Anchored grid failed probability coherence");
  }
  return { matrix: anchored, expectedHomeGoals: means[0], expectedAwayGoals: means[1] };
}
