import type { Grounding, MarketDivergence } from "./ask";

export function joinBasicsAnswer(parts: {
  headline: string;
  supports?: string[];
  lean: string;
  provenance: string;
  responsibleGambling?: boolean;
}): string {
  const blocks = [
    parts.headline.trim(),
    ...(parts.supports ?? []).map((line) => line.trim()).filter(Boolean),
    parts.lean.trim(),
    parts.provenance.trim(),
  ];
  if (parts.responsibleGambling) {
    blocks.push("Gamble responsibly, 18+.");
  }
  return blocks.join("\n");
}

export function basicsProvenanceLine(
  grounding: Grounding,
  market?: { source: string; observedAt: string },
): string {
  const modelId = grounding.pricing.modelVersion;
  const modelAsOf = formatBasicsDate(grounding.pricing.pricedAt);
  const marketPart = market
    ? `${market.source[0].toUpperCase() + market.source.slice(1)} as of ${formatBasicsDate(market.observedAt)}; `
    : "";
  const feeds = grounding.oddsSources
    .filter((row) => row.pDraw !== null)
    .map((row) => `${row.source[0].toUpperCase() + row.source.slice(1)} ${formatBasicsDate(row.observedAt)}`)
    .join(", ");
  const marketFeeds = feeds && !market ? `${feeds}; ` : marketPart;
  return `Provenance: Fundamental ${modelId}, model priced ${modelAsOf}; ${marketFeeds}`.replace(/;\s*$/, "").trim();
}

export function formatBasicsDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function basicsFavouriteLean(grounding: Grounding): string {
  const sides = [
    { label: grounding.home, p: grounding.pHome },
    { label: "the draw", p: grounding.pDraw },
    { label: grounding.away, p: grounding.pAway },
  ].sort((a, b) => b.p - a.p)[0];
  const pct = (sides.p * 100).toFixed(1);
  return `Lean: ${sides.label} at ${pct}% on my Fundamental 1X2 — a probability, not a pick to place.`;
}

export function basicsLargestGapLean(divergence: MarketDivergence, sourceLabel: string): string {
  const leg = divergence.largest;
  const sign = leg.gapPoints >= 0 ? "+" : "";
  const magnitude = Math.abs(leg.gapPoints).toFixed(1);
  const direction = leg.gapPoints >= 0 ? "above" : "below";
  return `Lean: I am ${magnitude} pts ${direction} ${sourceLabel} on ${leg.label} (gap ${sign}${leg.gapPoints.toFixed(1)} pts).`;
}

export const PARLAY_OUT_OF_SCOPE =
  "Parlays are outside what I answer on this desk right now; ask for a single-fixture 1X2, totals, or BTTS read instead.";
