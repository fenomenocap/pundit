import type { Grounding } from "../ask";
import {
  compactTeamLabel,
  deskFairFromProb,
  displayOutcomeLabel,
  selectValueLeg,
} from "../basics-answer-voice";
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
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";

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

function buildFlipCondition(dossier: MatchDossier | null): TakePlanPoint | null {
  const lineupItems = (dossier?.lineups.value.items ?? []).filter(takeEligibleDossierEvidence);
  if (lineupItems.length) {
    return {
      id: "flip-lineups",
      role: "flip",
      text: lineupItems[0].claim,
      fieldPath: "lineups",
      evidenceId: lineupItems[0]?.id,
    };
  }
  return null;
}

function buildMarketRows(grounding: Grounding): {
  rows: TakePlanRow[];
  columns: TakePlanMarketColumn[];
  hasCompleteMarket: boolean;
} {
  const markets = grounding.pricing.markets.filter(
    (row) => row.legs.draw.decimalOdds != null || row.legs.draw.impliedP != null,
  );
  const hasCompleteMarket = markets.length > 0 && grounding.marketDivergence.length > 0;
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
      fairDecimal: deskFairFromProb(p),
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
    fairDecimal: deskFairFromProb(p),
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

export function buildPunditTakePlan(
  grounding: Grounding,
  dossier: MatchDossier | null,
  options?: { marketKind?: "1x2" | "btts" | "totals"; underFocus?: boolean },
): PunditTakePlan {
  const marketKind = options?.marketKind ?? "1x2";
  const homeShort = compactTeamLabel(grounding.home);
  const awayShort = compactTeamLabel(grounding.away);
  const fixtureLabel = `${homeShort} v ${awayShort}`;

  if (marketKind === "btts") {
    const yesP = grounding.pBttsYes;
    const gridRows = buildGridRows([
      { sideKey: "yes", label: "BTTS yes", p: yesP },
      { sideKey: "no", label: "BTTS no", p: grounding.pBttsNo },
    ]);
    const gridCall: TakePlanGridCall = {
      sideKey: "yes",
      headlineLabel: "BTTS yes",
      modelPctInt: pctInt(yesP),
      fairDecimal: deskFairFromProb(yesP),
    };
    const goalPoints = buildGoalReasonPoints(grounding, dossier, homeShort, awayShort);
    const call = favoriteOutcome(grounding);
    return {
      schemaVersion: 1,
      marketKind: "btts",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: goalPoints.length ? [] : [],
      flipCondition: buildFlipCondition(dossier),
      valueLeg: null,
      hasCompleteMarket: false,
      rows: buildMarketRows(grounding).rows,
      marketColumns: [],
    };
  }

  if (marketKind === "totals") {
    const underFocus = options?.underFocus ?? false;
    const leadP = underFocus ? grounding.pUnder2_5 : grounding.pOver2_5;
    const leadLabel = underFocus ? "Under 2.5" : "Over 2.5";
    const leadKey = underFocus ? "under" : "over";
    const gridRows = buildGridRows([
      { sideKey: leadKey, label: leadLabel, p: leadP },
      { sideKey: underFocus ? "over" : "under", label: underFocus ? "Over 2.5" : "Under 2.5", p: underFocus ? grounding.pOver2_5 : grounding.pUnder2_5 },
    ]);
    const gridCall: TakePlanGridCall = {
      sideKey: leadKey,
      headlineLabel: leadLabel,
      modelPctInt: pctInt(leadP),
      fairDecimal: deskFairFromProb(leadP),
    };
    const goalPoints = buildGoalReasonPoints(grounding, dossier, homeShort, awayShort);
    const call = favoriteOutcome(grounding);
    return {
      schemaVersion: 1,
      marketKind: "totals",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: [],
      flipCondition: buildFlipCondition(dossier),
      valueLeg: null,
      hasCompleteMarket: false,
      rows: buildMarketRows(grounding).rows,
      marketColumns: [],
    };
  }

  const call = favoriteOutcome(grounding);
  const favSide = call.outcome === "draw" ? null : call.outcome;
  const { rows, columns, hasCompleteMarket } = buildMarketRows(grounding);
  const valueLeg = buildValueLeg(grounding, rows);

  return {
    schemaVersion: 1,
    marketKind: "1x2",
    fixtureLabel,
    call,
    gridCall: emptyGridCall(),
    gridRows: [],
    supporting: build1x2SupportingPoints(grounding, dossier, favSide, homeShort, awayShort),
    contradicting: buildContradictingPointsShared(grounding, dossier, favSide, call.headlineLabel),
    flipCondition: buildFlipCondition(dossier),
    valueLeg,
    hasCompleteMarket,
    rows,
    marketColumns: columns,
  };
}
