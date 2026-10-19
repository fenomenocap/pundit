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
import {
  renderBttsTakeProse,
  renderPassPlayTakeProse,
  renderTotalsTakeProse,
} from "./take-grid-prose";
import { renderTakeProseDeterministic } from "./take-prose";
import { formatTakeOddsTable } from "./take-table";
import { buildTakeSourcesFooter } from "./take-sources";
import { filterUnmappedSentences, validateTakeProseAgainstPlan } from "./take-validate";
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

export function composePunditTakeDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null = null,
): PunditTakeDelivery | null {
  if (!punditTakeApplies(plan, question)) return null;
  const resolvedDossier = resolveTakeDossier(grounding, dossier);
  const planJson = buildPunditTakePlan(grounding, resolvedDossier);
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" : "full";
  let prose: string;
  if (plan.mode === "btts") {
    prose = renderBttsTakeProse(planJson, grounding);
  } else if (plan.mode === "totals") {
    prose = renderTotalsTakeProse(planJson, grounding, asksUnder25Only(question));
  } else if (plan.mode === "user-line" && /\bpass or play\b/i.test(question)) {
    prose = renderPassPlayTakeProse(planJson, grounding) ?? renderTakeProseDeterministic(planJson, variant);
  } else {
    prose = renderTakeProseDeterministic(planJson, variant);
  }
  const mappingErrors = validateTakeProseAgainstPlan(prose, planJson);
  if (mappingErrors.some((e) => e.startsWith("unmapped") || e === "banned-token" || e === "template-line")) {
    prose = filterUnmappedSentences(prose, planJson);
  }
  const includeTable = plan.mode !== "btts" && plan.mode !== "totals"
    && !(plan.mode === "user-line" && /\bpass or play\b/i.test(question));
  const table = includeTable ? formatTakeOddsTable(planJson) : "";
  const answer = table ? `${prose.trim()}\n\n${table}`.trim() : prose.trim();
  return {
    answer,
    plan: planJson,
    sources: buildTakeSourcesFooter(grounding, resolvedDossier),
  };
}
