import { AsyncLocalStorage } from "node:async_hooks";

export type ChatEngineMode = "legacy" | "agent";

const engineRequestScope = new AsyncLocalStorage<ChatEngineMode>();

export function chatEngineMode(): ChatEngineMode {
  const override = engineRequestScope.getStore();
  if (override) return override;
  return configuredChatEngineMode();
}

export function isChatAgentEngine(): boolean {
  return chatEngineMode() === "agent";
}

/** Parse `x-pundit-chat-engine` without applying eval guard policy. */
export function parseChatEvalEngineOverrideValue(
  raw: string | string[] | undefined,
): ChatEngineMode | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === "agent" || value === "legacy") return value;
  return null;
}

/** Process-wide default when no per-request eval header override is active. */
export function configuredChatEngineMode(): ChatEngineMode {
  return process.env.CHAT_ENGINE?.trim().toLowerCase() === "agent" ? "agent" : "legacy";
}

/** Effective engine from env default plus optional eval header override (no ALS). */
export function resolveEffectiveChatEngine(headerOverride: ChatEngineMode | null): ChatEngineMode {
  if (headerOverride) return headerOverride;
  return configuredChatEngineMode();
}

/**
 * Whether this deploy accepts eval-only `x-pundit-chat-engine` without search replay.
 * Unset `CHAT_ENGINE` defaults runtime to legacy and uses the same header guard as
 * `CHAT_ENGINE=legacy` (production default; no Railway env change required).
 */
export function isChatEvalEngineOverrideGuardActive(searchReplayActive: boolean): boolean {
  if (searchReplayActive) return true;
  const configured = process.env.CHAT_ENGINE?.trim().toLowerCase();
  if (!configured) return true;
  return configured === "legacy" || configured === "agent";
}

export function logAskChatEngineTurn(params: {
  effectiveEngine: ChatEngineMode;
  engineFromHeaderOverride: boolean;
}): void {
  console.log(JSON.stringify({
    event: "ask_chat_engine",
    effectiveEngine: params.effectiveEngine,
    engineFromHeaderOverride: params.engineFromHeaderOverride,
  }));
}

/**
 * Eval-only per-request override. The web app never sends `x-pundit-chat-engine`.
 * Live daily sweeps may set the engine header without search replay when the
 * deploy guard is active (unset or explicit `CHAT_ENGINE`); pinned gate uses replay.
 */
export function resolveChatEvalEngineOverride(
  raw: string | string[] | undefined,
  evalGuardActive: boolean,
): ChatEngineMode | null {
  if (!evalGuardActive) return null;
  return parseChatEvalEngineOverrideValue(raw);
}

/** @deprecated Use resolveChatEvalEngineOverride */
export function parseChatEvalEngineOverrideHeader(
  raw: string | string[] | undefined,
  evalGuardActive: boolean,
): ChatEngineMode | null {
  if (!evalGuardActive) return null;
  return parseChatEvalEngineOverrideValue(raw);
}

export function withChatEngineRequestScope<T>(
  mode: ChatEngineMode | null,
  fn: () => T,
): T {
  if (!mode) return fn();
  return engineRequestScope.run(mode, fn);
}
