import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import {
  asksFixturePriceBoard,
  asksMatchWinnerQuestion,
  asksOddsBoard,
  asksParlayQuestion,
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
import { buildTakeSourcesFooter, formatTakeSourcesFooterBlock } from "./take-sources";
import {
  renderDrawFocusTakeProse,
  renderOddsProvenanceTakeProse,
  renderParlayDeclineProse,
  renderStakeRefusalTakeProse,
  renderWinnerGuaranteeTakeProse,
} from "./take-policy-prose";
import { postCheckTakeProse, TAKE_AUDIT_SPEAK_PATTERN, TAKE_PROSE_BANNED_PATTERN } from "./take-validate";
import type { PunditTakeDelivery } from "./types";

function isTakeV2Mode(plan: ResponsePlan, question: string): boolean {
  if (asksParlayQuestion(question)) return true;
  if (plan.mode === "stake-refusal") return true;
  if (plan.mode === "winner-guarantee-honesty") return true;
  if (plan.mode === "odds-provenance") return true;
  if (/\b(?:what about|how about)\b/i.test(question) && /\b(?:the )?draw\b/i.test(question)) {
    return true;
  }
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
  options?: { includeTable?: boolean },
): PunditTakeDelivery {
  const passPlay = plan.mode === "user-line" && /\bpass or play\b/i.test(question);
  const includeTable = options?.includeTable ?? !asksParlayQuestion(question);
  const table = !includeTable
    ? ""
    : passPlay
      ? formatPassPlayLineTable(grounding)
      : formatTakeOddsTable(planJson);
  const sources = buildTakeSourcesFooter(grounding, resolvedDossier);
  const footer = formatTakeSourcesFooterBlock(sources);
  const body = table ? `${prose.trim()}\n\n${table}`.trim() : prose.trim();
  const answer = footer ? `${body}\n\n${footer}`.trim() : body;
  return {
    answer,
    plan: planJson,
    sources,
  };
}

function resolvePolicyProse(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  planJson: ReturnType<typeof buildPunditTakePlan>,
): { prose: string; includeTable: boolean } | null {
  if (asksParlayQuestion(question)) {
    return { prose: renderParlayDeclineProse(), includeTable: false };
  }
  if (plan.mode === "stake-refusal") {
    return { prose: renderStakeRefusalTakeProse(question, planJson), includeTable: true };
  }
  if (plan.mode === "winner-guarantee-honesty") {
    return { prose: renderWinnerGuaranteeTakeProse(planJson), includeTable: false };
  }
  if (plan.mode === "odds-provenance") {
    return { prose: renderOddsProvenanceTakeProse(grounding), includeTable: false };
  }
  if (/\b(?:what about|how about)\b/i.test(question) && /\b(?:the )?draw\b/i.test(question)) {
    return { prose: renderDrawFocusTakeProse(planJson, grounding), includeTable: true };
  }
  return null;
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
  const policy = resolvePolicyProse(question, grounding, plan, planJson);
  if (policy) {
    return assembleDelivery(question, grounding, plan, planJson, policy.prose, resolvedDossier, {
      includeTable: policy.includeTable,
    });
  }
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
  const policy = resolvePolicyProse(question, grounding, plan, planJson);
  if (policy) {
    return assembleDelivery(question, grounding, plan, planJson, policy.prose, resolvedDossier, {
      includeTable: policy.includeTable,
    });
  }
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
