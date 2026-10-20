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
import { asksFairOddsFixtureQuestion, renderFairOddsTakeProse } from "./take-fair-odds-prose";
import { appendWhatFlipsItClosing } from "./take-flip-prose";
import { postCheckTakeProse } from "./take-validate";
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
  if (plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question)) return true;
  if (plan.mode === "market-comparison") return true;
  if (asksFairOddsFixtureQuestion(question)) return true;
  if (plan.mode === "fair-price" && !/\d{1,2}\s*-\s*\d{1,2}/.test(question)) return true;
  if (plan.mode === "pricing-desk" && asksFairOddsFixtureQuestion(question)) return true;
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
  const passPlay = plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question);
  const includeTable = options?.includeTable ?? !asksParlayQuestion(question);
  const table = !includeTable
    ? ""
    : passPlay
      ? formatPassPlayLineTable(grounding)
      : formatTakeOddsTable(planJson);
  const sources = buildTakeSourcesFooter(grounding, resolvedDossier, Date.now());
  const footer = formatTakeSourcesFooterBlock(sources);
  const proseWithFlip = asksParlayQuestion(question)
    ? prose.trim()
    : appendWhatFlipsItClosing(planJson, prose, grounding);
  const body = table ? `${proseWithFlip.trim()}\n\n${table}`.trim() : proseWithFlip.trim();
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
  if (asksFairOddsFixtureQuestion(question)) {
    return { prose: renderFairOddsTakeProse(planJson, grounding), includeTable: true };
  }
  return null;
}

function composeTakeProseDeterministic(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  variant: "full" | "why",
): string {
  const passPlay = plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question);
  if (passPlay) {
    return renderPassPlayTakeProse(planJson, grounding)
      ?? renderTakeProseDeterministic(planJson, variant, grounding);
  }
  let prose = renderTakeProseDeterministic(planJson, variant, grounding);
  prose = postCheckTakeProse(prose, planJson);
  return prose;
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
  const prose = composeTakeProseDeterministic(question, grounding, plan, planJson, variant);
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
  const passPlay = plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question);
  const fairOdds = asksFairOddsFixtureQuestion(question);
  const prose = passPlay || fairOdds
    ? composeTakeProseDeterministic(question, grounding, plan, planJson, variant)
    : postCheckTakeProse(await renderTakeProse(planJson, variant), planJson);
  return assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier);
}
