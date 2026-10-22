import type { Grounding } from "../ask";
import {
  compactTeamLabel,
  deskPercentDisplay,
  displayOutcomeLabel,
  selectValueLeg,
} from "../basics-answer-voice";
import { livePricingMarkets } from "./take-plan-live-markets";
import type { MatchDossier } from "../match-dossier/types";
import type { OneXTwoOutcome } from "../response-correctness";
import type {
  PunditTakePlan,
  TakePlanCall,
  TakePlanGridCall,
  TakePlanGridRow,
  TakePlanMarketColumn,
  TakePlanPoint,
  TakePlanRow,
  TakePlanValueLeg,
} from "./types";
import {
  build1x2SupportingPoints,
  buildContradictingPointsShared,
  buildGoalReasonPoints,
} from "./take-plan-helpers";
import { buildTakeFlipCondition } from "./take-flip-condition";
import { fairDecimalFromRawProb } from "./take-maths";
import { filterGoalPointsForGridLead } from "./take-prose-polish";
import { is1x2SidePickSuppressed, pickHigherGridSide } from "./take-headline";
import { buildTakeNumericFacts } from "./take-number-check";

const OUTCOMES: OneXTwoOutcome[] = ["home", "draw", "away"];

function pctInt(p: number): number {
  return Math.round(p * 100);
}

function shortSource(source: string): string {
  if (source === "polymarket") return "Poly";
  if (source === "kalshi") return "Kalshi";
  if (source === "stake") return "Stake";
  return source.slice(0, 6);
}

function favoriteOutcome(grounding: Grounding): TakePlanCall {
  const sides = ([
    { outcome: "home" as const, p: grounding.pHome },
    { outcome: "draw" as const, p: grounding.pDraw },
    { outcome: "away" as const, p: grounding.pAway },
  ] as const).slice().sort((a, b) => b.p - a.p);
  const top = sides[0];
  const label = displayOutcomeLabel(grounding, top.outcome);
  const headline = top.outcome === "draw" ? "the draw" : label;
  return { outcome: top.outcome, sideLabel: label, headlineLabel: headline };
}

function buildMarketRows(grounding: Grounding, nowMs = Date.now()): {
  rows: TakePlanRow[];
  columns: TakePlanMarketColumn[];
  hasCompleteMarket: boolean;
} {
  const markets = livePricingMarkets(grounding, nowMs);
  const hasCompleteMarket = markets.length > 0;
  const columns: TakePlanMarketColumn[] = markets.map((row) => ({
    sourceKey: row.source,
    shortLabel: shortSource(row.source),
    observedAt: row.observedAt,
  }));

  const rows: TakePlanRow[] = OUTCOMES.map((outcome) => {
    const p = outcome === "home" ? grounding.pHome : outcome === "draw" ? grounding.pDraw : grounding.pAway;
    const label = displayOutcomeLabel(grounding, outcome);
    const sourceDecimals: Record<string, string | null> = {};
    let best: number | null = null;
    for (const market of markets) {
      const dec = market.legs[outcome].decimalOdds;
      sourceDecimals[market.source] = dec != null ? dec.toFixed(2) : null;
      if (dec != null && (best == null || dec > best)) best = dec;
    }
    return {
      outcome,
      label,
      modelPctInt: pctInt(p),
      fairDecimal: fairDecimalFromRawProb(p),
      sourceDecimals,
      bestDecimal: best != null ? best.toFixed(2) : null,
    };
  });

  return { rows, columns, hasCompleteMarket };
}

function buildGridRows(
  sides: Array<{ sideKey: string; label: string; p: number }>,
): TakePlanGridRow[] {
  return sides.map(({ sideKey, label, p }) => ({
    sideKey,
    label,
    modelPctInt: pctInt(p),
    fairDecimal: fairDecimalFromRawProb(p),
    sourceDecimals: {},
    bestDecimal: null,
  }));
}

function buildValueLeg(grounding: Grounding, rows: TakePlanRow[]): TakePlanValueLeg | null {
  const divergence = grounding.marketDivergence[0];
  if (!divergence) return null;
  const leg = selectValueLeg(divergence.legs);
  const row = rows.find((r) => r.outcome === leg.outcome);
  if (!row) return null;
  return {
    outcome: leg.outcome,
    label: displayOutcomeLabel(grounding, leg.outcome),
    modelPctInt: row.modelPctInt,
    fairDecimal: row.fairDecimal,
    bestMarketDecimal: row.bestDecimal,
    gapPoints: leg.gapPoints,
  };
}

function emptyGridCall(): TakePlanGridCall | null {
  return null;
}

