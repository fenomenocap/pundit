import { eloToLambdas, matrixTo1x2, matrixToBtts, matrixToTotals, scoreMatrix } from "./dixon-coles";
import { fitHistoricalGoalRates, forecastHistoricalGoalRates, GOAL_CALIBRATION_CANDIDATES,
  type HistoricalGoalRow } from "./historical-goal-calibration";

export interface EvaluationGoalRow extends HistoricalGoalRow {
  seasonId: string;
  freshRating: boolean;
}
export interface GoalLosses {
  scoreline: number; oneXTwo: number; totalsBrier: number; bttsBrier: number;
  totalsLog: number; bttsLog: number; selection: number;
}
export const GOAL_METRICS = ["scoreline", "oneXTwo", "totalsBrier", "bttsBrier", "totalsLog", "bttsLog"] as const;
const DAY = 86_400_000, WEEK = 7 * DAY;

export function utcWeekOrigin(kickoff: string): number {
  const date = new Date(kickoff);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid evaluation kickoff");
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.getTime();
}

export function scoreGoalGrid(matrix: number[][], row: HistoricalGoalRow): GoalLosses {
  const cells = matrix.flat();
  if (cells.some((p) => !Number.isFinite(p) || p < 0) || Math.abs(cells.reduce((a, b) => a + b, 0) - 1) > 1e-10) {
    throw new Error("Noncoherent evaluation grid");
  }
  const probability = matrix[row.homeGoals]?.[row.awayGoals];
  if (!(probability > 0)) throw new Error("Actual result outside positive score grid");
  const result = row.homeGoals > row.awayGoals ? 0 : row.homeGoals === row.awayGoals ? 1 : 2;
  const over = row.homeGoals + row.awayGoals > 2.5 ? 1 : 0, btts = row.homeGoals > 0 && row.awayGoals > 0 ? 1 : 0;
  const pOver = matrixToTotals(matrix, 2.5)[0], pBtts = matrixToBtts(matrix)[0];
  const scoreline = -Math.log(probability), oneXTwo = -Math.log(matrixTo1x2(matrix)[result]);
  const totalsLog = -Math.log(over ? pOver : 1 - pOver), bttsLog = -Math.log(btts ? pBtts : 1 - pBtts);
  return { scoreline, oneXTwo, totalsBrier: (pOver - over) ** 2, bttsBrier: (pBtts - btts) ** 2,
    totalsLog, bttsLog, selection: scoreline + oneXTwo + 2 * totalsLog + bttsLog };
}

export interface EarlierValidation {
  kickoff: string; freshRating: boolean; losses: GoalLosses[];
}
/** Selection can never consume a current/future week or a not-yet-available result. */
export function selectGoalCandidate(records: readonly EarlierValidation[], origin: number): {
  index: number; count: number; means: number[] | null;
} {
  if (!Number.isFinite(origin)) throw new Error("Invalid selection origin");
  const eligible = records.filter((r) => r.freshRating && Date.parse(r.kickoff) <= origin - DAY
    && Date.parse(r.kickoff) >= origin - 26 * WEEK && utcWeekOrigin(r.kickoff) < origin);
  if (eligible.some((r) => r.losses.length !== GOAL_CALIBRATION_CANDIDATES.length
    || r.losses.some((loss) => !Number.isFinite(loss.selection)))) throw new Error("Invalid earlier validation losses");
  if (eligible.length < 60) return { index: 0, count: eligible.length, means: null };
  const means = GOAL_CALIBRATION_CANDIDATES.map((_, i) => eligible.reduce((sum, r) => sum + r.losses[i].selection, 0) / eligible.length);
  let index = 0;
  means.forEach((v, i) => { if (v < means[index] - 1e-12) index = i; });
  return { index, count: eligible.length, means };
}

