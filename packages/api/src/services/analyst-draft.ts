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
  | { valid: true; draft: AnalystDraft; answer: string; dropped: string[] }
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
  if (fact.numeric?.unit === "decimal-odds") {
    return `${fact.subject} fair decimal odds ${fact.numeric.value.toFixed(2)}`;
  }
  if (fact.numeric?.unit === "ev-fraction") {
    const signed = `${fact.numeric.value >= 0 ? "+" : ""}${(fact.numeric.value * 100).toFixed(2)}%`;
    return `${fact.subject} EV ${signed}`;
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
    if (fact.numeric?.unit === "decimal-odds") {
      fairDecimalOdds.add(fact.numeric.value.toFixed(2));
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
  if (prohibitions.has("present-as-fundamental")) {
    // Consensus slots are allowed only when the prose labels them as
    // consensus. A blacklist alone is too easy to evade with phrases such as
    // "sealed fundamental read" or "my underlying view".
    const labelledAsConsensus = /\bconsensus\b/i.test(part.text);
    const claimsOwnForecast = /\b(?:fundamental|sealed|underlying|(?:the|my) model|my (?:forecast|probabilit(?:y|ies)|1x2|estimate|read|view)|I (?:make|have|rate|give|am at))\b/i.test(part.text);
    if (!labelledAsConsensus || claimsOwnForecast) return true;
  }
  if (prohibitions.has("recommend-wager")
    && /\b(?:bet|back|lay|wager|stake|take the price|value is on)\b/i.test(part.text)
    && !/\b(?:not|isn['’]t|is not)\s+(?:a\s+)?(?:bet|wager|recommendation)\b/i.test(part.text)) return true;
  if (prohibitions.has("infer-lineup")
    && /\b(?:line-?up|team news|injur(?:y|ies|ed)|suspension|availability|starts?|benched|absent)\b/i.test(part.text)) return true;
  if (prohibitions.has("infer-cause")
    && /\b(?:because|due to|caused by|reflects?|signals?)\b/i.test(part.text)) return true;
  return false;
}

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The model's JSON object, wherever it sits. DeepSeek often wraps the draft in
 * a sentence or a mid-text fence ("**Why I pr..." then the object); a strict
 * parse turned each of those into an `invalid-json` rejection and a fallback.
 * Only the container is located here. Every field, fact ID, source ID and
 * numeric check still runs on what comes out, and the surrounding prose is
 * dropped, never published.
 */
function extractDraftObject(raw: string): unknown {
  const unfenced = stripFence(raw);
  const direct = parseJson(unfenced);
  if (direct !== undefined) return direct;
  // The outermost braces from the first `{"` to the last `}`.
  const start = unfenced.search(/\{\s*"/);
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(unfenced.slice(start, end + 1)) : undefined;
}

/**
 * What a rejected draft looked like, for the log: enough to tell prose from
 * near-miss JSON, never enough to reconstruct an answer. Bounded, and it holds
 * no credential -- only the model's own output shape.
 */
export function describeRejectedDraftShape(raw: string, sourceIds: readonly string[] = []): Record<string, unknown> {
  const value = extractDraftObject(raw);
  const shape: Record<string, unknown> = { length: raw.length };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    shape.startsWith = raw.trim().slice(0, 24).replace(/\s+/g, " ");
    shape.hasBraces = raw.includes("{") && raw.includes("}");
    return shape;
  }
  const record = value as Record<string, unknown>;
  shape.keys = Object.keys(record).slice(0, 8);
  const claims = Array.isArray(record.citedClaims) ? record.citedClaims : [];
  const claimed = claims.flatMap((claim) => {
    const ids = (claim as { sourceIds?: unknown } | null)?.sourceIds;
    return Array.isArray(ids) ? ids : [];
  }).map((id) => String(id).slice(0, 12)).slice(0, 8);
  if (claimed.length) {
    shape.citedSourceIds = claimed;
    shape.knownSourceIds = sourceIds.slice(0, 8);
  }
  return shape;
}

/** JSON-only parse. Prose around the object is dropped, not published or repaired. */
export function validateAnalystDraft(
  raw: string,
  grounding: Grounding,
  context: AnalystDraftValidationContext = {}
): AnalystDraftValidation {
  const value = extractDraftObject(raw);
  if (value === undefined) return { valid: false, reason: "invalid-json" };
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
  if (!Array.isArray(record.reasoning)) return { valid: false, reason: "invalid-reasoning" };
  if (!Array.isArray(record.citedClaims)) return { valid: false, reason: "invalid-cited-claims" };

  // Every part is checked on its own, with the same checks as before. A part
  // that fails any of them is dropped and never published; the rest stand. The
  // direct answer is the one part the reader cannot be given without, so its
  // failure still rejects the draft. Rejecting the whole draft for one bad
  // reasoning line sent a reader who had a perfectly good direct answer to the
  // server fallback, and no model measured so far clears every part on every
  // turn.
  const dropped: string[] = [];
  const checkPart = (part: AnalystDraftPart): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!partNumbersTrace(part, factsById)) return { ok: false, reason: "untraceable-number" };
    if (partViolatesProhibitions(part, factsById)) return { ok: false, reason: "prohibited-claim" };
    const bound = bindFactSlots(part, factsById, grounding);
    return bound.valid ? { ok: true, text: bound.text } : { ok: false, reason: bound.reason };
  };

  const rendered = new Map<AnalystDraftPart, string>();
  const directChecked = checkPart(directAnswer);
  if (!directChecked.ok) return { valid: false, reason: directChecked.reason };
  rendered.set(directAnswer, directChecked.text);

  const reasoning: AnalystDraftPart[] = [];
  record.reasoning.slice(0, 4).forEach((candidate) => {
    const part = parsePart(candidate, factIds);
    if (!part) { dropped.push("invalid-reasoning"); return; }
    const checked = checkPart(part);
    if (!checked.ok) { dropped.push(checked.reason); return; }
    rendered.set(part, checked.text);
    reasoning.push(part);
  });
  if (record.reasoning.length > 4) dropped.push("invalid-reasoning");

  let uncertainty: AnalystDraftPart | undefined;
  if (record.uncertainty !== undefined && record.uncertainty !== null) {
    const part = parsePart(record.uncertainty, factIds);
    const checked = part ? checkPart(part) : null;
    if (part && checked?.ok) {
      uncertainty = part;
      rendered.set(part, checked.text);
    } else {
      dropped.push(checked && !checked.ok ? checked.reason : "invalid-uncertainty");
    }
  }

  const citedClaims: AnalystDraft["citedClaims"] = [];
  const availableSourceIds = context.sourceIds ? new Set(context.sourceIds) : null;
  record.citedClaims.slice(0, 6).forEach((candidate) => {
    const part = parsePart(candidate, factIds);
    if (!part || !candidate || typeof candidate !== "object") { dropped.push("invalid-cited-claim"); return; }
    const sourceIds = (candidate as Record<string, unknown>).sourceIds;
    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.length > 3
      || sourceIds.some((id) => typeof id !== "string" || !SOURCE_ID.test(id)
        || (availableSourceIds !== null && !availableSourceIds.has(id)))) {
      dropped.push("invalid-source-ids");
      return;
    }
    const checked = checkPart(part);
    if (!checked.ok) { dropped.push(checked.reason); return; }
    const claim = { ...part, sourceIds: sourceIds as string[] };
    rendered.set(claim, checked.text);
    citedClaims.push(claim);
  });
  if (record.citedClaims.length > 6) dropped.push("invalid-cited-claims");

  const draft: AnalystDraft = {
    directAnswer,
    reasoning,
    ...(uncertainty ? { uncertainty } : {}),
    citedClaims,
  };
  const markedClaims = citedClaims.map((claim) => {
    const markers = claim.sourceIds.map((id) => `[[${id}]]`).join(" ");
    const text = rendered.get(claim) ?? claim.text;
    return /[.!?]$/.test(text)
      ? text.replace(/([.!?])$/, ` ${markers}$1`)
      : `${text} ${markers}.`;
  });
  const answer = [
    rendered.get(directAnswer),
    ...reasoning.map((part) => rendered.get(part)),
    ...markedClaims,
    uncertainty ? rendered.get(uncertainty) : undefined,
  ].filter((part): part is string => Boolean(part)).join("\n\n");
  return { valid: true, draft, answer, dropped };
}

/** Malformed draft envelopes and fact slots are never publishable prose. */
export function containsAnalystDraftSyntax(raw: string): boolean {
  return /\{\{[^}\n]+\}\}|"(?:directAnswer|factIds|citedClaims)"\s*:/.test(raw);
}

/**
 * Team-news drafts often bind unused numeric fact IDs and fail as a whole.
 * Cited claim text is still the only current-world payload worth keeping.
 */
export function salvageCitedClaimProse(
  raw: string,
  sourceIds: readonly string[] = []
): string | null {
  const value = extractDraftObject(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claims = (value as { citedClaims?: unknown }).citedClaims;
  if (!Array.isArray(claims) || claims.length === 0) return null;
  const allowed = new Set(sourceIds);
  const lines: string[] = [];
  for (const candidate of claims) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { text?: unknown; sourceIds?: unknown };
    const text = typeof record.text === "string"
      ? record.text.trim().replace(/\{\{[^}]+\}\}/g, "").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim()
      : "";
    if (!text || !Array.isArray(record.sourceIds)) continue;
    const ids = record.sourceIds.filter((id): id is string =>
      typeof id === "string" && SOURCE_ID.test(id) && (allowed.size === 0 || allowed.has(id))
    );
    if (!ids.length) continue;
    const markers = ids.map((id) => `[[${id}]]`).join(" ");
    lines.push(/[.!?]$/.test(text) ? text.replace(/([.!?])$/, ` ${markers}$1`) : `${text} ${markers}.`);
  }
  return lines.length ? lines.join(" ") : null;
}
