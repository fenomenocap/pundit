import type { Grounding } from "./ask";
import { buildResponseFacts, type ResponseFact } from "./response-facts";

export interface AnalystDraftPart {
  text: string;
  factIds: string[];
}

export interface AnalystDraft {
  directAnswer: AnalystDraftPart;
  reasoning: AnalystDraftPart[];
  uncertainty?: AnalystDraftPart;
  citedClaims: Array<AnalystDraftPart & { sourceIds: string[] }>;
}

export type AnalystDraftValidation =
  | { valid: true; draft: AnalystDraft; answer: string }
  | { valid: false; reason: string };

const SOURCE_ID = /^S\d{1,3}$/;

export interface AnalystDraftValidationContext {
  /** The evidence bundle's actual IDs for this request. */
  sourceIds?: readonly string[];
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function parsePart(value: unknown, factIds: Set<string>): AnalystDraftPart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = cleanText(record.text, 600);
  if (!text || !Array.isArray(record.factIds) || record.factIds.length > 12) return null;
  const ids = record.factIds.filter((id): id is string => typeof id === "string");
  if (ids.length !== record.factIds.length || ids.some((id) => !factIds.has(id))) return null;
  return { text, factIds: ids };
}

const FACT_SLOT = /\{\{([a-z0-9._-]+)\}\}/gi;

function renderFact(fact: ResponseFact, grounding: Grounding): string {
  if (fact.marketObservation) {
    const source = fact.sourceIds?.[0] ?? "market";
    const direction = fact.marketObservation.gapPoints >= 0 ? "higher" : "lower";
    return `${fact.subject}: my ${(fact.marketObservation.modelProbability * 100).toFixed(1)}%, `
      + `${source} ${(fact.marketObservation.marketProbability * 100).toFixed(1)}%, `
      + `${Math.abs(fact.marketObservation.gapPoints).toFixed(1)} percentage points ${direction}`
      + (fact.observedAt ? ` (observed ${fact.observedAt})` : "");
  }
  if (fact.numeric?.unit === "probability") {
    const probability = `${(fact.numeric.value * 100).toFixed(1)}%`;
    if (fact.kind === "scoreline") {
      const fair = fact.numeric.value > 0 ? (1 / fact.numeric.value).toFixed(2) : null;
      return `${grounding.home} ${fact.subject.replace("-", "–")} ${grounding.away} ${probability}`
        + (fair ? `, fair decimal odds ${fair}` : "");
    }
    return `${fact.subject} ${probability}`;
  }
  return fact.subject;
}

