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

const TABLE_VS_MODEL_MIN_FAV_P = 0.55;
const TABLE_VS_MODEL_MIN_POSITION_GAP = 6;
const TABLE_VS_MODEL_MIN_ELO_GAP = 25;

function ordinalPosition(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  switch (position % 10) {
    case 1: return `${position}st`;
    case 2: return `${position}nd`;
    case 3: return `${position}rd`;
    default: return `${position}th`;
  }
}

function marketImpliedForSide(grounding: Grounding, side: "home" | "away"): number | null {
  const row = grounding.oddsSources.find((source) =>
    source.pDraw !== null
    && Number.isFinite(source.pHome)
    && Number.isFinite(source.pAway)
  );
  if (!row) return null;
  const p = side === "home" ? row.pHome : row.pAway;
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}

/**
 * One-line table-vs-strength explainer when league position looks wrong for the model favourite.
 * Built only from grounding table rows, Elo, HFA flag, and complete external 1X2 when present.
 */
export function tableVsModelFavoriteExplainLine(grounding: Grounding): string | null {
  let side: "home" | "away";
  let modelP: number;
  if (grounding.pHome >= grounding.pDraw && grounding.pHome >= grounding.pAway) {
    if (grounding.pHome < TABLE_VS_MODEL_MIN_FAV_P) return null;
    side = "home";
    modelP = grounding.pHome;
  } else if (grounding.pAway >= grounding.pDraw && grounding.pAway > grounding.pHome) {
    if (grounding.pAway < TABLE_VS_MODEL_MIN_FAV_P) return null;
    side = "away";
    modelP = grounding.pAway;
  } else {
    return null;
  }

  const favTable = side === "home" ? grounding.homeTable : grounding.awayTable;
  const oppTable = side === "home" ? grounding.awayTable : grounding.homeTable;
  if (favTable.position == null || favTable.points == null || oppTable.position == null) return null;
  if (favTable.position <= oppTable.position) return null;
  if (favTable.position - oppTable.position < TABLE_VS_MODEL_MIN_POSITION_GAP) return null;

  const favElo = side === "home" ? grounding.homeElo : grounding.awayElo;
  const oppElo = side === "home" ? grounding.awayElo : grounding.homeElo;
  if (!Number.isFinite(favElo) || !Number.isFinite(oppElo) || favElo - oppElo < TABLE_VS_MODEL_MIN_ELO_GAP) {
    return null;
  }

  const tablePhrase = `${ordinalPosition(favTable.position)} on ${favTable.points} pts`;
  const eloPhrase = `rated stronger on Elo (${Math.round(favElo)} v ${Math.round(oppElo)})`;
  const hfaPhrase = side === "home" && grounding.homeFieldAdvantage
    ? " plus home advantage"
    : "";

  const marketP = marketImpliedForSide(grounding, side);
  const marketHigher = marketP != null && marketP > modelP + 0.005;
  const marketClause = marketHigher
    ? `; the market is higher still at ~${(marketP * 100).toFixed(0)}%`
    : "";

  return `${tablePhrase}, but ${eloPhrase}${hfaPhrase}${marketClause}.`;
}

export function appendTableVsFavoriteExplain(grounding: Grounding, answer: string): string {
  const line = tableVsModelFavoriteExplainLine(grounding);
  return line ? `${answer.trim()}\n${line}` : answer;
}