export interface HistoricalGoalPrediction {
  sourceEventId: string; seasonId: string; kickoff: string; origin: string; freshRating: boolean;
  selectedIndex: number; selectionCount: number; selectionMeans: number[] | null;
  candidate: GoalLosses; champion: GoalLosses;
  candidateFallback: string | null;
  optionFallbacks: Array<string | null>;
  lambdaHome: number; lambdaAway: number; rho: number;
  pOver: number; pBtts: number; oneXTwo: number[];
  trainingCount: number; allocationTrainingCount: number; trainingThrough: string | null;
  optionEvidence?: Array<{ loss: GoalLosses; lambdaHome: number; lambdaAway: number; rho: number;
    trainingSha256: string | null; gradientNorm: number | null; error: string | null }>;
  expectedHomeGoals?: number; expectedAwayGoals?: number;
}

export function replayHistoricalGoalCalibration(input: readonly EvaluationGoalRow[],
  onWeek?: (origin: string, count: number) => void,
  transform?: (matrix: number[][], champion: number[][]) => {
    matrix: number[][]; expectedHomeGoals: number; expectedAwayGoals: number;
  }): HistoricalGoalPrediction[] {
  // Invalid source data must abort, never become a legitimate model fallback.
  for (const row of input) {
    if (!row.sourceEventId || !row.seasonId || !Number.isFinite(Date.parse(row.kickoff))
      || !row.homeCanonicalName || !row.awayCanonicalName || row.homeCanonicalName === row.awayCanonicalName
      || ![row.homeGoals, row.awayGoals].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 30)
      || typeof row.freshRating !== "boolean") throw new Error("Invalid historical evaluation source row");
    if (row.homeElo !== undefined || row.awayElo !== undefined || row.freshRating) {
      if (![row.homeElo, row.awayElo].every((v) => typeof v === "number" && Number.isFinite(v))
        || !row.ratingDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.ratingDate)
        || !Number.isFinite(Date.parse(`${row.ratingDate}T00:00:00Z`))
        || new Date(`${row.ratingDate}T00:00:00Z`).toISOString().slice(0, 10) !== row.ratingDate
        || row.ratingDate >= row.kickoff.slice(0, 10)) throw new Error("Invalid historical evaluation source rating");
    }
  }
  const rows = [...input].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.sourceEventId.localeCompare(b.sourceEventId));
  if (new Set(rows.map((r) => r.sourceEventId)).size !== rows.length) throw new Error("Duplicate evaluation identity");
  const targets = rows.filter((r) => r.homeElo !== undefined);
  const weeks = [...new Set(targets.map((r) => utcWeekOrigin(r.kickoff)))].sort((a, b) => a - b);
  const validation: EarlierValidation[] = [], predictions: HistoricalGoalPrediction[] = [];
  for (const week of weeks) {
    const origin = new Date(week).toISOString();
    const selection = selectGoalCandidate(validation, week);
    // Stale ratings never train allocation; their goal outcomes still train scoring style.
    const training = rows.filter((r) => Date.parse(r.kickoff) <= week - DAY).map((r) => r.freshRating ? r
      : { ...r, homeElo: undefined, awayElo: undefined, ratingDate: undefined });
    const fits = GOAL_CALIBRATION_CANDIDATES.map((option) => {
      try { return { fit: fitHistoricalGoalRates(training, origin, option), error: null }; }
      catch (error) { return { fit: null, error: error instanceof Error ? error.message : String(error) }; }
    });
    const batch = targets.filter((r) => utcWeekOrigin(r.kickoff) === week);
    for (const row of batch) {
      const [champHome, champAway] = eloToLambdas(row.homeElo!, row.awayElo!, 42);
      const championGrid = scoreMatrix(champHome, champAway, -0.1);
      const champion = scoreGoalGrid(championGrid, row);
      const outputs = fits.map(({ fit, error }) => {
        try {
          if (!fit) throw new Error(error!);
          const forecast = forecastHistoricalGoalRates(fit, row);
          return { ...forecast, ...(transform?.(forecast.matrix, championGrid) ?? {}), error: null };
        } catch (caught) {
          return { matrix: championGrid, lambdaHome: champHome, lambdaAway: champAway, rho: -0.1,
            error: caught instanceof Error ? caught.message : String(caught) };
        }
      });
      const losses = outputs.map((output) => scoreGoalGrid(output.matrix, row));
      const chosen = outputs[selection.index], fit = fits[selection.index].fit;
      const expectedHomeGoals = chosen.matrix.reduce((sum, line, home) => sum + home * line.reduce((a, b) => a + b, 0), 0);
      const expectedAwayGoals = chosen.matrix.reduce((sum, line) => sum + line.reduce((a, p, away) => a + p * away, 0), 0);
      predictions.push({ sourceEventId: row.sourceEventId, seasonId: row.seasonId, kickoff: row.kickoff, origin,
        freshRating: row.freshRating, selectedIndex: selection.index, selectionCount: selection.count,
        selectionMeans: selection.means, candidate: losses[selection.index], champion,
        candidateFallback: chosen.error, optionFallbacks: outputs.map((o) => o.error),
        lambdaHome: chosen.lambdaHome, lambdaAway: chosen.lambdaAway, rho: chosen.rho,
        pOver: matrixToTotals(chosen.matrix, 2.5)[0], pBtts: matrixToBtts(chosen.matrix)[0],
        oneXTwo: matrixTo1x2(chosen.matrix), trainingCount: fit?.trainingCount ?? 0,
        allocationTrainingCount: fit?.allocationTrainingCount ?? 0, trainingThrough: fit?.trainingThrough ?? null,
        ...(transform ? { expectedHomeGoals, expectedAwayGoals, optionEvidence: outputs.map((output, i) => ({
          loss: losses[i], lambdaHome: output.lambdaHome, lambdaAway: output.lambdaAway, rho: output.rho,
          trainingSha256: fits[i].fit?.trainingSha256 ?? null,
          gradientNorm: fits[i].fit?.gradientNorm ?? null, error: output.error })) } : {}) });
      validation.push({ kickoff: row.kickoff, freshRating: row.freshRating, losses });
    }
    onWeek?.(origin, batch.length);
  }
  return predictions;
}

