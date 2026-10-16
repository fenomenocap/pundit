export type ChatEngineMode = "legacy" | "agent";

export function chatEngineMode(): ChatEngineMode {
  return process.env.CHAT_ENGINE?.trim().toLowerCase() === "agent" ? "agent" : "legacy";
}

export function isChatAgentEngine(): boolean {
  return chatEngineMode() === "agent";
}
