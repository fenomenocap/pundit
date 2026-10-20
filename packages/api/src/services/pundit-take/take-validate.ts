import type { PunditTakePlan } from "./types";
import { allowedNumbersFromPlan, sentenceUsesDisallowedNumber } from "./take-allowed-numbers";

export const TAKE_PROSE_BANNED_PATTERN =
  /\b(?:Elo|ClubElo|Kalshi|Polymarket|Dixon-Coles|model-grounded)\b|Why:|Risk:|Lean:|Model:|#\s*[a-f0-9]{6,}|SGT\b|\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

export const TAKE_TEMPLATE_BANNED_PATTERN =
  /\bbadge suggests\b|\btop-flight experience\b|\bcrisis mode\b|\bbanker\b|\bsharper than my read\b|\bstill a top-half\b|\bstill points to\b|\bstill scream\b|\bstill treats\b|\bstill a live worry\b|\bcloser than the badge\b/i;

export const TAKE_AUDIT_SPEAK_PATTERN =
  /\bapplied in this forecast\b|\bin this forecast\b|\bin this model\b|\bthis model\b|\bmy model\b|\bsits at\b|\bforecast says\b|\bthe model has\b|\bon this read\b|\bbefore the low-score correction\b|\blow-score correction\b|\brating sheet\b|\bscore grid\b|\bxG model\b|\bPoisson\b|\bdesk\b|\bratings\b|\b\d\.\d{2}\s+xg\b|\bxg being\b/i;

/** v2 prose (not table/footer): vendor names, jargon, labels, audit phrasing. */
export const TAKE_V2_PROSE_FORBIDDEN_PATTERN = new RegExp(
  [
    TAKE_PROSE_BANNED_PATTERN.source,
    TAKE_AUDIT_SPEAK_PATTERN.source,
    TAKE_TEMPLATE_BANNED_PATTERN.source,
  ].join("|"),
  "i",
);

export function proseFromTakeAnswer(answer: string): string {
  const footerIdx = answer.lastIndexOf("\n\nModel ");
  const withoutFooter = footerIdx >= 0 ? answer.slice(0, footerIdx) : answer;
  const lines = withoutFooter.split("\n");
  const sepIdx = lines.findIndex((line) => /^\|\s*---/.test(line.trim()) || /^\|\s*-{3,}/.test(line.trim()));
  if (sepIdx <= 0) return withoutFooter.trim();
  let tableStart = sepIdx;
  while (tableStart > 0 && lines[tableStart - 1]?.trim().startsWith("|")) {
    tableStart -= 1;
  }
  return lines.slice(0, tableStart).join("\n").trim();
}

export function firstForbiddenTokenInTakeProse(prose: string): string | null {
  const match = prose.match(TAKE_V2_PROSE_FORBIDDEN_PATTERN);
  return match?.[0] ?? null;
}

/** Drop sentences that hit audit/vendor/jargon patterns; keep policy and fair-odds lines. */
export function scrubForbiddenTakeProse(prose: string): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((sentence) => !TAKE_V2_PROSE_FORBIDDEN_PATTERN.test(sentence));
  return kept.join(" ").trim();
}

export function countMarkdownTables(text: string): number {
  const lines = text.split("\n");
  let tables = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().startsWith("|") && lines[i + 1].includes("---")) {
      tables += 1;
    }
  }
  return tables;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceMapsToPlan(sentence: string, plan: PunditTakePlan): boolean {
  if (/^The value is /i.test(sentence)) return true;
  if (/^I pass on /i.test(sentence)) return true;
  if (/^I will not call /i.test(sentence)) return true;
  if (/^That price implies /i.test(sentence)) return true;
  if (/\bI play\.\s*$/i.test(sentence) || / — I play\.$/.test(sentence)) return true;
  if (/^I'd revisit if /i.test(sentence)) return true;
  if (/^What flips it:/i.test(sentence)) return true;
  if (/^I'd shift if /i.test(sentence)) return true;
  if (/^Separately,/i.test(sentence)) return true;
  if (/^fair 1X2 vs the best prices/i.test(sentence)) return true;
  if (/ vs best /i.test(sentence) && /our fair /i.test(sentence)) return true;
  if (/ — .+ — I play\.$/.test(sentence)) return true;
  if (new RegExp(`^On ${escapeRegExp(plan.fixtureLabel)}, I have`).test(sentence)) return true;
  if (new RegExp(`^${escapeRegExp(plan.fixtureLabel)} —`).test(sentence)) return true;

  const seeds = [
    ...plan.supporting,
    ...plan.contradicting,
    ...(plan.flipCondition ? [plan.flipCondition] : []),
  ];
  const lower = sentence.toLowerCase();
  return seeds.some((seed) => {
    const words = seed.text.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hit = words.filter((w) => lower.includes(w)).length;
    return hit >= Math.min(4, Math.max(2, Math.floor(words.length * 0.45)));
  });
}

export function validateTakeProseAgainstPlan(prose: string, plan: PunditTakePlan): string[] {
  const errors: string[] = [];
  if (TAKE_PROSE_BANNED_PATTERN.test(prose)) errors.push("banned-token");
  if (TAKE_TEMPLATE_BANNED_PATTERN.test(prose)) errors.push("template-line");
  if (TAKE_AUDIT_SPEAK_PATTERN.test(prose)) errors.push("audit-speak");

  const allowed = allowedNumbersFromPlan(plan);
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (sentenceUsesDisallowedNumber(sentence, allowed)) {
      errors.push(`disallowed-number:${sentence.slice(0, 40)}`);
    }
    if (!sentenceMapsToPlan(sentence, plan)) {
      errors.push(`unmapped-sentence:${sentence.slice(0, 40)}`);
    }
  }
  return errors;
}

export function filterUnmappedSentences(prose: string, plan: PunditTakePlan): string {
  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const check = validateTakeProseAgainstPlan(sentence.endsWith(".") ? sentence : `${sentence}.`, plan);
    if (check.some((e) => ["banned-token", "template-line", "audit-speak"].includes(e) || e.startsWith("disallowed-number"))) {
      continue;
    }
    if (check.some((e) => e.startsWith("unmapped"))) continue;
    kept.push(sentence);
  }
  if (kept.length === 0 && sentences.length) {
    const opener = sentences.find((s) => s.startsWith(plan.fixtureLabel) || /^On /.test(s));
    return opener ?? sentences[0]!;
  }
  return kept.join(" ");
}

export function postCheckTakeProse(prose: string, plan: PunditTakePlan): string {
  return postCheckTakeProseWithReport(prose, plan).prose;
}

export function postCheckTakeProseWithReport(
  prose: string,
  plan: PunditTakePlan,
): { prose: string; dropped: string[] } {
  const errors = validateTakeProseAgainstPlan(prose, plan);
  const dropped = errors.filter((e) => e.startsWith("unmapped-sentence:")
    || e.startsWith("disallowed-number:")
    || e === "banned-token"
    || e === "template-line"
    || e === "audit-speak");
  if (errors.some((e) => e.startsWith("unmapped") || e.startsWith("disallowed-number")
    || e === "banned-token" || e === "template-line" || e === "audit-speak")) {
    return { prose: filterUnmappedSentences(prose, plan), dropped };
  }
  return { prose, dropped: [] };
}
