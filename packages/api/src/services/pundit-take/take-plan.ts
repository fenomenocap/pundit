import type { Grounding } from "../ask";
import {
  compactTeamLabel,
  deskFairFromProb,
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
import { takeEligibleDossierEvidence } from "./take-dossier-evidence";
import { isGenuineTossUp1x2, pickHigherGridSide } from "./take-headline";

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

function buildFlipCondition(
  dossier: MatchDossier | null,
  grounding: Grounding,
  valueLeg: TakePlanValueLeg | null,
  call: TakePlanCall,
  rows: TakePlanRow[],
  gridCall: TakePlanGridCall | null,
): TakePlanPoint | null {
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

  const injuryItems = (dossier?.injuries.value.items ?? []).filter(takeEligibleDossierEvidence);
  if (injuryItems.length) {
    return {
      id: "flip-injuries",
      role: "flip",
      text: injuryItems[0].claim,
      fieldPath: "injuries",
      evidenceId: injuryItems[0]?.id,
    };
  }

  for (const item of dossier?.evidence ?? []) {
    if (!takeEligibleDossierEvidence(item)) continue;
    if (item.category === "injuries" || item.category === "rotation" || item.category === "manager") {
      if (!isGenuineTossUp1x2(grounding) && /\btoss-up\b/i.test(item.claim)) continue;
      return {
        id: `flip-ev-${item.id}`,
        role: "flip",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      };
    }
  }

  const homeForm = dossier?.form.homeLast5.value;
  const awayForm = dossier?.form.awayLast5.value;
  if (homeForm && homeForm.played >= 3 && homeForm.goalsAgainst >= homeForm.goalsFor + 3) {
    return {
      id: "flip-home-form",
      role: "flip",
      text: `${compactTeamLabel(grounding.home)} tighten up defensively over their last ${homeForm.played} league games.`,
      fieldPath: "form.homeLast5",
    };
  }
  if (awayForm && awayForm.played >= 3 && awayForm.goalsFor >= awayForm.goalsAgainst + 3) {
    return {
      id: "flip-away-form",
      role: "flip",
      text: `${compactTeamLabel(grounding.away)} keep finding goals over their last ${awayForm.played} league games.`,
      fieldPath: "form.awayLast5",
    };
  }

  if (valueLeg?.bestMarketDecimal) {
    return {
      id: "flip-market",
      role: "flip",
      text: `${valueLeg.label} shortens toward ${valueLeg.fairDecimal} fair at the books.`,
      fieldPath: "marketDivergence",
    };
  }

  const divergence = grounding.marketDivergence[0];
  const largest = divergence?.largest;
  if (largest && Math.abs(largest.gapPoints) >= 3) {
    return {
      id: "flip-market-gap",
      role: "flip",
      text: `the market moves ${largest.label} toward ${Math.round(largest.marketPercent)}% implied.`,
      fieldPath: "marketDivergence",
    };
  }

  const favRow = rows.find((row) => row.outcome === call.outcome);
  if (favRow?.bestDecimal) {
    return {
      id: "flip-fair-vs-best",
      role: "flip",
      text: `${call.headlineLabel} trades at ${favRow.bestDecimal} against our ${favRow.fairDecimal} fair.`,
      fieldPath: "pricing.markets",
    };
  }

  const homePts = dossier?.table.home.value.points;
  const awayPts = dossier?.table.away.value.points;
  if (homePts != null && awayPts != null) {
    return {
      id: "flip-table",
      role: "flip",
      text: `the table moves off ${homePts} and ${awayPts} points before kickoff.`,
      fieldPath: "table.home,table.away",
    };
  }

  if (gridCall) {
    return {
      id: "flip-grid-fair",
      role: "flip",
      text: `books shorten ${gridCall.headlineLabel} toward our ${gridCall.fairDecimal} fair.`,
      fieldPath: "gridCall",
    };
  }

  const modelFair = rows.find((row) => row.outcome === call.outcome)?.fairDecimal ?? null;
  return {
    id: "flip-market-drift",
    role: "flip",
    text: modelFair
      ? `${call.headlineLabel} shortens toward our ${modelFair} fair at the books.`
      : `late team news or a market move on ${call.headlineLabel} before kickoff.`,
    fieldPath: "pricing.markets",
  };
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

function makeGridCall(lead: { sideKey: string; label: string; p: number; coinFlip: boolean }): TakePlanGridCall {
  return {
    sideKey: lead.sideKey,
    headlineLabel: lead.label,
    modelPctInt: pctInt(lead.p),
    modelPctDisplay: deskPercentDisplay(lead.p),
    fairDecimal: deskFairFromProb(lead.p),
    coinFlip: lead.coinFlip,
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
    const goalPoints = buildGoalReasonPoints(grounding, dossier, homeShort, awayShort);
    const call = favoriteOutcome(grounding);
    const marketBundle = buildMarketRows(grounding, nowMs);
    return {
      schemaVersion: 1,
      marketKind: "btts",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: goalPoints.length ? [] : [],
      flipCondition: buildFlipCondition(dossier, grounding, null, call, marketBundle.rows, gridCall),
      valueLeg: null,
      hasCompleteMarket: marketBundle.hasCompleteMarket,
      rows: marketBundle.rows,
      marketColumns: marketBundle.columns,
    };
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
    const goalPoints = buildGoalReasonPoints(grounding, dossier, homeShort, awayShort);
    const call = favoriteOutcome(grounding);
    const marketBundle = buildMarketRows(grounding, nowMs);
    return {
      schemaVersion: 1,
      marketKind: "totals",
      fixtureLabel,
      call,
      gridCall,
      gridRows,
      supporting: goalPoints,
      contradicting: [],
      flipCondition: buildFlipCondition(dossier, grounding, null, call, marketBundle.rows, gridCall),
      valueLeg: null,
      hasCompleteMarket: marketBundle.hasCompleteMarket,
      rows: marketBundle.rows,
      marketColumns: marketBundle.columns,
    };
  }

  const call = favoriteOutcome(grounding);
  const favSide = call.outcome === "draw" ? null : call.outcome;
  const { rows, columns, hasCompleteMarket } = buildMarketRows(grounding, nowMs);
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
    flipCondition: buildFlipCondition(dossier, grounding, valueLeg, call, rows, null),
    valueLeg,
    hasCompleteMarket,
    rows,
    marketColumns: columns,
  };
}
