// Answer inference. Search is a separate provider and must not be attached
// to this client: the answer model does not browse.
//
// OPENROUTER_API_KEY pins answers to one OpenRouter model through the existing
// Anthropic-compatible client. There is no auto-router. The same key also
// funds search, which calls OpenRouter chat completions on its own and keeps
// only the cited results. MiniMax remains the answer fallback only when the
// OpenRouter key is absent. There is no dedicated MiniMax inference key.

export const PINNED_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_MESSAGES_BASE = "https://openrouter.ai/api";
const MINIMAX_MESSAGES_BASE = "https://api.minimax.io/anthropic";

const REJECTED_MODEL = /^(?:openrouter\/(?:auto|pareto)|~)|:online|,/i;

export type InferenceKeySource =
  | "OPENROUTER_API_KEY"
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

export function openRouterModelId(): string {
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
      model: openRouterModelId(),
      keySource: "OPENROUTER_API_KEY",
      // Search uses this same key. The flag means a separate inference quota,
      // which this deployment does not have.
      dedicatedKey: false,
      provider: "openrouter",
    };
  }

  const shared = process.env.MINIMAX_API_KEY?.trim();
  return {
    apiKey: shared || undefined,
    baseURL: process.env.MINIMAX_BASE_URL?.trim() || MINIMAX_MESSAGES_BASE,
    model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M3",
    keySource: shared ? "MINIMAX_API_KEY" : "unset",
    dedicatedKey: false,
    provider: "minimax",
  };
}
