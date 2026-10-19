import type { Grounding, MarketDivergence } from "./ask";
import type { OneXTwoOutcome } from "./response-correctness";

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

/** One-decimal percent and 2dp fair from the same rounded probability. */
export function deskRoundProbability(probability: number): number {
  return Math.round(probability * 1000) / 1000;
}

export function deskPercentDisplay(probability: number): string {
  const rounded = deskRoundProbability(probability);
  return `${(rounded * 100).toFixed(1)}%`;
}

export function deskFairFromProb(probability: number): string {
  const rounded = deskRoundProbability(probability);
  return (1 / rounded).toFixed(2);
}

export function deskProbabilityDisplay(probability: number): {
  displayPct: string;
  fairDecimal: string;
} {
  return {
    displayPct: deskPercentDisplay(probability),
    fairDecimal: deskFairFromProb(probability),
  };
}

export function formatTimestampSgt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${day} ${month} ${hour}:${minute} SGT`;
}

function capitalizeSource(source: string): string {
  if (source === "kalshi") return "Kalshi";
  if (source === "polymarket") return "Polymarket";
  if (source === "stake") return "Stake";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

/** Public desk label — avoids banned engine tokens in user-facing copy. */
export function shortModelVersionLabel(modelVersion: string): string {
  const match = /^([^@]+)@(\d+):(.+)$/.exec(modelVersion.trim());
  if (!match) return modelVersion;
  const [, family, version, tail] = match;
  const shortHash = tail.length > 12 ? tail.slice(0, 7) : tail;
  if (family === "clubelo") return `Elo ratings v${version} (${shortHash})`;
  if (family === "fundamental") return `Fundamental v${version} (${shortHash})`;
  return `${family} v${version} (${shortHash})`;
}

export function deskProvenanceLine(
  grounding: Grounding,
  market?: { source: string; observedAt: string },
): string {
  const modelLabel = shortModelVersionLabel(grounding.pricing.modelVersion);
  const modelTime = formatTimestampSgt(grounding.pricing.pricedAt);
  const feedSources = new Set(
    grounding.oddsSources
      .filter((row) => row.pDraw !== null)
      .map((row) => row.source),
  );
  if (market) feedSources.add(market.source);
  const oddsNames = [...feedSources].map(capitalizeSource).join("/") || "none";
  const oddsIso = market?.observedAt
    ?? grounding.freshness.marketOddsLastUpdated
    ?? grounding.pricing.pricedAt;
  const oddsTime = formatTimestampSgt(oddsIso);
  return `Model: ${modelLabel}, ${modelTime} · Odds: ${oddsNames} no-vig, ${oddsTime}`;
}

/** @deprecated use deskProvenanceLine */
export function basicsProvenanceLine(
  grounding: Grounding,
  market?: { source: string; observedAt: string },
): string {
  return deskProvenanceLine(grounding, market);
}

export function formatBasicsDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function displayOutcomeLabel(grounding: Grounding, outcome: OneXTwoOutcome): string {
  if (outcome === "draw") return "Draw";
  if (outcome === "home") return compactTeamLabel(grounding.home);
  return compactTeamLabel(grounding.away);
}

export function compactTeamLabel(name: string): string {
  if (name === "Tottenham") return "Spurs";
  return name;
}

export function formatCompact1x2SideRow(params: {
  label: string;
  modelP: number;
  marketDecimal: number | null;
  marketP: number;
  gapPoints: number;
  sourceLabel: string;
  beforeFees?: boolean;
}): string {
  const { displayPct, fairDecimal } = deskProbabilityDisplay(params.modelP);
  const marketPct = deskPercentDisplay(params.marketP);
  const marketDec = params.marketDecimal != null
    ? params.marketDecimal.toFixed(2)
    : deskFairFromProb(params.marketP);
  const fees = params.beforeFees ? " (before fees)" : "";
  const gapSign = params.gapPoints >= 0 ? "+" : "";
  return `${params.label}  ${displayPct} | fair ${fairDecimal} | ${params.sourceLabel} ${marketDec} (${marketPct})${fees} | gap ${gapSign}${params.gapPoints.toFixed(1)} pts`;
}

export function selectValueLeg(legs: MarketDivergence["legs"]): MarketDivergence["legs"][number] {
  const positive = legs.filter((leg) => leg.gapPoints > 0.05);
  if (positive.length) {
    return positive.sort((a, b) => b.gapPoints - a.gapPoints)[0];
  }
  return [...legs].sort((a, b) => Math.abs(b.gapPoints) - Math.abs(a.gapPoints))[0];
}

export function formatValueCallHeadline(
  grounding: Grounding,
  leg: MarketDivergence["legs"][number],
  sourceLabel: string,
): string {
  const label = displayOutcomeLabel(grounding, leg.outcome);
  const modelPct = deskPercentDisplay(leg.modelPercent / 100);
  const marketPct = deskPercentDisplay(leg.marketPercent / 100);
  if (leg.gapPoints > 0.05) {
    return `${label} is the value: I make it ${modelPct}, ${sourceLabel} ${marketPct}.`;
  }
  if (leg.gapPoints < -0.05) {
    return `${label} looks rich on ${sourceLabel}: I make it ${modelPct}, ${sourceLabel} ${marketPct}.`;
  }
  return `${label} is aligned: I make it ${modelPct}, ${sourceLabel} ${marketPct}.`;
}

export function formatMarketGapLean(
  grounding: Grounding,
  leg: MarketDivergence["legs"][number],
  sourceLabel: string,
): string {
  const label = displayOutcomeLabel(grounding, leg.outcome);
  const sign = leg.gapPoints >= 0 ? "+" : "";
  return `Lean: ${label}, ${sign}${leg.gapPoints.toFixed(1)} pts vs ${sourceLabel}.`;
}

export function formatUserLineLean(
  grounding: Grounding,
  outcome: OneXTwoOutcome,
  decimalOdds: number,
  gapPoints: number,
  decision: "play" | "pass" | "abstain",
): string {
  const label = displayOutcomeLabel(grounding, outcome);
  const dec = decimalOdds.toFixed(2);
  const sign = gapPoints >= 0 ? "+" : "";
  if (decision === "pass") {
    return `Lean: I pass on ${label} at ${dec} — gap ${sign}${Math.abs(gapPoints).toFixed(1)} pts vs my price.`;
  }
  if (decision === "abstain") {
    return `Lean: I will not call ${label} at ${dec} — line sits in the abstain band.`;
  }
  const size = Math.abs(gapPoints) >= 15 ? "strong play" : Math.abs(gapPoints) >= 5 ? "play" : "small play";
  return `Lean: ${label} at ${dec}, ${size} — I play, gap ${sign}${Math.abs(gapPoints).toFixed(1)} pts over my price.`;
}

export function basicsFavouriteLean(grounding: Grounding): string {
  const sides = [
    { label: displayOutcomeLabel(grounding, "home"), p: grounding.pHome },
    { label: "Draw", p: grounding.pDraw },
    { label: displayOutcomeLabel(grounding, "away"), p: grounding.pAway },
  ].sort((a, b) => b.p - a.p)[0];
  return `Lean: ${sides.label} at ${deskPercentDisplay(sides.p)} is my strongest 1X2 read.`;
}

export function basicsLargestGapLean(
  grounding: Grounding,
  divergence: MarketDivergence,
  sourceLabel: string,
): string {
  return formatMarketGapLean(grounding, divergence.largest, sourceLabel);
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

  const favLabel = side === "home" ? compactTeamLabel(grounding.home) : compactTeamLabel(grounding.away);
  const tablePhrase = `${favLabel} ${ordinalPosition(favTable.position)} on ${favTable.points} pts`;
  const eloPhrase = `Elo still favours them (${Math.round(favElo)} v ${Math.round(oppElo)})`;
  const hfaPhrase = side === "home" && grounding.homeFieldAdvantage ? " with home advantage" : "";

  const marketP = marketImpliedForSide(grounding, side);
  const marketHigher = marketP != null && marketP > modelP + 0.005;
  const marketClause = marketHigher
    ? `; ${capitalizeSource(grounding.oddsSources[0]?.source ?? "Market")} is higher at ${deskPercentDisplay(marketP)}`
    : "";

  return `Caveat: ${tablePhrase}, but ${eloPhrase}${hfaPhrase}${marketClause}.`;
}

export function appendTableVsFavoriteExplain(grounding: Grounding, answer: string): string {
  const line = tableVsModelFavoriteExplainLine(grounding);
  return line ? `${answer.trim()}\n${line}` : answer;
}
