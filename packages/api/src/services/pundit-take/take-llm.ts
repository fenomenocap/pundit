import Anthropic from "@anthropic-ai/sdk";
import { reasoningOff, resolveInference } from "../inference-config";
import type { PunditTakePlan } from "./types";
import { allowedNumbersFromPlan } from "./take-allowed-numbers";
import { postCheckTakeProse, TAKE_AUDIT_SPEAK_PATTERN, TAKE_PROSE_BANNED_PATTERN, TAKE_TEMPLATE_BANNED_PATTERN } from "./take-validate";
import { renderTakeProseDeterministic } from "./take-prose";

const TAKE_SYSTEM = `You are Pundit, a football analyst writing a short desk take.

Write plain, conversational English — not an audit, not bullet points, no section labels.

Structure:
1) First line MUST be the headline call exactly in the form: "{fixture} — {call} at {pct}%."
2) Then 2–3 sentences weaving supporting reasons AND at least one counter / risk, then what would flip the call (if a flip seed exists).
3) Optional final sentence only if VALUE_SEED is provided: "The value is {side} at {marketDec} against our fair {fairDec}."

Hard rules:
- Use ONLY facts and numbers from PLAN_SEEDS and ALLOWED_NUMBERS. Do not invent stats.
- Do not name bookmakers or data vendors.
- Never use: Model:, Lean:, Why:, "applied in this forecast", "in this model", "sits at", "the model has".
- No markdown tables.`;

function planSeedsJson(plan: PunditTakePlan): string {
  return JSON.stringify({
    fixture: plan.fixtureLabel,
    call: plan.gridCall?.headlineLabel ?? plan.call.headlineLabel,
    callPct: plan.gridCall?.modelPctInt ?? plan.rows.find((r) => r.outcome === plan.call.outcome)?.modelPctInt,
    supporting: plan.supporting.map((p) => p.text),
    counter: plan.contradicting.map((p) => p.text),
    flip: plan.flipCondition?.text ?? null,
    value: plan.valueLeg
      ? {
          label: plan.valueLeg.label,
          fair: plan.valueLeg.fairDecimal,
          market: plan.valueLeg.bestMarketDecimal,
        }
      : null,
  }, null, 2);
}

function stripBadLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("|"))
    .join("\n")
    .trim();
}

export async function renderTakeProseWithLlm(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
): Promise<string | null> {
  const inference = resolveInference();
  if (!inference.apiKey) return null;

  const allowed = [...allowedNumbersFromPlan(plan)].sort((a, b) => b.length - a.length).join(", ");
  const user = [
    `VARIANT: ${variant}`,
    `PLAN_SEEDS:\n${planSeedsJson(plan)}`,
    `ALLOWED_NUMBERS: ${allowed}`,
  ].join("\n\n");

  const client = new Anthropic({
    apiKey: inference.apiKey,
    baseURL: inference.baseURL,
    maxRetries: 0,
  });

  try {
    const msg = await client.messages.create(
      {
        model: inference.model,
        max_tokens: 320,
        temperature: 0.35,
        ...reasoningOff(),
        system: TAKE_SYSTEM,
        messages: [{ role: "user", content: user }],
      },
      { timeout: 12_000 },
    );
    const raw = stripBadLines(
      msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim(),
    );
    if (!raw || TAKE_PROSE_BANNED_PATTERN.test(raw) || TAKE_TEMPLATE_BANNED_PATTERN.test(raw) || TAKE_AUDIT_SPEAK_PATTERN.test(raw)) {
      return null;
    }
    const checked = postCheckTakeProse(raw, plan);
    if (!checked.trim()) return null;
    return checked;
  } catch {
    return null;
  }
}

export async function renderTakeProse(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
): Promise<string> {
  const llm = await renderTakeProseWithLlm(plan, variant);
  if (llm && llm.trim()) return llm;
  return renderTakeProseDeterministic(plan, variant);
}