export function summarizeGoalPredictions(rows: readonly HistoricalGoalPrediction[]) {
  if (!rows.length) throw new Error("Empty evaluation denominator");
  const groups = new Map<number, HistoricalGoalPrediction[]>();
  for (const row of rows) {
    const key = utcWeekOrigin(row.kickoff);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const blocks = [...groups.values()];
  let seed = 20261007 >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = Object.fromEntries(GOAL_METRICS.map((metric) => [metric, [] as number[]])) as Record<typeof GOAL_METRICS[number], number[]>;
  for (let iteration = 0; iteration < 10000; iteration += 1) {
    let denominator = 0;
    const sums = Object.fromEntries(GOAL_METRICS.map((metric) => [metric, 0])) as Record<typeof GOAL_METRICS[number], number>;
    for (let b = 0; b < blocks.length; b += 1) {
      const block = blocks[Math.floor(random() * blocks.length)];
      denominator += block.length;
      for (const row of block) for (const metric of GOAL_METRICS) sums[metric] += row.candidate[metric] - row.champion[metric];
    }
    for (const metric of GOAL_METRICS) samples[metric].push(sums[metric] / denominator);
  }
  const metrics = Object.fromEntries(GOAL_METRICS.map((metric) => {
    const sorted = samples[metric].sort((a, b) => a - b);
    const champion = rows.reduce((sum, r) => sum + r.champion[metric], 0) / rows.length;
    const candidate = rows.reduce((sum, r) => sum + r.candidate[metric], 0) / rows.length;
    return [metric, { champion, candidate, delta: candidate - champion,
      interval95: [sorted[249], sorted[9749]] }];
  }));
  return { count: rows.length, utcWeeks: blocks.length, fallbacks: rows.filter((r) => r.candidateFallback).length,
    candidateSelections: GOAL_CALIBRATION_CANDIDATES.map((_, i) => rows.filter((r) => r.selectedIndex === i).length), metrics };
}