function makeGridCall(lead: { sideKey: string; label: string; p: number; coinFlip: boolean }): TakePlanGridCall {
  return {
    sideKey: lead.sideKey,
    headlineLabel: lead.label,
    modelPctInt: pctInt(lead.p),
    modelPctDisplay: deskPercentDisplay(lead.p),
    fairDecimal: fairDecimalFromRawProb(lead.p),
    coinFlip: lead.coinFlip,
  };
}

function withNumericFacts(
  grounding: Grounding,
  dossier: MatchDossier | null,
  plan: Omit<PunditTakePlan, "numericFacts">,
): PunditTakePlan {
  return {
    ...plan,
    numericFacts: buildTakeNumericFacts(
      grounding,
      dossier,
      plan.rows,
      plan.gridCall,
      plan.gridRows,
    ),
  };
}

export function buildPunditTakePlan(
  grounding: Grounding,
  dossier: MatchDossier | null,
  options?: { marketKind?: "1x2" | "btts" | "totals"; underFocus?: boolean; now?: Date },
): PunditTakePlan {
  const marketKind = options?.marketKind ?? "1x2";
  const nowMs = options?.now?.getTime() ?? Date.now();
  const homeShort = compactTeamLabel(grounding.home);
  const awayShort = compactTeamLabel(grounding.away);
  const fixtureLabel = `${homeShort} v ${awayShort}`;

  if (marketKind === "btts") {
    const yesP = grounding.pBttsYes;
    const noP = grounding.pBttsNo;
    const lead = pickHigherGridSide([
      { sideKey: "yes", label: "BTTS yes", p: yesP },
      { sideKey: "no", label: "BTTS no", p: noP },
    ]);
    const gridRows = buildGridRows([
      { sideKey: "yes", label: "BTTS yes", p: yesP },
      { sideKey: "no", label: "BTTS no", p: noP },
    ]);
    const gridCall = makeGridCall(lead);
    const goalPoints = filterGoalPointsForGridLead(
      buildGoalReasonPoints(grounding, dossier, homeShort, awayShort),
      gridCall,
      grounding,
    );
    const call = favoriteOutcome(grounding);
    const marketBundle = buildMarketRows(grounding, nowMs);
    return withNumericFacts(grounding, dossier, {
      schemaVersion: 1,
      marketKind: "btts",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: [],
      flipCondition: buildTakeFlipCondition(dossier, grounding, call, gridCall, "btts"),
      valueLeg: null,
      hasCompleteMarket: marketBundle.hasCompleteMarket,
      rows: marketBundle.rows,
      marketColumns: marketBundle.columns,
    });
  }

  if (marketKind === "totals") {
    const overP = grounding.pOver2_5;
    const underP = grounding.pUnder2_5;
    const lead = pickHigherGridSide([
      { sideKey: "over", label: "Over 2.5", p: overP },
      { sideKey: "under", label: "Under 2.5", p: underP },
    ]);
    const gridRows = buildGridRows([
      { sideKey: "over", label: "Over 2.5", p: overP },
      { sideKey: "under", label: "Under 2.5", p: underP },
    ]);
    const gridCall = makeGridCall(lead);
    const goalPoints = filterGoalPointsForGridLead(
      buildGoalReasonPoints(grounding, dossier, homeShort, awayShort),
      gridCall,
      grounding,
    );
    const call = favoriteOutcome(grounding);
    const marketBundle = buildMarketRows(grounding, nowMs);
    return withNumericFacts(grounding, dossier, {
      schemaVersion: 1,
      marketKind: "totals",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: [],
      flipCondition: buildTakeFlipCondition(dossier, grounding, call, gridCall, "totals"),
      valueLeg: null,
      hasCompleteMarket: marketBundle.hasCompleteMarket,
      rows: marketBundle.rows,
      marketColumns: marketBundle.columns,
    });
  }

  const levelNoSide = is1x2SidePickSuppressed(grounding);
  const call = levelNoSide
    ? { outcome: "draw" as const, sideLabel: "level", headlineLabel: "no side" }
    : favoriteOutcome(grounding);
  const favSide = levelNoSide || call.outcome === "draw" ? null : call.outcome;
  const { rows, columns, hasCompleteMarket } = buildMarketRows(grounding, nowMs);
  const valueLeg = levelNoSide ? null : buildValueLeg(grounding, rows);

  return withNumericFacts(grounding, dossier, {
    schemaVersion: 1,
    marketKind: "1x2",
    fixtureLabel,
    call,
    gridCall: emptyGridCall(),
    gridRows: [],
    supporting: build1x2SupportingPoints(grounding, dossier, favSide, homeShort, awayShort),
    contradicting: buildContradictingPointsShared(grounding, dossier, favSide, call.headlineLabel),
    flipCondition: levelNoSide ? null : buildTakeFlipCondition(dossier, grounding, call, null, "1x2"),
    valueLeg,
    levelNoSide,
    hasCompleteMarket,
    rows,
    marketColumns: columns,
  });
}
