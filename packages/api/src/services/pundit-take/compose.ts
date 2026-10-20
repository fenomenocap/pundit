import type { Grounding } from "../ask";
import type { MatchDossier } from "../match-dossier/types";
import {
  asksFixturePriceBoard,
  asksHonestWinnerGuarantee,
  asksMatchWinnerQuestion,
  asksOddsBoard,
  asksOddsProvenance,
  asksParlayQuestion,
  asksUnder25Only,
  type ResponsePlan,
} from "../response-plan";
import { resolveTakeDossier } from "./take-dossier";
import { buildPunditTakePlan } from "./take-plan";
import { allowsCoinFlipLanguage, gridHeadlineOpener } from "./take-headline";
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
import {
  asksDrawSideTakeQuestion,
  asksMatchWhyTakeQuestion,
  asksWhatFlipsItQuestion,
  punditTakeV2AppliesToPlan,
} from "./take-routing";
import { applyFinalProseGuards } from "./take-prose-number-guard";
import { postCheckTakeProse, scrubForbiddenTakeProse } from "./take-validate";
import type { PunditTakeDelivery } from "./types";

const TAKE_COMPOSE_LLM_TIMEOUT_MS = 30_000;

async function withTakeComposeTimeout<T>(promise: Promise<T>, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), TAKE_COMPOSE_LLM_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTakeV2Mode(plan: ResponsePlan, question: string): boolean {
  if (punditTakeV2AppliesToPlan(plan, question)) return true;
  if (asksHonestWinnerGuarantee(question)) return true;
  if (asksOddsProvenance(question)) return true;
  if (asksDrawSideTakeQuestion(question)) return true;
  if (asksParlayQuestion(question)) return true;
  if (plan.mode === "stake-refusal") return true;
  if (plan.mode === "winner-guarantee-honesty") return true;
  if (plan.mode === "odds-provenance") return true;
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
  if (asksMatchWhyTakeQuestion(question, plan)) return true;
  if (plan.mode === "match-follow-up") {
    if (/\bwhy\b/i.test(question)) return true;
    if (/\b1x2\b/i.test(question)) return true;
  }
  return false;
}

export function punditTakeApplies(plan: ResponsePlan, question: string): boolean {
  return isTakeV2Mode(plan, question);
}

function minimalV2Headline(
  planJson: ReturnType<typeof buildPunditTakePlan>,
  question: string,
): string {
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" as const : "full";
  return gridHeadlineOpener(planJson, variant)
    ?? `${planJson.fixtureLabel} — ${planJson.call.headlineLabel}.`;
}

function assembleV2AnswerBody(
  proseOut: string,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  question: string,
  table: string,
  footer: string,
  grounding: Grounding,
): string {
  let prose = proseOut.trim();
  if (!prose) {
    prose = renderTakeProseDeterministic(
      planJson,
      /\bwhy\b/i.test(question.trim()) ? "why" : "full",
      grounding,
    ).trim() || minimalV2Headline(planJson, question);
  }
  const body = table ? `${prose}\n\n${table}`.trim() : prose;
  const withFooter = footer ? `${body}\n\n${footer}`.trim() : body;
  if (withFooter.trim()) return withFooter;
  const headline = minimalV2Headline(planJson, question);
  const fallbackBody = table ? `${headline}\n\n${table}`.trim() : headline;
  return footer ? `${fallbackBody}\n\n${footer}`.trim() : fallbackBody;
}

function marketKindForPlan(plan: ResponsePlan): "1x2" | "btts" | "totals" {
  if (plan.mode === "btts") return "btts";
  if (plan.mode === "totals") return "totals";
  return "1x2";
}

function finalizeProseBlock(
  proseOut: string,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  grounding: Grounding,
  question: string,
): string {
  let prose = applyFinalProseGuards(
    proseOut.trim(),
    planJson,
    grounding,
    allowsCoinFlipLanguage(planJson, grounding),
  );
  if (!prose.trim()) {
    prose = minimalV2Headline(planJson, question);
  }
  return prose;
}

function assembleDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  prose: string,
  resolvedDossier: MatchDossier | null,
  options?: { includeTable?: boolean; prosePostCheck?: "full" | "forbidden" | "none" },
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
  const postCheckMode = options?.prosePostCheck ?? (passPlay ? "forbidden" : "full");
  let proseOut = prose.trim();
  if (!asksParlayQuestion(question)) {
    proseOut = appendWhatFlipsItClosing(planJson, proseOut, grounding);
    if (postCheckMode === "full") {
      proseOut = postCheckTakeProse(proseOut, planJson);
    } else if (postCheckMode === "forbidden") {
      proseOut = scrubForbiddenTakeProse(proseOut);
    }
  }
  if (!proseOut.trim() && !asksParlayQuestion(question)) {
    proseOut = postCheckTakeProse(
      renderTakeProseDeterministic(planJson, /\bwhy\b/i.test(question.trim()) ? "why" : "full", grounding),
      planJson,
    ) || minimalV2Headline(planJson, question);
  }
  proseOut = finalizeProseBlock(proseOut, planJson, grounding, question);
  const answer = asksParlayQuestion(question)
    ? (footer ? `${proseOut.trim()}\n\n${footer}`.trim() : proseOut.trim())
    : assembleV2AnswerBody(proseOut, planJson, question, table, footer, grounding);
  return {
    answer: answer.trim() || assembleV2AnswerBody(minimalV2Headline(planJson, question), planJson, question, table, footer, grounding),
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
  if (asksHonestWinnerGuarantee(question) || plan.mode === "winner-guarantee-honesty") {
    return { prose: renderWinnerGuaranteeTakeProse(planJson), includeTable: false };
  }
  if (asksOddsProvenance(question) || plan.mode === "odds-provenance") {
    return { prose: renderOddsProvenanceTakeProse(grounding), includeTable: false };
  }
  if (asksDrawSideTakeQuestion(question)) {
    return { prose: renderDrawFocusTakeProse(planJson, grounding), includeTable: true };
  }
  if (plan.mode === "stake-refusal") {
    return { prose: renderStakeRefusalTakeProse(question, planJson), includeTable: true };
  }
  if (asksWhatFlipsItQuestion(question)) {
    return null;
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
      prosePostCheck: "forbidden",
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
      prosePostCheck: "forbidden",
    });
  }
  const passPlay = plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question);
  const fairOdds = asksFairOddsFixtureQuestion(question);
  const fallback = () => composeTakeProseDeterministic(question, grounding, plan, planJson, variant);
  const prose = passPlay || fairOdds
    ? fallback()
    : await withTakeComposeTimeout(
      renderTakeProse(planJson, variant).then((raw) => postCheckTakeProse(raw, planJson)),
      fallback,
    );
  return assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier);
}
