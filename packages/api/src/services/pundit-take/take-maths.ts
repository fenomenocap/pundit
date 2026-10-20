/** Fair decimal from raw model probability (no desk rounding on p). */
export function fairDecimalFromRawProb(probability: number): string {
  if (!Number.isFinite(probability) || probability <= 0) return "—";
  return (1 / probability).toFixed(2);
}

export function modelGapPointsVsBestDecimal(modelP: number, bestDecimal: string | null): number | null {
  if (!bestDecimal) return null;
  const best = Number.parseFloat(bestDecimal);
  if (!Number.isFinite(best) || best <= 0) return null;
  return (modelP - 1 / best) * 100;
}
