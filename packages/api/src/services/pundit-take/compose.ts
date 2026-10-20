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
import { gridHeadlineOpener } from "./take-headline";
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
import { appendWhatFlipsItClosing, formatWhatFlipsItSentence } from "./take-flip-prose";
import { dedupePolicyProseBlocks } from "./take-v2-prose-hygiene";
import {
  asksDrawSideTakeQuestion,
  asksMatchWhyTakeQuestion,
  asksTakeV2PolicyPrompt,
  asksWhatFlipsItQuestion,
  punditTakeV2AppliesToPlan,
} from "./take-routing";
import { applyV2TakeProseGuards } from "./take-number-check";
import { postCheckTakeProse, scrubForbiddenTakeProse } from "./take-validate";
import type { PunditTakeDelivery } from "./types";

export const PUNDIT_TAKE_V2_COMPOSE_TIMEOUT_MS = 30_000;

function isTakeV2Mode(plan: ResponsePlan, question: string): boolean {
  if (asksTakeV2PolicyPrompt(question)) return true;
  if (punditTakeV2AppliesToPlan(plan, question)) return true;
  if (asksParlayQuestion(question)) return true;
  if (plan.mode === "stake-refusal") return true;
  if (plan.mode === "winner-guarantee-honesty") return true;
  if (plan.mode === "odds-provenance") return true;
  if (asksDrawSideTakeQuestion(question)) return true;
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

function shouldAppendFlipClosing(question: string, plan: ResponsePlan): boolean {
  if (asksParlayQuestion(question)) return false;
  if (plan.mode === "stake-refusal") return false;
  if (plan.mode === "winner-guarantee-honesty") return false;
  if (plan.mode === "odds-provenance") return false;
  return true;
}

function minimalHeadlineAndFlip(
  planJson: ReturnType<typeof buildPunditTakePlan>,
  question: string,
  grounding: Grounding,
): string {
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" as const : "full";
  const headline = gridHeadlineOpener(planJson, variant)
    ?? (planJson.gridCall
      ? `${planJson.fixtureLabel} — ${planJson.gridCall.headlineLabel} at ${planJson.gridCall.modelPctInt}%.`
      : minimalV2Headline(planJson, question));
  const flip = formatWhatFlipsItSentence(planJson, grounding);
  if (!flip) return headline;
  return `${headline}\n\n${flip}`.trim();
}

function ensureGridMarketHeadline(
  prose: string,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  question: string,
): string {
  if (!planJson.gridCall) return prose.trim();
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" as const : "full";
  const headline = gridHeadlineOpener(planJson, variant)
    ?? `${planJson.fixtureLabel} — ${planJson.gridCall.headlineLabel} at ${planJson.gridCall.modelPctInt}%.`;
  const trimmed = prose.trim();
  if (!trimmed) return headline;
  const escaped = planJson.fixtureLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escaped}\\s*[—-]`).test(trimmed)) return trimmed;
  return `${headline}\n\n${trimmed}`.trim();
}

function assembleDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  planJson: ReturnType<typeof buildPunditTakePlan>,
  prose: string,
  resolvedDossier: MatchDossier | null,
  options?: {
    includeTable?: boolean;
    prosePostCheck?: "full" | "forbidden" | "none";
    deterministicPath?: boolean;
  },
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
  let proseOut = dedupePolicyProseBlocks(prose.trim());
  if (!asksParlayQuestion(question)) {
    if (shouldAppendFlipClosing(question, plan)) {
      proseOut = appendWhatFlipsItClosing(planJson, proseOut, grounding);
    }
    if (postCheckMode === "full") {
      proseOut = postCheckTakeProse(proseOut, planJson);
    } else if (postCheckMode === "forbidden") {
      proseOut = applyV2TakeProseGuards(scrubForbiddenTakeProse(proseOut), planJson);
    }
    if (shouldAppendFlipClosing(question, plan)) {
      const beforeHeadlineFix = proseOut.trim();
      proseOut = ensureGridMarketHeadline(proseOut, planJson, question);
      if (options?.deterministicPath && !beforeHeadlineFix && proseOut.trim()) {
        proseOut = appendWhatFlipsItClosing(planJson, proseOut, grounding);
      }
    }
  }
  if (!proseOut.trim() && !asksParlayQuestion(question)) {
    if (options?.deterministicPath) {
      proseOut = minimalHeadlineAndFlip(planJson, question, grounding);
    } else {
      proseOut = postCheckTakeProse(
        renderTakeProseDeterministic(planJson, /\bwhy\b/i.test(question.trim()) ? "why" : "full", grounding),
        planJson,
      ) || minimalV2Headline(planJson, question);
    }
  }
  const answer = asksParlayQuestion(question)
    ? (footer ? `${proseOut.trim()}\n\n${footer}`.trim() : proseOut.trim())
    : assembleV2AnswerBody(proseOut, planJson, question, table, footer, grounding);
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
  resolvedDossier: MatchDossier | null,
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
    const footer = buildTakeSourcesFooter(grounding, resolvedDossier, Date.now());
    return { prose: renderOddsProvenanceTakeProse(planJson, footer), includeTable: false };
  }
  if (asksDrawSideTakeQuestion(question)) {
    return { prose: renderDrawFocusTakeProse(planJson, grounding), includeTable: true };
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
  let prose = renderTakeProseDeterministic(planJson, variant, grounding, { appendFlip: false });
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
  const policy = resolvePolicyProse(question, grounding, plan, planJson, resolvedDossier);
  if (policy) {
    const policyPostCheck =
      plan.mode === "odds-provenance" || plan.mode === "winner-guarantee-honesty"
        ? "none"
        : "forbidden";
    return assembleDelivery(question, grounding, plan, planJson, policy.prose, resolvedDossier, {
      includeTable: policy.includeTable,
      prosePostCheck: policyPostCheck,
    });
  }
  const prose = composeTakeProseDeterministic(question, grounding, plan, planJson, variant);
  const delivery = assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier, {
    deterministicPath: true,
  });
  if (!delivery.answer.trim()) {
    return composeMinimalTakeDelivery(question, grounding, plan, dossier);
  }
  return delivery;
}

function composeMinimalTakeDelivery(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null,
): PunditTakeDelivery | null {
  if (!punditTakeApplies(plan, question)) return null;
  const resolvedDossier = resolveTakeDossier(grounding, dossier);
  const underFocus = asksUnder25Only(question);
  const planJson = buildPunditTakePlan(grounding, resolvedDossier, {
    marketKind: marketKindForPlan(plan),
    underFocus,
  });
  const headline = minimalV2Headline(planJson, question);
  return assembleDelivery(question, grounding, plan, planJson, headline, resolvedDossier, {
    prosePostCheck: "none",
  });
}

async function composePunditTakeDeliveryAsyncInner(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null,
): Promise<PunditTakeDelivery | null> {
  if (!punditTakeApplies(plan, question)) return null;
  const resolvedDossier = resolveTakeDossier(grounding, dossier);
  const underFocus = asksUnder25Only(question);
  const planJson = buildPunditTakePlan(grounding, resolvedDossier, {
    marketKind: marketKindForPlan(plan),
    underFocus,
  });
  const variant = /\bwhy\b/i.test(question.trim()) ? "why" : "full";
  const policy = resolvePolicyProse(question, grounding, plan, planJson, resolvedDossier);
  if (policy) {
    const policyPostCheck =
      plan.mode === "odds-provenance" || plan.mode === "winner-guarantee-honesty"
        ? "none"
        : "forbidden";
    return assembleDelivery(question, grounding, plan, planJson, policy.prose, resolvedDossier, {
      includeTable: policy.includeTable,
      prosePostCheck: policyPostCheck,
    });
  }
  const passPlay = plan.mode === "user-line" && /\b(?:pass or play|play or pass)\b/i.test(question);
  const fairOdds = asksFairOddsFixtureQuestion(question);
  const deterministicOnly = passPlay || fairOdds;
  const prose = deterministicOnly
    ? composeTakeProseDeterministic(question, grounding, plan, planJson, variant)
    : postCheckTakeProse(await renderTakeProse(planJson, variant), planJson);
  return assembleDelivery(question, grounding, plan, planJson, prose, resolvedDossier, {
    deterministicPath: deterministicOnly,
  });
}

export async function composePunditTakeDeliveryAsync(
  question: string,
  grounding: Grounding,
  plan: ResponsePlan,
  dossier: MatchDossier | null = null,
): Promise<PunditTakeDelivery | null> {
  if (!punditTakeApplies(plan, question)) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), PUNDIT_TAKE_V2_COMPOSE_TIMEOUT_MS);
  });
  const composed = composePunditTakeDeliveryAsyncInner(question, grounding, plan, dossier);
  const result = await Promise.race([composed, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result === "timeout") {
    return composeMinimalTakeDelivery(question, grounding, plan, dossier);
  }
  if (result?.answer.trim()) return result;
  return composeMinimalTakeDelivery(question, grounding, plan, dossier);
}
