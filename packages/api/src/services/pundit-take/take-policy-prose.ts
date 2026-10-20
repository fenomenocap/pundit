import type { Grounding } from "../ask";
import { STAKE_REFUSAL_SENTENCE } from "../response-composer";
import {
  bankrollStakePolicyAppendix,
  mentionsBankroll,
} from "../response-plan";
import type { PunditTakePlan, PunditTakeSourcesFooter } from "./types";
import { provenanceBodyFromFooter } from "./take-provenance-voice";

const TAKE_V2_PARLAY_DECLINE =
  "Parlays are outside what I answer here right now; ask for a single-fixture 1X2, totals, or BTTS read instead.";

export function renderParlayDeclineProse(): string {
  return TAKE_V2_PARLAY_DECLINE;
}

export function renderStakeRefusalTakeProse(
  question: string,
  plan: PunditTakePlan,
): string {
  const opener = `${plan.fixtureLabel} — I won't size a stake without a bankroll and a risk band.`;
  const lines = [opener];
  if (mentionsBankroll(question)) {
    lines.push(bankrollStakePolicyAppendix(question));
  } else {
    lines.push(STAKE_REFUSAL_SENTENCE);
  }
  const context = plan.supporting[0]?.text;
  if (context) lines.push(context);
  return lines.join("\n\n");
}

export function renderWinnerGuaranteeTakeProse(plan: PunditTakePlan): string {
  const opener = `${plan.fixtureLabel} — I can't guarantee a winner.`;
  const sides = `${plan.rows.map((row) => `${row.label} ${row.modelPctInt}% (fair ${row.fairDecimal})`).join("; ")}.`;
  return [
    opener,
    sides,
    "Nothing is guaranteed; accas multiply risk.",
    "Gambling can be addictive; 18+ only.",
  ].join("\n\n");
}

export function renderOddsProvenanceTakeProse(
  plan: PunditTakePlan,
  footer: PunditTakeSourcesFooter,
): string {
  return [
    `${plan.fixtureLabel} — where the numbers come from.`,
    provenanceBodyFromFooter(footer),
  ].join("\n\n");
}

export function renderDrawFocusTakeProse(plan: PunditTakePlan, grounding: Grounding): string {
  const drawRow = plan.rows.find((r) => r.outcome === "draw");
  const pct = drawRow?.modelPctInt ?? Math.round(grounding.pDraw * 100);
  const opener = `${plan.fixtureLabel} — the draw at ${pct}%.`;
  const divergence = grounding.marketDivergence[0];
  const drawLeg = divergence?.legs.find((leg) => leg.outcome === "draw");
  const chunks: string[] = [opener];
  if (drawLeg && drawLeg.gapPoints >= 2) {
    chunks.push(`The market prices the draw lower than I do (${Math.round(drawLeg.marketPercent)}% v ${Math.round(drawLeg.modelPercent)}%).`);
  } else if (!divergence) {
    chunks.push("No complete market line on the draw here — these are model-only draw probabilities.");
  }
  const body = plan.supporting[0]?.text;
  if (body) chunks.push(body);
  return chunks.join("\n\n");
}
