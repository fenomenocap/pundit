/** Hard per-turn caps for the tool-calling agent path (no open-ended growth). */
export const AGENT_GENERATION_BUDGET_MS = 72_000;
export const AGENT_TURN_HARD_MS = 78_000;
export const AGENT_MAX_TOOL_STEPS = 6;
export const AGENT_MAX_OUTPUT_TOKENS_PER_STEP = 1_400;
/** Observed prod max ~40.1k; cap matches without open-ended growth. */
export const AGENT_MAX_CUMULATIVE_LLM_TOKENS = 40_000;
export const AGENT_MAX_PUBLISHER_FETCHES = 8;

export type ChatAgentCapHit = "tokens" | "steps" | "time" | "generation_budget" | null;

export type ChatAgentTurnOutcome =
  | "success"
  | "fallback"
  | "cancelled"
  | "timeout"
  | "error"
  | "skipped";

export interface ChatAgentTurnMetrics {
  latencyMs: number;
  toolSteps: number;
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
  publisherFetches: number;
  capHit: ChatAgentCapHit;
  outcome: ChatAgentTurnOutcome;
  /** Set when outcome is skipped (deterministic/coverage/ineligible route). */
  skipReason?: string;
}

export function emptyChatAgentTurnMetrics(): ChatAgentTurnMetrics {
  return {
    latencyMs: 0,
    toolSteps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cumulativeTokens: 0,
    publisherFetches: 0,
    capHit: null,
    outcome: "success",
  };
}

export function logChatAgentTurn(metrics: ChatAgentTurnMetrics): void {
  console.info(JSON.stringify({
    event: "chat_agent_turn",
    latencyMs: metrics.latencyMs,
    toolSteps: metrics.toolSteps,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cumulativeTokens: metrics.cumulativeTokens,
    publisherFetches: metrics.publisherFetches,
    capHit: metrics.capHit,
    outcome: metrics.outcome,
    ...(metrics.skipReason ? { skipReason: metrics.skipReason } : {}),
  }));
}
