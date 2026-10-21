import type { Grounding } from "../ask";
import type { PunditTakePlan, TakePlanPoint } from "./types";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

const BROKEN_MODEL_SCRUB =
  /\bAccording to I\b|\baccording to I\b|\bI's \w+\b|\bI trust I\b|\bOur our\b|\bour our\b/i;

const THESE_NUMBERS_SINGULAR_VERB =
  /\bthese numbers (?:is|was|has|does|sees|goes|says|looks|feels|suggests|shows|finds|thinks|expects)\b/i;

export function capitalizeTakeProse(prose: string): string {
  return prose
    .split("\n\n")
    .map((block) => block
      .split(SENTENCE_SPLIT)
      .map((sentence) => {
        const trimmed = sentence.trim();
        if (!trimmed) return trimmed;
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      })
      .filter(Boolean)
      .join(" "))
    .filter(Boolean)
    .join("\n\n");
}

function capitalizeSentenceStartsInText(text: string): string {
  return text
    .split(SENTENCE_SPLIT)
    .map((sentence) => {
      const trimmed = sentence.trim();
      if (!trimmed) return trimmed;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    })
    .filter(Boolean)
    .join(" ");
}

function isSentenceStart(text: string, offset: number): boolean {
  if (offset === 0) return true;
  return /[.!?]\s*$/.test(text.slice(0, offset));
}

function modelPossessivePhrase(noun: string, offset: number, whole: string): string {
  const atStart = isSentenceStart(whole, offset);
  const before = whole.slice(0, offset);
  const midClause = /,\s*(?:and|but|or|so|yet)\s*$/i.test(before);
  const phrase = `my ${noun.toLowerCase()}`;
  if (atStart && !midClause) {
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }
  return phrase;
}

