/**
 * Plain-words strength for the desk side panel.
 * Gap under 1 (the same displayed rating) is evenly matched.
 * Gap under 50 is slightly stronger. A wider gap is stronger.
 */
export function ratingComparison(
  home: string,
  away: string,
  homeRating: number,
  awayRating: number,
): string {
  if (!Number.isFinite(homeRating) || !Number.isFinite(awayRating)) return "";
  const gap = Math.abs(homeRating - awayRating);
  if (gap < 1) return `${home} and ${away} are evenly matched.`;
  const stronger = homeRating > awayRating ? home : away;
  if (gap < 50) return `${stronger} rate slightly stronger.`;
  return `${stronger} rate stronger.`;
}
