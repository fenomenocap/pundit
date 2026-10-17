import { AsyncLocalStorage } from "node:async_hooks";

export type ChatEngineMode = "legacy" | "agent";

const engineRequestScope = new AsyncLocalStorage<ChatEngineMode>();

export function chatEngineMode(): ChatEngineMode {
  const override = engineRequestScope.getStore();
  if (override) return override;
  return process.env.CHAT_ENGINE?.trim().toLowerCase() === "agent" ? "agent" : "legacy";
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

/** Whether this deploy accepts eval-only `x-pundit-chat-engine` without search replay. */
export function isChatEvalEngineOverrideGuardActive(searchReplayActive: boolean): boolean {
  if (searchReplayActive) return true;
  const configured = process.env.CHAT_ENGINE?.trim().toLowerCase();
  return configured === "legacy" || configured === "agent";
}

/**
 * Eval-only per-request override. The web app never sends `x-pundit-chat-engine`.
 * Live daily sweeps may set the engine header without search replay when
 * `CHAT_ENGINE` is explicitly `legacy` or `agent`; pinned gate jobs use replay.
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
