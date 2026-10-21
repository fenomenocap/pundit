import { MODEL_EDGE_CLAIMS_ALLOWED } from "../config/backtest-gate";
import type { Grounding } from "./ask";
import { sanitizeDeskFootballHypotheses, composeDeskFootballTake } from "./desk-voice";
import { PUNDIT_CONSENSUS_LABEL, PUNDIT_FUNDAMENTAL_LABEL } from "./pundit-consensus";
import type { OneXTwoOutcome } from "./response-correctness";
import { parseScoreline, resolveUserLineDecision, userLineGapPoints } from "./response-correctness";

const ONE_X_TWO_OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];
import {
  PLAYER_SCORER_ABSTENTION,
  TEAM_NEWS_COMPOSE_ABSTENTION,
  hasTeamNewsEvidence,
  hasTrustworthyPlayerEvidence,
  leadingScorerCandidate,
  playerCapabilities,
  type PlayerEvidenceBundle,
} from "./player-evidence";
import { buildResponseFacts, factById } from "./response-facts";
import {
  asksOver25Only,
  asksScorelineBoard,
  asksTacticalTake,
  asksUnder25Only,
  asksUnpricedMarket,
  asksParlayQuestion,
  mentionsBankroll,
  BANKROLL_UNIT_GUIDANCE,
  planResponse,
  pricedGridMarketsAsked,
  resolveRequestedScoreline,
  type ResponsePlan,
} from "./response-plan";
import {
  deskFairFromProb,
  deskPercentDisplay,
  deskProbabilityDisplay,
  displayOutcomeLabel,
  composeIndependentMarketTakeAnswer,
  formatBttsSideRow,
  formatCompact1x2SideRow,
  formatMarketActionLean,
  composeWhyAfterPricedTurn,
  compactTeamLabel,
  formatModelOnlySideRows,
  formatTotalsSideRow,
  formatUserLineLean,
  formatUserLineSideRow,
  appendTableVsFavoriteExplain,
  joinBasicsAnswer,
  modelFavouriteOutcome,
  PARLAY_OUT_OF_SCOPE,
  selectValueLeg,
  tableVsModelFavoriteExplainLine,
} from "./basics-answer-voice";
import { largestSlateModelMarketGapForDemo, type SlateGapHighlight } from "./slate-market-scan";
import {
  consumePrefetchedTakeDelivery,
  punditTakeV2Active,
  stashPunditTakeDelivery,
  stashTakeDossier,
} from "./pundit-take/flags";
import { composePunditTakeDelivery } from "./pundit-take/compose";
import { prefetchStoredTakeDossier } from "./pundit-take/take-dossier";
import { buildPunditTakePlan } from "./pundit-take/take-plan";
import { formatTakeOddsTable } from "./pundit-take/take-table";
import {
  buildTakeSourcesFooter,
  formatTakeSourcesFooterBlock,
} from "./pundit-take/take-sources";

/** A briefing includes football and deciding roles, not just the numeric board. */
export function asksCompleteMatchBriefing(question: string): boolean {
  return /\bbriefing\b/i.test(question)
    || (/\bpreview\b/i.test(question)
      && /\btactics?\b|\btactical\b/i.test(question)
      && /\bwho decides\b|\b(?:deciding|key) roles\b/i.test(question));
}

function composeBriefingFootball(grounding: Grounding): string {
  const tactics = composeDeskFootballTake(grounding);
  const roles = "I’d watch the receiver beyond the first press, the screening midfielder covering for an advancing full-back, and the striker attacking a cut-back. If the receiver can turn, they could connect the attack; if the screening midfielder is pulled towards the ball, a runner could exploit the space behind; if the striker times the run, they could reach the delivery before a defender. Those are roles to watch, not a claim about confirmed starters or a player scoring forecast.";
  return `${tactics}\n\n${roles}`;
}

import {
  CALIBRATED_GOALS_SENTENCE,
  SHARED_TOTAL_XG_SENTENCE,
  totalsAssumptionSentence,
} from "./totals-assumption";

export {
  CALIBRATED_GOALS_SENTENCE,
  SHARED_TOTAL_XG_SENTENCE,
  totalsAssumptionSentence,
} from "./totals-assumption";

function biggestMarketGapLine(grounding: Grounding): string | null {
  const divergence = grounding.marketDivergence[0];
  if (!divergence) return null;
  const valueLeg = selectValueLeg(divergence.legs);
  const gapLabel = displayOutcomeLabel(grounding, valueLeg.outcome);
  const sign = valueLeg.gapPoints >= 0 ? "+" : "";
  return `Biggest gap vs market: ${gapLabel}, ${sign}${valueLeg.gapPoints.toFixed(1)} pts.`;
}

function composeMatchPreviewOddsTable(grounding: Grounding): string {
  const planJson = buildPunditTakePlan(grounding, null, { marketKind: "1x2" });
  return formatTakeOddsTable(planJson);
}

function composeMatchPreviewSourcesFooter(grounding: Grounding): string {
  const sources = buildTakeSourcesFooter(grounding, null, Date.now());
  return formatTakeSourcesFooterBlock(sources, { includeOdds: true });
}

export const STAKE_REFUSAL_SENTENCE =
  "I can print the price. I will not size a stake without a bankroll and a risk band.";

function outcomeLabel(grounding: Grounding, outcome: "home" | "draw" | "away"): string {
  return outcome === "draw" ? "the draw" : grounding[outcome];
}

