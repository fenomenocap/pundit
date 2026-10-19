import type { Grounding } from "../ask";
import {
  compactTeamLabel,
  deskFairFromProb,
  deskPercentDisplay,
  displayOutcomeLabel,
  selectValueLeg,
} from "../basics-answer-voice";
import type { MatchDossier } from "../match-dossier/types";
import type { OneXTwoOutcome } from "../response-correctness";
import type {
  PunditTakePlan,
  TakePlanCall,
  TakePlanMarketColumn,
  TakePlanPoint,
  TakePlanRow,
  TakePlanValueLeg,
} from "./types";

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

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
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

function tablePoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  homeShort: string,
  awayShort: string,
): TakePlanPoint[] {
  const homePos = dossier?.table.home.value.position ?? grounding.homeTable.position;
  const awayPos = dossier?.table.away.value.position ?? grounding.awayTable.position;
  const homePts = dossier?.table.home.value.points
    ?? (grounding.homeTable.position != null ? grounding.homeTable.points : null);
  const awayPts = dossier?.table.away.value.points ?? grounding.awayTable.points;
  if (homePos == null || awayPos == null || homePts == null || awayPts == null) return [];
  return [{
    id: "fact-table-standings",
    role: "support",
    text: `${homeShort} are ${ordinal(homePos)} on ${homePts} points; ${awayShort} are ${ordinal(awayPos)} on ${awayPts}.`,
    fieldPath: "table.home,table.away",
  }];
}

function buildSupportingPoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  call: TakePlanCall,
  homeShort: string,
  awayShort: string,
): TakePlanPoint[] {
  const points: TakePlanPoint[] = [];
  const favSide = call.outcome === "draw" ? null : call.outcome;

  points.push(...tablePoints(grounding, dossier, homeShort, awayShort));

  if (favSide === "home" && grounding.homeFieldAdvantage) {
    points.push({
      id: "fact-home-advantage",
      role: "support",
      text: `${homeShort} host ${awayShort} with home advantage applied in this forecast.`,
      fieldPath: "fixture.homeFieldAdvantage",
    });
  }

  for (const item of dossier?.evidence ?? []) {
    if (item.direction === "supports-home" && favSide === "home") {
      points.push({
        id: `support-ev-${item.id}`,
        role: "support",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
    if (item.direction === "supports-away" && favSide === "away") {
      points.push({
        id: `support-ev-${item.id}`,
        role: "support",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
  }

  return points.slice(0, 4);
}

function buildContradictingPoints(
  grounding: Grounding,
  dossier: MatchDossier | null,
  call: TakePlanCall,
): TakePlanPoint[] {
  const points: TakePlanPoint[] = [];
  const favSide = call.outcome === "draw" ? null : call.outcome;
  const favLabel = call.headlineLabel;

  const homeForm = dossier?.form.homeLast5.value;
  if (homeForm && homeForm.played >= 3 && favSide === "home") {
    points.push({
      id: "fact-form-home-last5",
      role: "contradict",
      text: `Over their last ${homeForm.played} league games ${compactTeamLabel(grounding.home)} scored ${homeForm.goalsFor} and conceded ${homeForm.goalsAgainst}.`,
      fieldPath: "form.homeLast5",
    });
  }

  const injuryItems = dossier?.injuries.value.items ?? [];
  if (injuryItems.length) {
    points.push({
      id: "fact-injuries",
      role: "contradict",
      text: injuryItems.slice(0, 2).map((i) => i.claim).join(" "),
      fieldPath: "injuries",
      evidenceId: injuryItems[0]?.id,
    });
  }

  for (const item of dossier?.evidence ?? []) {
    if (item.direction === "contradicts-model") {
      points.push({
        id: `contradict-ev-${item.id}`,
        role: "contradict",
        text: item.claim,
        evidenceId: item.id,
        fieldPath: `evidence.${item.id}`,
      });
    }
  }

  const divergence = grounding.marketDivergence[0];
  if (divergence && favSide) {
    const favLeg = divergence.legs.find((leg) => leg.outcome === favSide);
    if (favLeg && favLeg.gapPoints <= -2) {
      const modelInt = Math.round(favLeg.modelPercent);
      const marketInt = Math.round(favLeg.marketPercent);
      points.push({
        id: "fact-market-more-confident-favourite",
        role: "contradict",
        text: `The market is more confident in ${favLabel} than I am (${marketInt}% v ${modelInt}%).`,
        fieldPath: "marketDivergence",
      });
    }
  }

  return points.slice(0, 3);
}

function buildFlipCondition(
  grounding: Grounding,
  dossier: MatchDossier | null,
  call: TakePlanCall,
): TakePlanPoint | null {
  const lineupItems = dossier?.lineups.value.items ?? [];
  if (lineupItems.length) {
    return {
      id: "flip-lineups",
      role: "flip",
      text: lineupItems[0].claim,
      fieldPath: "lineups",
      evidenceId: lineupItems[0]?.id,
    };
  }
  const drawPct = pctInt(grounding.pDraw);
  if (call.outcome !== "draw" && drawPct >= 20 && lineupItems.length === 0) {
    return null;
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

export function buildPunditTakePlan(
  grounding: Grounding,
  dossier: MatchDossier | null,
): PunditTakePlan {
  const call = favoriteOutcome(grounding);
  const homeShort = compactTeamLabel(grounding.home);
  const awayShort = compactTeamLabel(grounding.away);
  const { rows, columns, hasCompleteMarket } = buildMarketRows(grounding);
  const valueLeg = buildValueLeg(grounding, rows);

  return {
    schemaVersion: 1,
    fixtureLabel: `${homeShort} v ${awayShort}`,
    call,
    supporting: buildSupportingPoints(grounding, dossier, call, homeShort, awayShort),
    contradicting: buildContradictingPoints(grounding, dossier, call),
    flipCondition: buildFlipCondition(grounding, dossier, call),
    valueLeg,
    hasCompleteMarket,
    rows,
    marketColumns: columns,
  };
}
