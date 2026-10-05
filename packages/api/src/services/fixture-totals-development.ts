import { assertGloballyFeasibleTrainingRows, fitGloballyFeasibleDixonColes, forecastGloballyFeasibleDixonColes,
  type FittedDixonColesTrainingRow } from "./dixon-coles-mle";

/** Exposed-data development only. No production selector or artifact writer. */
export const FIXTURE_TOTALS_DEVELOPMENT_OPTIONS = [
  { timeDecayXi: 0.002, clubEloPriorStrength: 8 },
  { timeDecayXi: 0.002, clubEloPriorStrength: 24 },
  { timeDecayXi: 0.0065, clubEloPriorStrength: 8 },
  { timeDecayXi: 0.0065, clubEloPriorStrength: 24 },
] as const;
export const FIXTURE_TOTALS_UNSELECTED_DEFAULT = { timeDecayXi: 0.0065, clubEloPriorStrength: 8 } as const;
const DAY = 86_400_000;

export function selectFixtureTotalsOptions(
  rows: readonly FittedDixonColesTrainingRow[],
  selectionAt: string
) {
  assertGloballyFeasibleTrainingRows(rows);
  const cutoff = Date.parse(selectionAt) - DAY;
  if (!Number.isFinite(cutoff) || rows.some((row) => !Number.isFinite(Date.parse(row.kickoff))
    || Date.parse(row.kickoff) > cutoff)) throw new Error("Selection input contains unavailable or future results.");
  const folds = [3, 2, 1].map((block) => {
    const origin = Date.parse(selectionAt) - block * 28 * DAY;
    return { origin: new Date(origin).toISOString(),
      train: rows.filter((row) => Date.parse(row.kickoff) <= origin - DAY),
      validation: rows.filter((row) => Date.parse(row.kickoff) >= origin
        && Date.parse(row.kickoff) < Math.min(origin + 28 * DAY, cutoff)) };
  }).filter((fold) => fold.train.length >= 40 && fold.validation.length > 0);
  const foldBindings = folds.map((fold) => ({ origin: fold.origin,
    trainEventIds: fold.train.map((row) => row.sourceEventId),
    validationEventIds: fold.validation.map((row) => row.sourceEventId) }));
  const attempts = FIXTURE_TOTALS_DEVELOPMENT_OPTIONS.map((options) => {
    let totalLoss = 0, accepted = 0, rejected = 0;
    const results = folds.map((fold) => {
      const fit = fitGloballyFeasibleDixonColes(fold.train, { ...options, maxIterations: 1000 });
      let foldLoss = 0, valid = 0, invalid = 0;
      for (const row of fold.validation) {
        const forecast = forecastGloballyFeasibleDixonColes(fit, row.homeCanonicalName, row.awayCanonicalName,
          { meanElo: fit.meanElo, homeElo: row.homeElo, awayElo: row.awayElo });
        if (!forecast) { invalid += 1; continue; }
        const result = row.homeGoals > row.awayGoals ? "home" : row.homeGoals < row.awayGoals ? "away" : "draw";
        const brier = (forecast.pHome - Number(result === "home")) ** 2
          + (forecast.pDraw - Number(result === "draw")) ** 2 + (forecast.pAway - Number(result === "away")) ** 2;
        foldLoss += (brier / 2 + (forecast.pOver2_5 - Number(row.homeGoals + row.awayGoals > 2.5)) ** 2
          + (forecast.pBttsYes - Number(row.homeGoals > 0 && row.awayGoals > 0)) ** 2) / 3;
        valid += 1;
      }
      totalLoss += foldLoss; accepted += valid; rejected += invalid;
      return { origin: fold.origin, trainN: fold.train.length, validationN: fold.validation.length,
        accepted: valid, rejected: invalid, converged: fit.converged, diagnostics: fit.diagnostics,
        meanSelectionLoss: valid ? foldLoss / valid : null };
    });
    return { options, accepted, rejected, eligible: folds.length > 0 && rejected === 0 && accepted > 0,
      meanSelectionLoss: accepted > 0 && rejected === 0 ? totalLoss / accepted : null, folds: results };
  });
  const eligible = attempts.filter((attempt) => attempt.eligible)
    .sort((a, b) => a.meanSelectionLoss! - b.meanSelectionLoss!);
  return { options: eligible[0]?.options ?? FIXTURE_TOTALS_UNSELECTED_DEFAULT,
    reason: eligible.length ? "inner-chronological-selection" : folds.length ? "no-eligible-inner-option" : "insufficient-inner-history",
    selected: eligible.length > 0, productionEligible: false as const, exposedDevelopment: true as const,
    selectionAt, resultAvailableThrough: new Date(cutoff).toISOString(), folds: foldBindings, attempts };
}
