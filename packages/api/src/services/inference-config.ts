// Answer inference. Search stays on its own provider chain.
//
// OPENROUTER_API_KEY pins answers to one OpenRouter model through the existing
// Anthropic-compatible client. There is no auto-router and no model-owned web
// search. MiniMax remains the fallback only when that key is absent, so a
// local checkout without OpenRouter still answers. Production sets the
// OpenRouter key and leaves MINIMAX_INFERENCE_API_KEY unset.

export const PINNED_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_MESSAGES_BASE = "https://openrouter.ai/api";
const MINIMAX_MESSAGES_BASE = "https://api.minimax.io/anthropic";

const REJECTED_MODEL = /^(?:openrouter\/(?:auto|pareto)|~)|:online|,/i;

export type InferenceKeySource =
  | "OPENROUTER_API_KEY"
  | "MINIMAX_INFERENCE_API_KEY"
  | "MINIMAX_API_KEY"
  | "unset";

export interface ResolvedInference {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  keySource: InferenceKeySource;
  dedicatedKey: boolean;
  provider: "openrouter" | "minimax";
}

function pinnedOpenRouterModel(): string {
  const requested = process.env.OPENROUTER_MODEL?.trim() ?? "";
  if (!requested || REJECTED_MODEL.test(requested)) return PINNED_OPENROUTER_MODEL;
  return requested;
}

export function resolveInference(): ResolvedInference {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const base = process.env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_MESSAGES_BASE;
    return {
      apiKey: openRouterKey,
      baseURL: base.replace(/\/$/, ""),
      model: pinnedOpenRouterModel(),
      keySource: "OPENROUTER_API_KEY",
      dedicatedKey: true,
      provider: "openrouter",
    };
  }

  const dedicated = process.env.MINIMAX_INFERENCE_API_KEY?.trim();
  const shared = process.env.MINIMAX_API_KEY?.trim();
  return {
    apiKey: dedicated || shared || undefined,
    baseURL: process.env.MINIMAX_INFERENCE_BASE_URL
      ?? process.env.MINIMAX_BASE_URL
      ?? MINIMAX_MESSAGES_BASE,
    model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3",
    keySource: dedicated ? "MINIMAX_INFERENCE_API_KEY" : shared ? "MINIMAX_API_KEY" : "unset",
    dedicatedKey: Boolean(dedicated),
    provider: "minimax",
  };
}