function bindFactSlots(
  part: AnalystDraftPart,
  factsById: Map<string, ResponseFact>,
  grounding: Grounding
): { valid: true; text: string } | { valid: false; reason: string } {
  const slots = [...part.text.matchAll(FACT_SLOT)].map((match) => match[1]);
  if (slots.some((id) => !part.factIds.includes(id) || !factsById.has(id))) {
    return { valid: false, reason: "invalid-fact-slot" };
  }
  const numericalFacts = part.factIds.filter((id) => {
    const fact = factsById.get(id);
    return Boolean(fact?.numeric || fact?.marketObservation);
  });
  if (numericalFacts.some((id) => !slots.includes(id))) {
    return { valid: false, reason: "unbound-numeric-fact" };
  }
  // Numeric match prose is server-rendered exclusively from slots. Cited
  // claims with no response-fact IDs are outside this path and still owe the
  // evidence verifier a real source before delivery.
  const withoutSlots = part.text.replace(FACT_SLOT, "");
  if (numericalFacts.length && /\d+(?:\.\d+)?\s*(?:%|percentage points?|in\s+fair decimal odds|fair decimal odds)/i.test(withoutSlots)) {
    return { valid: false, reason: "free-text-match-number" };
  }
  if (numericalFacts.length) {
    const escapedTeams = [grounding.home, grounding.away]
      .map((team) => team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (new RegExp(`\\b(?:${escapedTeams.join("|")})\\b`, "i").test(withoutSlots)) {
      return { valid: false, reason: "free-text-match-subject" };
    }
    if (/\b(?:because|due to|caused by|reflects?|signals?|line-?up|injur(?:y|ies|ed)|suspension|absent|missing)\b/i.test(withoutSlots)) {
      return { valid: false, reason: "unsupported-causality" };
    }
    if (/\b(?:bet|back|lay|wager|stake|take the price|value is on)\b/i.test(withoutSlots)
      && !/\b(?:not|isn['’]t|is not)\s+(?:a\s+)?(?:bet|wager|recommendation)\b/i.test(withoutSlots)) {
      return { valid: false, reason: "unsupported-recommendation" };
    }
    if (/\b(?:favour(?:ite)?|prefer|likelier|most likely|winner)\b/i.test(withoutSlots)) {
      const referencedProbabilities = numericalFacts
        .map((id) => factsById.get(id))
        .filter((fact) => fact?.kind === "probability" && fact.numeric?.unit === "probability")
        .map((fact) => fact!.numeric!.value);
      const maxOneXTwo = Math.max(grounding.pHome, grounding.pDraw, grounding.pAway);
      if (!referencedProbabilities.some((value) => Math.abs(value - maxOneXTwo) < 1e-9)) {
        return { valid: false, reason: "unsupported-ranking" };
      }
    }
  }
  return {
    valid: true,
    text: part.text.replace(FACT_SLOT, (_slot, id: string) => renderFact(factsById.get(id)!, grounding)),
  };
}

function referencedNumbers(facts: readonly ResponseFact[]): {
  percentages: Set<string>;
  gaps: Set<string>;
  fairDecimalOdds: Set<string>;
} {
  const percentages = new Set<string>();
  const gaps = new Set<string>();
  const fairDecimalOdds = new Set<string>();
  for (const fact of facts) {
    if (fact.numeric?.unit === "probability") {
      percentages.add((fact.numeric.value * 100).toFixed(1));
      if (fact.numeric.value > 0 && fact.allowedClaims.includes("convert-to-fair-decimal-odds")) {
        fairDecimalOdds.add((1 / fact.numeric.value).toFixed(2));
      }
    }
    if (fact.numeric?.unit === "percentage-points") gaps.add(Math.abs(fact.numeric.value).toFixed(1));
    if (fact.marketObservation) {
      percentages.add((fact.marketObservation.modelProbability * 100).toFixed(1));
      percentages.add((fact.marketObservation.marketProbability * 100).toFixed(1));
      gaps.add(Math.abs(fact.marketObservation.gapPoints).toFixed(1));
    }
  }
  return { percentages, gaps, fairDecimalOdds };
}

function partNumbersTrace(part: AnalystDraftPart, factsById: Map<string, ResponseFact>): boolean {
  const referenced = part.factIds
    .map((id) => factsById.get(id))
    .filter((fact): fact is ResponseFact => Boolean(fact));
  const allowed = referencedNumbers(referenced);
  const unitClaims = [...part.text.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*(%|percentage points?)/gi)];
  if (unitClaims.some((claim) => {
    const value = Number(claim[1]).toFixed(1);
    return claim[2] === "%" ? !allowed.percentages.has(value) : !allowed.gaps.has(Math.abs(Number(claim[1])).toFixed(1));
  })) return false;
  const fairClaims = [
    ...part.text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s+(?:in\s+)?fair decimal odds\b/gi),
    ...part.text.matchAll(/\bfair decimal odds(?:\s+of|\s+are|\s+is|:)?\s+(\d+(?:\.\d+)?)/gi),
  ];
  return fairClaims.every((claim) => allowed.fairDecimalOdds.has(Number(claim[1]).toFixed(2)));
}

function partViolatesProhibitions(part: AnalystDraftPart, factsById: Map<string, ResponseFact>): boolean {
  const prohibitions = new Set(part.factIds.flatMap((id) => factsById.get(id)?.prohibitedClaims ?? []));
  if (prohibitions.has("recommend-wager")
    && /\b(?:bet|back|lay|wager|stake|take the price|value is on)\b/i.test(part.text)
    && !/\b(?:not|isn['’]t|is not)\s+(?:a\s+)?(?:bet|wager|recommendation)\b/i.test(part.text)) return true;
  if (prohibitions.has("infer-lineup")
    && /\b(?:line-?up|team news|injur(?:y|ies|ed)|suspension|availability|starts?|benched|absent)\b/i.test(part.text)) return true;
  if (prohibitions.has("infer-cause")
    && /\b(?:because|due to|caused by|reflects?|signals?)\b/i.test(part.text)) return true;
  return false;
}

/** Strict JSON-only parse. Text outside the object is rejected, not repaired. */
export function validateAnalystDraft(
  raw: string,
  grounding: Grounding,
  context: AnalystDraftValidationContext = {}
): AnalystDraftValidation {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { valid: false, reason: "invalid-json" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "invalid-root" };
  }
  const record = value as Record<string, unknown>;
  const factsById = new Map(buildResponseFacts(grounding).facts.map((fact) => [fact.id, fact]));
  const factIds = new Set(factsById.keys());
  const directAnswer = parsePart(record.directAnswer, factIds);
  if (!directAnswer || directAnswer.factIds.length === 0) {
    return { valid: false, reason: "invalid-direct-answer" };
  }
  if (!Array.isArray(record.reasoning) || record.reasoning.length > 4) {
    return { valid: false, reason: "invalid-reasoning" };
  }
  const reasoning = record.reasoning.map((part) => parsePart(part, factIds));
  if (reasoning.some((part) => part === null)) return { valid: false, reason: "invalid-reasoning" };

  let uncertainty: AnalystDraftPart | undefined;
  if (record.uncertainty !== undefined && record.uncertainty !== null) {
    uncertainty = parsePart(record.uncertainty, factIds) ?? undefined;
    if (!uncertainty) return { valid: false, reason: "invalid-uncertainty" };
  }

  if (!Array.isArray(record.citedClaims) || record.citedClaims.length > 6) {
    return { valid: false, reason: "invalid-cited-claims" };
  }
  const citedClaims: AnalystDraft["citedClaims"] = [];
  const availableSourceIds = context.sourceIds ? new Set(context.sourceIds) : null;
  for (const candidate of record.citedClaims) {
    const part = parsePart(candidate, factIds);
    if (!part || !candidate || typeof candidate !== "object") {
      return { valid: false, reason: "invalid-cited-claim" };
    }
    const sourceIds = (candidate as Record<string, unknown>).sourceIds;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.length > 3
      || sourceIds.some((id) => typeof id !== "string" || !SOURCE_ID.test(id)
        || (availableSourceIds !== null && !availableSourceIds.has(id)))) {
      return { valid: false, reason: "invalid-source-ids" };
    }
    citedClaims.push({ ...part, sourceIds: sourceIds as string[] });
  }

  const draft: AnalystDraft = {
    directAnswer,
    reasoning: reasoning as AnalystDraftPart[],
    ...(uncertainty ? { uncertainty } : {}),
    citedClaims,
  };
  const allParts: AnalystDraftPart[] = [directAnswer, ...(reasoning as AnalystDraftPart[]), ...citedClaims];
  if (uncertainty) allParts.push(uncertainty);
  if (allParts.some((part) => !partNumbersTrace(part, factsById))) {
    return { valid: false, reason: "untraceable-number" };
  }
  if (allParts.some((part) => partViolatesProhibitions(part, factsById))) {
    return { valid: false, reason: "prohibited-claim" };
  }
  const boundParts = allParts.map((part) => bindFactSlots(part, factsById, grounding));
  const invalidBoundPart = boundParts.find((part) => !part.valid);
  if (invalidBoundPart && !invalidBoundPart.valid) {
    return { valid: false, reason: invalidBoundPart.reason };
  }
  const renderedByPart = new Map(allParts.map((part, index) => {
    const bound = boundParts[index];
    if (!bound.valid) throw new Error("unreachable invalid fact slot");
    return [part, bound.text] as const;
  }));
  const markedClaims = citedClaims.map((claim) => {
    const markers = claim.sourceIds.map((id) => `[[${id}]]`).join(" ");
    const text = renderedByPart.get(claim) ?? claim.text;
    return /[.!?]$/.test(text)
      ? text.replace(/([.!?])$/, ` ${markers}$1`)
      : `${text} ${markers}.`;
  });
  const answer = [
    renderedByPart.get(draft.directAnswer) ?? draft.directAnswer.text,
    ...draft.reasoning.map((part) => renderedByPart.get(part) ?? part.text),
    ...markedClaims,
    draft.uncertainty ? renderedByPart.get(draft.uncertainty) ?? draft.uncertainty.text : undefined,
  ].filter((part): part is string => Boolean(part)).join("\n\n");
  return { valid: true, draft, answer };
}
