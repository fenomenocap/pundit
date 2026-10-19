import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import {
  asksFixturePriceBoard,
  asksMatchWinnerQuestion,
  asksOddsBoard,
  asksUnder25Only,
  type ResponsePlan,
} from "../response-plan";
import { resolveTakeDossier } from "./take-dossier";
import { buildPunditTakePlan } from "./take-plan";
import { renderPassPlayTakeProse } from "./take-grid-prose";
import { renderTakeProse } from "./take-llm";
import { renderTakeProseDeterministic } from "./take-prose";
import { formatPassPlayLineTable } from "./take-pass-play-table";
import { formatTakeOddsTable } from "./take-table";
import { buildTakeSourcesFooter } from "./take-sources";
import { postCheckTakeProse, TAKE_AUDIT_SPEAK_PATTERN, TAKE_PROSE_BANNED_PATTERN } from "./take-validate";
import type { PunditTakeDelivery } from "./types";

function isTakeV2Mode(plan: ResponsePlan, question: string): boolean {
  if (plan.mode === "totals" || plan.mode === "btts") return true;
  if (plan.mode === "user-line" && /\bpass or play\b/i.test(question)) return true;
  if (plan.mode === "market-comparison") return true;
  if (plan.mode === "fair-price" && !/\d{1,2}\s*-\s*\d{1,2}/.test(question)) return true;
  if (plan.mode === "pricing-desk") {
    return asksMatchWinnerQuestion(question)
      || asksFixturePriceBoard(question)
      || asksOddsBoard(question)
      || /\b1x2\b/i.test(question);
  }
  if (plan.mode === "priced-why" && /\bwhy\b/i.test(question.trim())) return true;
  if (plan.mode === "match-follow-up") {
    if (/\bwhy\b/i.test(question)) return true;
    if (/\b1x2\b/i.test(question)) return true;
  }
  return false;
}

export function punditTakeApplies(plan: ResponsePlan, question: string): boolean {
  return isTakeV2Mode(plan, question);
}

function marketKindForPlan(plan: ResponsePlan): "1x2" | "btts" | "totals" {
  if (plan.mode === "btts") return "btts";
  if (plan.mode === "totals") return "totals";
  return "1x2";
}

function assembleDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  prose: string,
  resolvedDossier: MatchDossier | null,
): PunditTakeDelivery {
  const passPlay = plan.mode === "user-line" && /\bpass or play\b/i.test(question);
  const table = passPlay
    ? formatPassPlayLineTable(grounding)
    : formatTakeOddsTable(planJson);
  const answer = table ? `${prose.trim()}\n\n${table}`.trim() : prose.trim();
  return {
    answer,
    plan: planJson,
    sources: buildTakeSourcesFooter(grounding, resolvedDossier),
  };
}

export function composePunditTakeDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null = null,
): PunditTakeDelivery | null {
  if (!punditTakeApplies(plan, question)) return null;
  const resolvedDossier = resolveTakeDossier(grounding, dossier);
  const underFocus = asksUnder25Only(question);
  const planJson = buildPunditTakePlan(grounding, resolvedDossier, {
    marketKind: marketKindForPlan(plan),
    underFocus,
  });
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" : "full";
  const passPlay = plan.mode === "user-line" && /\bpass or play\b/i.test(question);
  let prose: string;
  if (passPlay) {
    prose = renderPassPlayTakeProse(planJson, grounding) ?? renderTakeProseDeterministic(planJson, variant);
    if (TAKE_PROSE_BANNED_PATTERN.test(prose) || TAKE_AUDIT_SPEAK_PATTERN.test(prose)) {
      prose = renderPassPlayTakeProse(planJson, grounding) ?? renderTakeProseDeterministic(planJson, variant);
    }
  } else {
    prose = renderTakeProseDeterministic(planJson, variant);
    prose = postCheckTakeProse(prose, planJson);
  }
  return assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier);
}

export async function composePunditTakeDeliveryAsync(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null = null,
): Promise<PunditTakeDelivery | null> {
  if (!punditTakeApplies(plan, question)) return null;
  const resolvedDossier = resolveTakeDossier(grounding, dossier);
  const underFocus = asksUnder25Only(question);
  const planJson = buildPunditTakePlan(grounding, resolvedDossier, {
    marketKind: marketKindForPlan(plan),
    underFocus,
  });
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" : "full";
  const passPlay = plan.mode === "user-line" && /\bpass or play\b/i.test(question);
  let prose: string;
  if (passPlay) {
    prose = renderPassPlayTakeProse(planJson, grounding) ?? await renderTakeProse(planJson, variant);
    if (TAKE_PROSE_BANNED_PATTERN.test(prose) || TAKE_AUDIT_SPEAK_PATTERN.test(prose)) {
      prose = renderPassPlayTakeProse(planJson, grounding) ?? await renderTakeProse(planJson, variant);
    }
  } else {
    prose = await renderTakeProse(planJson, variant);
    prose = postCheckTakeProse(prose, planJson);
  }
  return assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier);
}