export function scrubMyModelPhrasing(text: string): string {
  let out = text.trim().replace(/\s+/g, " ");
  out = out.replace(
    /\bmy model's ([a-z]+)\b/gi,
    (_match, noun: string, offset) => modelPossessivePhrase(noun, offset, out),
  );
  return out
    .replace(/\bmy model expects\b/gi, "I expect")
    .replace(/\bmy model\b/gi, "I")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Dossier last-5 is all venues — never imply a venue split in form copy. */
export function normalizeFormScopeInText(text: string): string {
  return text
    .replace(/\bat this venue stretch\b/gi, "across all venues")
    .replace(/\bat this venue\b/gi, "across all venues")
    .replace(
      /\b(last \d+ league games)(?! \(all venues\))/gi,
      "$1 (all venues)",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Ban "model" in user-facing take prose (table/footer may still say Model). */
export function scrubModelWordFromProse(text: string): string {
  const original = text.trim().replace(/\s+/g, " ");
  if (!original) return original;

  let out = original
    .replace(/\baccording to the model\b/gi, (match, offset) => {
      const repl = "by my numbers";
      return isSentenceStart(original, offset)
        ? repl.charAt(0).toUpperCase() + repl.slice(1)
        : repl;
    })
    .replace(/\b(?:I )?trust the model\b/gi, (match, offset) => {
      const hasI = /^I /i.test(match);
      const repl = hasI ? "I trust these numbers" : "trust these numbers";
      return isSentenceStart(original, offset)
        ? repl.charAt(0).toUpperCase() + repl.slice(1)
        : repl;
    })
    .replace(/\bour model-only totals\b/gi, "our totals")
    .replace(/\bmodel-only totals\b/gi, "totals")
    .replace(/\bmodel-only\b/gi, "")
    .replace(/\bthe model expects\b/gi, "I expect")
    .replace(/\bthe model thinks\b/gi, "I think")
    .replace(/\bthe model has\b/gi, "I have")
    .replace(/\bthe model rates\b/gi, "I rate")
    .replace(/\bthe model is\b/gi, "I am")
    .replace(/\bthe model was\b/gi, "I was")
    .replace(/\bthe model sees\b/gi, "I see")
    .replace(/\bthe model saw\b/gi, "I saw");

  out = out.replace(
    /\bthe model's ([a-z]+)\b/gi,
    (_match, noun: string, offset) => modelPossessivePhrase(noun, offset, out),
  );
  out = out
    .replace(/\bthe model\b/gi, "these numbers")
    .replace(/\bmodel\b/gi, "read");

  out = out
    .replace(/\bthese numbers is\b/gi, "these numbers are")
    .replace(/\bThese numbers is\b/g, "These numbers are")
    .replace(/\bthese numbers was\b/gi, "these numbers were")
    .replace(/\bThese numbers was\b/g, "These numbers were")
    .replace(/\bthese numbers has\b/gi, "these numbers have")
    .replace(/\bthese numbers does\b/gi, "these numbers do")
    .replace(/\bthese numbers sees\b/gi, "these numbers see")
    .replace(/\bthese numbers goes\b/gi, "these numbers go")
    .replace(/\bthese numbers says\b/gi, "these numbers say")
    .replace(/\bthese numbers looks\b/gi, "these numbers look")
    .replace(/\bthese numbers feels\b/gi, "these numbers feel")
    .replace(/\bthese numbers suggests\b/gi, "these numbers suggest")
    .replace(/\bthese numbers shows\b/gi, "these numbers show")
    .replace(/\bthese numbers finds\b/gi, "these numbers find")
    .replace(/\bthese numbers thinks\b/gi, "these numbers think")
    .replace(/\bthese numbers expects\b/gi, "these numbers expect")
    .replace(/\bI thinks\b/gi, "I think")
    .replace(/\bI rates\b/gi, "I rate")
    .replace(/\bI has\b/gi, "I have")
    .replace(/\bOur our\b/gi, "Our")
    .replace(/\bour our\b/gi, "our")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();

  if (BROKEN_MODEL_SCRUB.test(out) || THESE_NUMBERS_SINGULAR_VERB.test(out)) return original;
  return out;
}

/** Remove dangling "find the net even." fragments anywhere in prose (mid-paragraph or end). */
export function repairIncompleteEvenClause(text: string): string {
  const repaired = text.replace(/(\bfind the net)\s+even\./gi, "$1.");
  return repaired
    .split(SENTENCE_SPLIT)
    .map((sentence) => {
      const trimmed = sentence.trim().replace(/\s+/g, " ");
      if (!trimmed) return trimmed;
      if (/\bfind the net even\.\s*$/i.test(trimmed)) {
        return trimmed.replace(/\s+even\.\s*$/i, ".").trim();
      }
      const dangling = trimmed.match(/^(.*?\bfind the net)\s+even(?:\s+when|\s+if|\s+though|\s+the|\s+I)?[^.!?]*$/i);
      if (dangling?.[1]) return `${dangling[1].trim()}.`;
      return trimmed;
    })
    .filter(Boolean)
    .join(" ");
}

export function polishTakeProseLine(text: string): string {
  const scrubbed = scrubModelWordFromProse(normalizeFormScopeInText(scrubMyModelPhrasing(text)));
  const repaired = repairIncompleteEvenClause(scrubbed);
  return capitalizeSentenceStartsInText(repaired);
}

/** First pass on OpenRouter take copy — before post-check or assembly. */
export function polishLlmTakeProse(text: string): string {
  let out = polishTakeProseLine(text);
  out = out.replace(/\bI expects\b/gi, "I expect");
  return capitalizeTakeProse(out);
}

export function filterGoalPointsForGridLead(
  points: TakePlanPoint[],
  gridCall: PunditTakePlan["gridCall"],
  grounding: Grounding,
): TakePlanPoint[] {
  if (!gridCall) return points;
  const totalXg = grounding.totalXg;
  if (gridCall.sideKey === "under") {
    return points.filter((p) => {
      if (!/expects (about|close to|around)/i.test(p.text)) return true;
      if (Number.isFinite(totalXg) && totalXg <= 2.45) return true;
      return false;
    });
  }
  if (gridCall.sideKey === "no") {
    return points.filter((p) => !/expects (about|close to|around) (?:three|four|five)/i.test(p.text));
  }
  return points;
}

export function valueLegMatchesHeadline(plan: PunditTakePlan): boolean {
  if (plan.levelNoSide) return false;
  if (!plan.valueLeg) return false;
  if (plan.gridCall) {
    const side = plan.gridCall.sideKey;
    if (side === "yes" || side === "no" || side === "over" || side === "under") return false;
  }
  return plan.valueLeg.outcome === plan.call.outcome;
}
