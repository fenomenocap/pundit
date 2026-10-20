import Anthropic from "@anthropic-ai/sdk";
import { reasoningOff, resolveInference } from "../inference-config";
import type { PunditTakePlan } from "./types";
import { allowedNumbersFromPlan } from "./take-allowed-numbers";
import {
  postCheckTakeProseWithReport,
  TAKE_AUDIT_SPEAK_PATTERN,
  TAKE_PROSE_BANNED_PATTERN,
  TAKE_TEMPLATE_BANNED_PATTERN,
} from "./take-validate";
import { renderTakeProseDeterministic } from "./take-prose";
import { polishLlmTakeProse } from "./take-prose-polish";

const TAKE_SYSTEM = `You are Pundit, a football analyst writing a short match take.

Write plain, conversational English — not an audit, not bullet points, no section labels.

Structure:
1) First line MUST be the headline call exactly in the form: "{fixture} — {call} at {pct}%."
2) Then 2–3 sentences weaving supporting reasons AND at least one counter / risk. Do NOT write what would flip the call — the server appends that line separately.
3) Optional final sentence only if VALUE_SEED is provided: "The value is {side} at {marketDec} against our fair {fairDec}."

Hard rules:
- Use ONLY facts and numbers from PLAN_SEEDS and ALLOWED_NUMBERS. Do not invent stats.
- Do not name bookmakers or data vendors (no Kalshi, Polymarket, Stake, ClubElo, Elo).
- Never use: Model:, Lean:, Why:, Risk:, section labels, "score grid", "xG model", "Poisson", "desk", "ratings", "applied in this forecast", "in this model", "sits at", "the model has".
- Never write "model", "my model", or "the model". Say "I expect" for goal or outcome forecasts.
- Never write "I'd shift", "I would shift", or "What flips it".
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

export type TakeLlmRenderResult = {
  prose: string | null;
  dropped: string[];
  source: "llm" | "none";
};

export async function renderTakeProseWithLlmDetailed(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
): Promise<TakeLlmRenderResult> {
  const inference = resolveInference();
  if (!inference.apiKey) return { prose: null, dropped: [], source: "none" };

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
    const polished = raw ? polishLlmTakeProse(raw) : "";
    if (!polished || TAKE_PROSE_BANNED_PATTERN.test(polished) || TAKE_TEMPLATE_BANNED_PATTERN.test(polished) || TAKE_AUDIT_SPEAK_PATTERN.test(polished)) {
      return { prose: null, dropped: ["llm-rejected:pattern"], source: "none" };
    }
    const checked = postCheckTakeProseWithReport(polished, plan);
    if (!checked.prose.trim()) {
      return { prose: null, dropped: checked.dropped.length ? checked.dropped : ["llm-rejected:empty-after-postcheck"], source: "none" };
    }
    const finalProse = polishLlmTakeProse(checked.prose);
    return { prose: finalProse, dropped: checked.dropped, source: "llm" };
  } catch {
    return { prose: null, dropped: ["llm-rejected:error"], source: "none" };
  }
}

export async function renderTakeProseWithLlm(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
): Promise<string | null> {
  const result = await renderTakeProseWithLlmDetailed(plan, variant);
  return result.prose;
}

export async function renderTakeProse(
  plan: PunditTakePlan,
  variant: "full" | "why" = "full",
): Promise<string> {
  const llm = await renderTakeProseWithLlm(plan, variant);
  if (llm && llm.trim()) return llm;
  return renderTakeProseDeterministic(plan, variant);
}
