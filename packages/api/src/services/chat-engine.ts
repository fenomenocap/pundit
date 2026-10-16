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

/**
 * Eval-only per-request override. Ignored unless an eval guard (e.g. search replay scope) is active.
 */
export function parseChatEvalEngineOverrideHeader(
  raw: string | string[] | undefined,
  evalGuardActive: boolean,
): ChatEngineMode | null {
  if (!evalGuardActive) return null;
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === "agent" || value === "legacy") return value;
  return null;
}

export function withChatEngineRequestScope<T>(
  mode: ChatEngineMode | null,
  fn: () => T,
): T {
  if (!mode) return fn();
  return engineRequestScope.run(mode, fn);
}
