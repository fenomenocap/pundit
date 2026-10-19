import type { PunditTakePlan } from "./types";

export const TAKE_PROSE_BANNED_PATTERN =
  /\b(?:Elo|ClubElo|Kalshi|Polymarket|Dixon-Coles|model-grounded)\b|Why:|Risk:|Lean:|Model:|#\s*[a-f0-9]{6,}|SGT\b|\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

export const TAKE_TEMPLATE_BANNED_PATTERN =
  /\bbadge suggests\b|\btop-flight experience\b|\bcrisis mode\b|\bbanker\b|\bsharper than my read\b|\bstill a top-half\b|\bstill points to\b|\bstill scream\b|\bstill treats\b|\bstill a live worry\b|\bcloser than the badge\b/i;

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

function sentenceMapsToPlan(sentence: string, plan: PunditTakePlan): boolean {
  if (/^The value is /i.test(sentence)) return true;
  if (/^BTTS no sits at \d+%\.$/.test(sentence)) return true;
  if (/^(?:Over|Under) 2\.5 sits at \d+%\.$/.test(sentence)) return true;
  if (/^That line implies .+ my model has /i.test(sentence)) return true;
  if (/^I pass on /i.test(sentence)) return true;
  if (/^I will not call /i.test(sentence)) return true;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateTakeProseAgainstPlan(prose: string, plan: PunditTakePlan): string[] {
  const errors: string[] = [];
  if (TAKE_PROSE_BANNED_PATTERN.test(prose)) errors.push("banned-token");
  if (TAKE_TEMPLATE_BANNED_PATTERN.test(prose)) errors.push("template-line");

  const sentences = prose.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
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
    if (check.includes("banned-token") || check.includes("template-line")) continue;
    if (check.some((e) => e.startsWith("unmapped"))) continue;
    kept.push(sentence);
  }
  return kept.join(" ");
}