function signedEvPct(evPct: number): string {
  const pct = evPct * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fairDecimal(probability: number): string {
  return deskFairFromProb(probability);
}

function formatScorelineList(
  rows: Array<{ score: string; probability: number }>
): string {
  const items = rows.map((row) =>
    `${row.score} at ${pct(row.probability)} (fair ${fairDecimal(row.probability)})`
  );
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function leadingScorelines(
  question: string,
  grounding: Grounding
): { rows: Array<{ score: string; probability: number }>; overFiltered: boolean } {
  const top = grounding.topScores;
  if (asksOver25Only(question)) {
    const over = top.filter((row) => {
      const parsed = parseScoreline(row.score);
      return parsed != null && parsed.home + parsed.away >= 3;
    });
    if (over.length) return { rows: over, overFiltered: true };
  }
  return { rows: top, overFiltered: false };
}

function composeScorelineBoard(question: string, grounding: Grounding): string {
  const { rows, overFiltered } = leadingScorelines(question, grounding);
  if (!rows.length) {
    return "I don’t have a publishable scoreline board for this fixture, so I can’t list likely scores without inventing them.";
  }
  const listed = formatScorelineList(rows);
  const noun = rows.length === 1 ? "scoreline" : "scorelines";
  return overFiltered
    ? `I make the leading over 2.5 ${noun} ${listed}.`
    : `I make the leading ${noun} ${listed}.`;
}

function composeTotalsLead(question: string, grounding: Grounding): string {
  const includeFair = asksScorelineBoard(question) || /\bodds?\b/i.test(question);
  const over = includeFair
    ? `${pct(grounding.pOver2_5)} (fair ${fairDecimal(grounding.pOver2_5)})`
    : pct(grounding.pOver2_5);
  const under = includeFair
    ? `${pct(grounding.pUnder2_5)} (fair ${fairDecimal(grounding.pUnder2_5)})`
    : pct(grounding.pUnder2_5);
  const lead = asksUnder25Only(question)
    ? `I have under 2.5 at ${under}; over 2.5 is ${over}.`
    : `I have over 2.5 at ${over}; under 2.5 is ${under}.`;
  const complement = /\b(?:sum|add|complementary|complement)\b/i.test(question)
    ? " Under covers fewer than three goals; over covers three or more. There is no push at a half-goal line, so their probabilities sum to one. Decimal odds are the reciprocals of those probabilities."
    : "";
  return `${lead}${complement} ${totalsAssumptionSentence(grounding)}`;
}

const NO_BTTS_MARKET_LINE =
  "I don't have a live BTTS market line on this fixture — these are our BTTS numbers only.";

const TOTALS_COIN_FLIP_GAP = 0.05;

function totalsCallHeadline(question: string, grounding: Grounding): string {
  const fixture = `${grounding.home} v ${grounding.away}`;
  const prefix = asksUnder25Only(question)
    ? `Under/over 2.5 on ${fixture}`
    : `Over/under 2.5 on ${fixture}`;
  const over = grounding.pOver2_5;
  const under = grounding.pUnder2_5;
  const pickOver = over >= under;
  const callLabel = pickOver ? "over 2.5" : "under 2.5";
  const callP = pickOver ? over : under;
  let headline = `${prefix} — I have ${callLabel} at ${pct(callP)}.`;
  if (Math.abs(over - under) <= TOTALS_COIN_FLIP_GAP) {
    headline += " Both sides sit within five points, so I'd treat the line as a coin flip.";
  }
  return headline;
}

function bttsCallHeadline(grounding: Grounding): string {
  const fixture = `${grounding.home} v ${grounding.away}`;
  const yes = grounding.pBttsYes;
  const no = grounding.pBttsNo;
  const pickYes = yes >= no;
  const callLabel = pickYes ? "BTTS yes" : "BTTS no";
  const callP = pickYes ? yes : no;
  let headline = `Both teams to score on ${fixture} — I have ${callLabel} at ${pct(callP)}.`;
  if (Math.abs(yes - no) <= TOTALS_COIN_FLIP_GAP) {
    headline += " Both sides sit within five points, so I'd treat it as a coin flip.";
  }
  return headline;
}

import { asksMarketGapFocusQuestion, composeMarketGapFocusAnswer } from "./market-gap-focus";

export { asksMarketGapFocusQuestion, composeMarketGapFocusAnswer } from "./market-gap-focus";

function composeBttsBasics(_question: string, grounding: Grounding): string {
  const headline = bttsCallHeadline(grounding);
  return joinBasicsAnswer({
    headline,
    supports: [
      formatBttsSideRow("BTTS yes", grounding.pBttsYes),
      formatBttsSideRow("BTTS no", grounding.pBttsNo),
      NO_BTTS_MARKET_LINE,
      totalsAssumptionSentence(grounding),
    ],
  });
}

function composeTotalsBasics(question: string, grounding: Grounding): string {
  const headline = totalsCallHeadline(question, grounding);
  const complement = /\b(?:sum|add|complementary|complement)\b/i.test(question)
    ? "Under covers fewer than three goals; over covers three or more. There is no push at a half-goal line, so their probabilities sum to one. Decimal odds are the reciprocals of those probabilities."
    : undefined;
  return joinBasicsAnswer({
    headline,
    supports: [
      formatTotalsSideRow("Over 2.5", grounding.pOver2_5),
      formatTotalsSideRow("Under 2.5", grounding.pUnder2_5),
      "I don't have a live over/under 2.5 market line on this fixture — these are our totals numbers only.",
      complement,
      totalsAssumptionSentence(grounding),
    ].filter(Boolean) as string[],
  });
}

function slateGapRowLabel(highlight: SlateGapHighlight): string {
  if (highlight.outcome === "draw") return "Draw";
  const [home, away] = highlight.fixtureLabel.split(" v ");
  if (highlight.outcome === "home") return compactTeamLabel(home ?? highlight.label);
  return compactTeamLabel(away ?? highlight.label);
}

function composePricedGridAnswer(question: string, grounding: Grounding): string {
  const asked = pricedGridMarketsAsked(question);
  if (asked.length === 1 && asked[0] === "btts") return composeBttsBasics(question, grounding);
  if (asked.length === 1 && asked[0] === "totals") return composeTotalsBasics(question, grounding);
  const parts: string[] = [];
  if (asked.includes("1x2")) {
    parts.push(
      `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`
    );
  }
  if (asked.includes("totals")) parts.push(composeTotalsLead(question, grounding));
  if (asked.includes("btts")) parts.push(composeBttsBasics(question, grounding));
  if (asked.includes("scorelines")) parts.push(composeScorelineBoard(question, grounding));
  return parts.join("\n");
}

function fattestCapturedEv(grounding: Grounding): {
  source: string;
  outcome: OneXTwoOutcome;
  decimalOdds: number;
  evPct: number;
  edgeBand: string | null;
} | null {
  let best: {
    source: string;
    outcome: OneXTwoOutcome;
    decimalOdds: number;
    evPct: number;
    edgeBand: string | null;
  } | null = null;
  for (const market of grounding.pricing.markets) {
    for (const outcome of ["home", "draw", "away"] as const) {
      const leg = market.legs[outcome];
      if (leg.decimalOdds == null || leg.evPct == null) continue;
      if (!best || Math.abs(leg.evPct) > Math.abs(best.evPct)) {
        best = {
          source: market.source,
          outcome,
          decimalOdds: leg.decimalOdds,
          evPct: leg.evPct,
          edgeBand: market.edgeBand,
        };
      }
    }
  }
  return best;
}

const TYPED_DECIMAL_PRICE = /\b(?:odds|price|line|at|@)\s*(?:of\s*)?(\d{1,2}\.\d{1,2})\b/i;

function composePricingDeskAnswer(grounding: Grounding, question = ""): string {
  const model = grounding.pricing.model;
  const oneXTwo = `My 1X2 is ${grounding.home} ${pct(model.home.p)} (fair ${model.home.fairOdds.toFixed(2)}), `
    + `draw ${pct(model.draw.p)} (fair ${model.draw.fairOdds.toFixed(2)}) and `
    + `${grounding.away} ${pct(model.away.p)} (fair ${model.away.fairOdds.toFixed(2)}).`;
  if (grounding.pricing.userLine) {
    return appendTableVsFavoriteExplain(grounding, `${oneXTwo} ${composeUserLineAnswer(grounding)}`);
  }
  const captured = fattestCapturedEv(grounding);
  if (captured) {
    const subject = outcomeLabel(grounding, captured.outcome);
    const band = captured.edgeBand ? ` (${explainEdgeBand(captured.edgeBand)})` : "";
    const gapLine = MODEL_EDGE_CLAIMS_ALLOWED
      ? `EV is ${signedEvPct(captured.evPct)}${band}.`
      : `Our read vs that captured market price is ${signedEvPct(captured.evPct)} on probability${band}.`;
    return appendTableVsFavoriteExplain(
      grounding,
      `${oneXTwo} Against a captured market decimal of ${captured.decimalOdds.toFixed(2)} on ${subject}, ${gapLine}`,
    );
  }
  if (TYPED_DECIMAL_PRICE.test(question)) {
    return appendTableVsFavoriteExplain(
      grounding,
      `${oneXTwo} I only price a line you enter in the line field, not one typed into the question, so add it there and I will print EV% and pass or play.`,
    );
  }
  return appendTableVsFavoriteExplain(
    grounding,
    `${oneXTwo} I need a captured decimal line before I can print EV% or pass or play.`,
  );
}

function explainEdgeBand(band: string): string {
  const explanations: Record<string, string> = {
    noise: "a negligible estimated price gap",
    thin: "a small estimated price gap that forecast error could erase",
    real: "a material estimated price gap, still dependent on forecast accuracy",
    "fat-and-fragile": "a large estimated price gap that is sensitive to forecast error",
  };
  return `${band}: ${explanations[band] ?? "an estimated price gap"}`;
}

export function composeUserLineAnswer(grounding: Grounding): string {
  const line = grounding.pricing.userLine;
  if (!line) {
    return joinBasicsAnswer({
      headline: "I need a decimal line on home, draw, or away before I can compare it to our numbers.",
      lean: "Lean: add the line in the price field or name home, draw, or away with a decimal in your question.",
    });
  }
  const label = displayOutcomeLabel(grounding, line.outcome);
  const modelP = grounding.pricing.model[line.outcome].p;
  const impliedP = 1 / line.decimalOdds;
  const gapPoints = userLineGapPoints(modelP, line.decimalOdds);
  const decimal = line.decimalOdds.toFixed(2);
  const decision = resolveUserLineDecision(line, gapPoints);
  const impliedPct = deskPercentDisplay(impliedP);
  return joinBasicsAnswer({
    headline: `${label} at ${decimal} implies ${impliedPct} (1/${decimal}).`,
    supports: [formatUserLineSideRow(grounding, line.outcome, line.decimalOdds, gapPoints)],
    lean: formatUserLineLean(grounding, line.outcome, line.decimalOdds, gapPoints, decision),
  });
}

function pct(value: number): string {
  return deskPercentDisplay(value);
}

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function hasCompleteOneXTwo(grounding: Grounding): boolean {
  return grounding.oddsSources.some((row) =>
    row.pDraw !== null
    && Number.isFinite(row.pHome)
    && Number.isFinite(row.pDraw)
    && Number.isFinite(row.pAway)
    && Number.isFinite(Date.parse(row.observedAt))
  );
}

function revisitAfterNews(grounding: Grounding): string {
  const news = hasCompleteOneXTwo(grounding)
    ? "verified team news or a materially different market line"
    : "verified team news";
  return `I would revisit the read only after ${news}; I can’t assign a lineup effect from these facts alone.`;
}

function outcomeLabelForComparison(grounding: Grounding, outcome: OneXTwoOutcome): string {
  return outcome === "draw" ? "the draw" : grounding[outcome];
}

function focusOneXTwoOutcome(question: string, grounding: Grounding): OneXTwoOutcome | null {
  const trimmed = question.trim();
  if (/^and the away side\??[.!]*$/i.test(trimmed)) return "away";
  if (/^and the home side\??[.!]*$/i.test(trimmed)) return "home";
  const lower = question.toLowerCase();
  const home = grounding.home.toLowerCase();
  const away = grounding.away.toLowerCase();
  const namesSide = /\b(?:edge|gap|value|price|odds|on|for)\b/.test(lower);
  if (lower.includes(away) && (!lower.includes(home) || lower.lastIndexOf(away) > lower.lastIndexOf(home))) {
    if (namesSide || /\b(?:away|visitor)\b/.test(lower)) return "away";
  }
  if (lower.includes(home) && !lower.includes(away) && (namesSide || /\bhome\b/.test(lower))) return "home";
  if (/\b(?:the )?draw\b/.test(lower) && (namesSide || /\b(?:what about|how about)\b/.test(lower))) return "draw";
  return null;
}

function orderOutcomes(focus: OneXTwoOutcome | null): OneXTwoOutcome[] {
  if (!focus) return ONE_X_TWO_OUTCOMES;
  return [focus, ...ONE_X_TWO_OUTCOMES.filter((outcome) => outcome !== focus)];
}

function labeledGapPhrase(gapPoints: number, label: string): string {
  if (Math.abs(gapPoints) < 0.05) return `${label} gap ~0 pts`;
  const sign = gapPoints >= 0 ? "+" : "";
  return `${label} gap ${sign}${gapPoints.toFixed(1)} pts`;
}

function marketDecimalSuffix(source: string): string {
  return source === "kalshi" || source === "polymarket" ? " (before fees)" : "";
}

function perSideMarketComparison(
  grounding: Grounding,
  divergence: NonNullable<Grounding["marketDivergence"][number]>,
  focus: OneXTwoOutcome | null,
): string {
  const pricingRow = grounding.pricing.markets.find((row) => row.source === divergence.source);
  const beforeFees = marketDecimalSuffix(divergence.source);
  const parts = orderOutcomes(focus).map((outcome) => {
    const leg = divergence.legs.find((row) => row.outcome === outcome)!;
    const label = outcomeLabelForComparison(grounding, outcome);
    const modelPct = pct(leg.modelPercent / 100);
    const impliedPct = pct(leg.marketPercent / 100);
    const fairModel = fairDecimal(leg.modelPercent / 100);
    const marketDec = pricingRow?.legs[outcome].decimalOdds != null
      ? pricingRow.legs[outcome].decimalOdds!.toFixed(2)
      : fairDecimal(leg.marketPercent / 100);
    return `${label}: model ${modelPct} vs implied ${impliedPct}, fair ${fairModel} vs market ${marketDec}${beforeFees}, ${labeledGapPhrase(leg.gapPoints, label)}`;
  });
  return parts.join("; ");
}

function formatOneXTwoSide(
  grounding: Grounding,
  probabilities: Record<OneXTwoOutcome, number>,
  withFair: boolean,
): string {
  return ONE_X_TWO_OUTCOMES.map((outcome) => {
    const p = probabilities[outcome];
    const label = outcomeLabelForComparison(grounding, outcome);
    return withFair
      ? `${label} ${pct(p)} (fair ${fairDecimal(p)})`
      : `${label} ${pct(p)}`;
  }).join(", ").replace(/, ([^,]+)$/, " and $1");
}

/** Independent model take first, single market reference block, no Lean line. */
export function composeMarketComparisonAnswer(question: string, grounding: Grounding): string | null {
  const divergence = grounding.marketDivergence[0];
  if (!divergence) {
    return grounding.externalMarketConsensus
      ? null
      : "I don’t have a complete, same-source and same-time 1X2 market to compare with this fixture, so I can’t claim a pricing disagreement.";
  }
  if (asksMarketGapFocusQuestion(question)) {
    return composeMarketGapFocusAnswer(grounding);
  }
  return composeIndependentMarketTakeAnswer(grounding, "full");
}

export function capitalizeSource(source: string): string {
  if (source === "kalshi") return "Kalshi";
  if (source === "polymarket") return "Polymarket";
  if (source === "stake") return "Stake";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function composeMarketDivergenceHeadline(grounding: Grounding, question = ""): string | null {
  return composeMarketComparisonAnswer(question, grounding);
}

export function composeSlateBestGapAnswer(now = new Date()): string {
  const { highlight, slateLabel } = largestSlateModelMarketGapForDemo(now);
  if (!highlight) {
    return `I don’t have complete external 1X2 quotes on ${slateLabel} to name the largest model-vs-market gap.`;
  }
  const sign = highlight.gapPoints >= 0 ? "+" : "";
  const rowLabel = slateGapRowLabel(highlight);
  const modelPct = deskPercentDisplay(highlight.modelPercent / 100);
  const marketPct = deskPercentDisplay(highlight.marketPercent / 100);
  const headline = `On ${slateLabel}, the largest gap is ${highlight.fixtureLabel} on ${rowLabel}.`;
  return joinBasicsAnswer({
    headline,
    supports: [
      `${rowLabel}  ${modelPct} vs market ${marketPct} | gap ${sign}${highlight.gapPoints.toFixed(1)} pts`,
      "That read uses the priced fixtures on today's slate, not every league match.",
    ],
    lean: `Lean: ${rowLabel}, small play.`,
  });
}

export function composeWinnerGuaranteeHonestyAnswer(_question: string, grounding: Grounding): string {
  const headline = `${grounding.home} v ${grounding.away}: I can’t guarantee a winner.`;
  const supports = [
    ...formatModelOnlySideRows(grounding),
    "Nothing is guaranteed; accas multiply risk.",
  ];
  return joinBasicsAnswer({
    headline,
    supports,
    responsibleGambling: true,
  });
}

export function composeOddsProvenanceAnswer(grounding: Grounding): string {
  const hasMarket = grounding.marketDivergence.length > 0
    || grounding.oddsSources.some((row) =>
      row.pDraw !== null && Number.isFinite(row.pHome) && Number.isFinite(row.pAway));
  const headline = hasMarket
    ? "Our 1X2 uses reviewed team strength; the Market line in a priced answer is the live 1X2 price we capture for that fixture."
    : "Our 1X2 uses reviewed team strength; I do not have a complete external 1X2 line on this fixture right now.";
  return joinBasicsAnswer({ headline });
}

function topScorelineRow(grounding: Grounding): { score: string; probability: number } | null {
  const rows = grounding.scorelines?.length ? grounding.scorelines : grounding.topScores;
  if (!rows?.length) return null;
  return [...rows].sort((a, b) => b.probability - a.probability)[0];
}

export function composePlayerScorerAnswer(
  grounding: Grounding,
  evidence: PlayerEvidenceBundle | null
): string {
  const capabilities = playerCapabilities(evidence);
  if (!evidence || (!hasTrustworthyPlayerEvidence(evidence) && capabilities.recentScorers === "unavailable")) {
    return PLAYER_SCORER_ABSTENTION;
  }
  const market = leadingScorerCandidate(evidence);
  const start = evidence.observations.find((row) =>
    row.evidenceType === "confirmed-lineup" || row.evidenceType === "expected-lineup"
  );
  const lines = [
    "I don’t have player-level projections for this fixture, so I can’t name a most likely scorer from match probabilities.",
  ];
  for (const recent of evidence.recentScorers ?? []) {
    lines.push(`For recent scoring context, ESPN records ${recent.players.slice(0, 3).join(", ")} scoring for ${recent.team} across the last ${recent.matchCount} available matches in this competition through ${recent.throughDate}. That history is not a projection or evidence that they will start.`);
  }
  if (market) {
    const date = market.observedAt ? dateLabel(market.observedAt) : "an undated report";
    const teamBit = market.teamId ? `${market.teamId} name` : "name";
    lines.push(
      `${market.playerName} is the shortest-priced ${teamBit} in the player-market quotes I have, `
      + `at ${market.decimalOdds.toFixed(2)} decimal [[${market.sourceId}]] (${date}). `
      + "I treat that quote as a market price, not my probability."
    );
  }
  if (start) {
    const date = start.observedAt ? dateLabel(start.observedAt) : "an undated report";
    const status = start.evidenceType === "confirmed-lineup" ? "confirmed" : "expected";
    lines.push(
      `${start.playerName} is ${status} to start according to a dated source [[${start.sourceId}]] (${date}).`
    );
  }
  if (!market && start) {
    lines.push("I could not establish a comparable scorer market, so that availability note is not my scorer ranking.");
  } else if (market) {
    lines.push("That quote is a market observation, not my player ranking.");
  }
  lines.push("Confirmed starters, expected minutes and a dated scorer market would help me assess the options.");
  return lines.join(" ");
}

function datedClubAvailabilityStatus(value: string): string {
  switch (value) {
    case "out": return "is ruled out";
    case "doubtful": return "is doubtful";
    case "injured": return "was reported injured";
    case "suspended": return "was suspended";
    default: return "is unavailable";
  }
}

/** Server-owned dated club records for extractDatedClubAvailability observations. */
export function composeDatedClubAvailabilityAnswer(evidence: PlayerEvidenceBundle | null): string | null {
  if (!evidence?.observations.length) return null;
  const dated = evidence.observations.filter((row): row is typeof row & { observedAt: string } =>
    Boolean(row.observedAt) && row.evidenceType === "availability"
    && datedClubAvailabilityStatus(String(row.value)) !== "is unavailable"
  ).slice(0, 3);
  if (!dated.length) return null;
  const lines = dated.map((row) => {
    const publicationDay = row.observedAt.slice(0, 10);
    return `In an update published on ${publicationDay}, ${row.teamId}’s ${row.playerName} ${datedClubAvailabilityStatus(String(row.value))} [[${row.sourceId}]].`;
  });
  lines.push("That is sourced availability, not a revised match forecast.");
  return lines.join(" ");
}

export function composeTeamNewsAnswer(
  grounding: Grounding,
  evidence: PlayerEvidenceBundle | null
): string {
  if (!evidence || !hasTeamNewsEvidence(evidence)) {
    return TEAM_NEWS_COMPOSE_ABSTENTION;
  }
  const dated = evidence.observations.filter((row): row is typeof row & { observedAt: string } =>
    Boolean(row.observedAt) && (row.evidenceType === "availability" ? availabilityLabel(row.value) !== null
      : row.evidenceType === "confirmed-lineup" || row.evidenceType === "expected-lineup")
  ).slice(0, 3);
  if (!dated.length) {
    return TEAM_NEWS_COMPOSE_ABSTENTION;
  }
  const lines = dated.map((row) => {
    const date = dateLabel(row.observedAt);
    const team = row.teamId ? ` (${row.teamId})` : "";
    if (row.evidenceType === "availability") {
      return `${row.playerName}${team} is listed as ${availabilityLabel(row.value)} according to a source [[${row.sourceId}]] (${date}).`;
    }
    const status = row.evidenceType === "confirmed-lineup" ? "confirmed" : "expected";
    return `${row.playerName}${team} is ${status} to start according to a source [[${row.sourceId}]] (${date}).`;
  });
  lines.push("That is match-context team news, not a revised forecast.");
  return lines.join(" ");
}

function availabilityLabel(value: string | number): string | null {
  return value === "out" ? "unavailable"
    : value === "doubtful" || value === "injured" || value === "suspended" ? value : null;
}

/** Server-owned labelled 1X2 with fair `1/p`. Never invents a sportsbook decimal. */
export function composeDeskLabelledOneXTwo(grounding: Grounding): string {
  const model = grounding.pricing.model;
  return `My 1X2 is ${grounding.home} ${pct(model.home.p)} (fair ${model.home.fairOdds.toFixed(2)}), `
    + `draw ${pct(model.draw.p)} (fair ${model.draw.fairOdds.toFixed(2)}) and `
    + `${grounding.away} ${pct(model.away.p)} (fair ${model.away.fairOdds.toFixed(2)}).`;
}

/**
 * One sourced availability wrinkle when this turn already extracted it.
 * Omitted when evidence is empty or conflicting — schematic takes do not
 * re-search injuries just to fill this slot.
 */
export function composeDeskSourcedWrinkle(
  evidence: PlayerEvidenceBundle | null
): string | null {
  if (!evidence || !hasTeamNewsEvidence(evidence)) return null;
  const row = evidence.observations.find((candidate): candidate is typeof candidate & { observedAt: string } =>
    Boolean(candidate.observedAt) && (candidate.evidenceType === "availability" ? availabilityLabel(candidate.value) !== null
      : candidate.evidenceType === "confirmed-lineup" || candidate.evidenceType === "expected-lineup")
  );
  if (!row) return null;
  const date = dateLabel(row.observedAt);
  const team = row.teamId ? ` (${row.teamId})` : "";
  const claim = row.evidenceType === "availability"
    ? `${row.playerName}${team} is listed as ${availabilityLabel(row.value)} according to a source [[${row.sourceId}]] (${date}).`
    : `${row.playerName}${team} is ${row.evidenceType === "confirmed-lineup" ? "confirmed" : "expected"} to start according to a source [[${row.sourceId}]] (${date}).`;
  return `${claim} That availability is not priced into the 1X2 above.`;
}

/**
 * Desk take outline: labelled 1X2 → optional sourced wrinkle → football sentences.
 * Board numbers stay on the UI board; this lead is the short composer copy.
 * MiniMax may supply only the football layer via `footballProse`.
 */
export function composeDeskTakeOutline(
  grounding: Grounding,
  options?: {
    footballProse?: string | null;
    playerEvidence?: PlayerEvidenceBundle | null;
    leadWithAnalystVoice?: boolean;
  }
): string {
  const oneXTwo = composeDeskLabelledOneXTwo(grounding);
  const wrinkle = composeDeskSourcedWrinkle(options?.playerEvidence ?? null);
  const fallback = composeDeskFootballTake(grounding, { leadWithAnalystVoice: options?.leadWithAnalystVoice });
  const football = options?.footballProse === fallback ? fallback
    : sanitizeDeskFootballHypotheses(options?.footballProse ?? "", grounding) || fallback;
  return [oneXTwo, wrinkle, football].filter(Boolean).join(" ");
}

/**
 * "Why do you favour City?" answered from what the forecast is actually built
 * on: the reviewed strength ratings and the home-field setting. It fell to the
 * generic short answer, whose lineup caveat the team-news guard then swapped
 * for an abstention, so the reader got a percentage and no reason. Ratings are
 * described, not printed: raw ratings are not publishable fact slots.
 */
function composeFavouriteReason(
  grounding: Grounding,
  favourite: { label: string; p: number }
): string {
  const gap = Math.abs(grounding.homeElo - grounding.awayElo);
  const stronger = grounding.homeElo >= grounding.awayElo ? grounding.home : grounding.away;
  const weaker = stronger === grounding.home ? grounding.away : grounding.home;
  if (favourite.label === "the draw" || gap < 15) {
    return `I don’t strongly favour either side. The reviewed strength ratings have ${grounding.home} and `
      + `${grounding.away} close together, so my 1X2 stays tight: ${grounding.home} ${pct(grounding.pHome)}, `
      + `draw ${pct(grounding.pDraw)}, ${grounding.away} ${pct(grounding.pAway)}.`;
  }
  const degree = gap < 50 ? "slightly" : gap < 120 ? "clearly" : "well";
  const venue = !grounding.homeFieldAdvantage
    ? ""
    : stronger === grounding.home
      ? `, and ${grounding.home} also get the home-field adjustment`
      : `, enough to outweigh ${grounding.home}’s home-field adjustment`;
  return `I favour ${favourite.label} because the reviewed strength ratings put ${stronger} ${degree} `
    + `ahead of ${weaker}${venue}. That makes ${favourite.label} ${pct(favourite.p)} in my 1X2. `
    + "It is a view of team strength and venue, not of this week’s selection.";
}

export function composeMatchResponse(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan = planResponse(question, {
    groundingKind: "match",
    hasCompleteMarket1x2: grounding.marketDivergence.length > 0,
  }),
  playerEvidence: PlayerEvidenceBundle | null = null
): string {
  if (punditTakeV2Active()) {
    if (grounding.kind === "match") {
      stashTakeDossier(prefetchStoredTakeDossier(grounding));
    }
    const prefetched = consumePrefetchedTakeDelivery();
    const take = prefetched ?? composePunditTakeDelivery(question, grounding, plan);
    if (take) {
      stashPunditTakeDelivery(take);
      return take.answer;
    }
  }
  if (asksParlayQuestion(question)) {
    return PARLAY_OUT_OF_SCOPE;
  }
  if (plan.mode === "totals" || plan.mode === "btts") {
    return composePricedGridAnswer(question, grounding);
  }
  if (plan.mode === "pricing-desk") {
    if (/\b(?:what about|how about)\b/i.test(question) && /\b(?:the )?draw\b/i.test(question)) {
      const divergence = grounding.marketDivergence[0];
      const pricingRow = divergence
        ? grounding.pricing.markets.find((row) => row.source === divergence.source)
        : undefined;
      const drawDec = pricingRow?.legs.draw.decimalOdds ?? null;
      const drawLeg = divergence?.legs.find((row) => row.outcome === "draw");
      return joinBasicsAnswer({
        headline: `Here's the draw on ${grounding.home} v ${grounding.away}.`,
        supports: [
          formatModelOnlySideRows(grounding).find((row) => row.startsWith("Draw"))!,
          drawDec == null ? "No market line to compare on the draw — these are our draw numbers only." : undefined,
        ].filter(Boolean) as string[],
        lean: drawDec != null && drawLeg
          ? formatMarketActionLean(grounding, drawLeg, drawDec)
          : undefined,
      });
    }
    return composePricingDeskAnswer(grounding, question);
  }
  if (plan.mode === "player-or-scorer") {
    return composePlayerScorerAnswer(grounding, playerEvidence);
  }
  if (plan.mode === "lineup-counterfactual") {
    return "I can’t quantify that lineup effect without verified team news and a revised forecast. A confirmed change could alter my read, but I won’t invent a percentage adjustment.";
  }
  if (plan.mode === "team-news") {
    return composeTeamNewsAnswer(grounding, playerEvidence);
  }
  const contract = buildResponseFacts(grounding);
  const scoreRequest = resolveRequestedScoreline(question, grounding);
  const score = scoreRequest?.score ?? null;
  if ((plan.mode === "fair-price" || plan.mode === "exact-score") && score) {
    const fact = factById(contract, `score.${score}`);
    if (!fact?.numeric || fact.numeric.value <= 0) {
      return `I don’t have a publishable probability for ${grounding.home} ${score} ${grounding.away}, so I can’t give you a fair price without inventing one.`;
    }
    const fair = (1 / fact.numeric.value).toFixed(2);
    const orientation = scoreRequest?.orientation === "home-away-default"
      ? `Reading ${score} in home-away order, for`
      : "For";
    return plan.mode === "fair-price"
      ? `${orientation} ${grounding.home} ${score} ${grounding.away}, I make it ${pct(fact.numeric.value)}, or about ${fair} in fair decimal odds. I don’t have a comparable live exact-score quote here, so that is a fair price, not a claim that the market is wrong.`
      : `${scoreRequest?.orientation === "home-away-default" ? `Reading ${score} in home-away order, I` : "I"} make ${grounding.home} ${score} ${grounding.away} ${pct(fact.numeric.value)} for this fixture.`;
  }
  if (plan.mode === "exact-score") {
    const singularScoreAsk = /\b(?:most likely|correct|projected|predicted)\s+score\b|\bwhat(?:'s| is) the (?:final )?score\b/i.test(question);
    if (singularScoreAsk && !score) {
      const top = topScorelineRow(grounding);
      if (top) {
        const { displayPct, fairDecimal: fairDec } = deskProbabilityDisplay(top.probability);
        return joinBasicsAnswer({
          headline: `The likeliest scoreline on ${grounding.home} v ${grounding.away} is ${top.score}.`,
          supports: [
            `${top.score}  ${displayPct} | fair ${fairDec}`,
            "Scorelines come from the same Poisson grid as 1X2, totals, and BTTS.",
          ],
          lean: `Lean: ${top.score}, small play.`,
        });
      }
    }
    return composeScorelineBoard(question, grounding);
  }
  if (plan.mode === "odds-provenance") {
    return composeOddsProvenanceAnswer(grounding);
  }
  if (plan.mode === "slate-best-gap") {
    return composeSlateBestGapAnswer();
  }
  if (plan.mode === "winner-guarantee-honesty") {
    return composeWinnerGuaranteeHonestyAnswer(question, grounding);
  }
  if (plan.mode === "user-line") {
    return composeUserLineAnswer(grounding);
  }
  if (plan.mode === "stake-refusal") {
    const withBankroll = mentionsBankroll(question);
    if (grounding.pricing.userLine) {
      const answer = composeUserLineAnswer(grounding);
      return withBankroll
        ? answer
        : `${answer}\n${STAKE_REFUSAL_SENTENCE}`;
    }
    return joinBasicsAnswer({
      headline: `${grounding.home} v ${grounding.away}: my 1X2 read.`,
      supports: [...formatModelOnlySideRows(grounding)],
      lean: withBankroll ? undefined : `Lean: ${STAKE_REFUSAL_SENTENCE}`,
    });
  }
  if (plan.mode === "priced-why") {
    return composeWhyAfterPricedTurn(grounding);
  }
  if (plan.mode === "market-comparison") {
    return composeMarketComparisonAnswer(question, grounding)
      ?? "I don’t have a complete, same-source and same-time 1X2 market to compare with this fixture, so I can’t claim a pricing disagreement.";
  }
  if (plan.mode === "match-follow-up") {
    const priced = pricedGridMarketsAsked(question);
    if (priced.some((market) => market !== "1x2")) {
      return composePricedGridAnswer(question, grounding);
    }
    if (asksUnpricedMarket(question)) {
      return "I don’t have a line for that market on this fixture. I can price 1X2, over/under 2.5, BTTS, and scorelines.";
    }
    if (/\bdraw\b/i.test(question) && !/\bno bet\b/i.test(question)) {
      return `I have the draw at ${pct(grounding.pDraw)} (fair ${fairDecimal(grounding.pDraw)}) in ${grounding.home} v ${grounding.away}.`;
    }
    const favourite = [
      { label: grounding.home, p: grounding.pHome },
      { label: "the draw", p: grounding.pDraw },
      { label: grounding.away, p: grounding.pAway },
    ].sort((a, b) => b.p - a.p)[0];
    if (/\b1x2\b/i.test(question)) {
      return `My 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`;
    }
    if (/\b(?:which|what)\b.{0,40}\b(?:input|factor|driver)\b.{0,30}\b(?:matters? most|most important|drives?|explains?)\b|\b(?:most important|main)\b.{0,20}\b(?:input|factor|driver)\b/i.test(question)) {
      return "I can’t isolate one input as the cause of that edge. My read uses reviewed team strength and the competition’s home-field setting, but these facts do not provide a causal contribution for either input.";
    }
    if (/\b(?:which side|who)\b.{0,50}\b(?:stronger|strongest|better case|edge)\b|\bstronger\b.{0,20}\b(?:case|side)\b/i.test(question)) {
      return `I have ${favourite.label} as the stronger case at ${pct(favourite.p)}. That is the direct matchup read; I can’t honestly decompose the edge into an exact contribution from each input.`;
    }
    if (/\bwhy\b[^?\n]{0,40}\b(?:favou?r|back|lean|prefer|like|rate|pick|fancy)\b|\bhow come\b|\bwhat makes you\b/i.test(question)) {
      return composeFavouriteReason(grounding, favourite);
    }
    if (asksTacticalTake(question)) {
      return composeDeskTakeOutline(grounding, {
        playerEvidence,
        leadWithAnalystVoice: true,
      });
    }
    return `My short answer is ${favourite.label} at ${pct(favourite.p)}. The main constraint is that this is a team-strength view; it does not include a confirmed lineup.`;
  }

  const scores = grounding.topScores.slice(0, 3)
    .map((row) => `${row.score} (${pct(row.probability)})`).join(", ");
  const outcomes = [
    { label: grounding.home, p: grounding.pHome },
    { label: "the draw", p: grounding.pDraw },
    { label: grounding.away, p: grounding.pAway },
  ].sort((a, b) => b.p - a.p);
  const tableExplain = tableVsModelFavoriteExplainLine(grounding);
  const gapLine = biggestMarketGapLine(grounding);
  const oddsTable = composeMatchPreviewOddsTable(grounding);
  const sourcesFooter = composeMatchPreviewSourcesFooter(grounding);
  const consensus = grounding.consensus
    ? `${PUNDIT_FUNDAMENTAL_LABEL} is our standalone 1X2 above. ${PUNDIT_CONSENSUS_LABEL}, a separate view shrunk toward the market, is ${grounding.home} ${pct(grounding.consensus.pHome)}, draw ${pct(grounding.consensus.pDraw)} and ${grounding.away} ${pct(grounding.consensus.pAway)}.`
    : "";
  return [
    `I make ${outcomes[0].label} the likeliest outcome at ${pct(outcomes[0].p)}. For ${dateLabel(grounding.date)}, my full 1X2 is ${grounding.home} ${pct(grounding.pHome)}, draw ${pct(grounding.pDraw)} and ${grounding.away} ${pct(grounding.pAway)}.`,
    gapLine ?? "",
    tableExplain ?? "",
    asksCompleteMatchBriefing(question) ? composeBriefingFootball(grounding) : "",
    `Both teams to score is ${pct(grounding.pBttsYes)}.${scores ? ` The leading scorelines are ${scores}.` : ""} ${totalsAssumptionSentence(grounding)}`,
    consensus,
    revisitAfterNews(grounding),
    oddsTable,
    sourcesFooter,
  ].filter(Boolean).join("\n\n");
}
