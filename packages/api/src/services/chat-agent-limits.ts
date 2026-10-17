/** Hard per-turn caps for the tool-calling agent path (no open-ended growth). */
export const AGENT_GENERATION_BUDGET_MS = 72_000;
export const AGENT_TURN_HARD_MS = 78_000;
export const AGENT_MAX_TOOL_STEPS = 6;
export const AGENT_MAX_OUTPUT_TOKENS_PER_STEP = 1_400;
export const AGENT_MAX_CUMULATIVE_LLM_TOKENS = 10_000;
export const AGENT_MAX_PUBLISHER_FETCHES = 8;

export interface ChatAgentTurnMetrics {
  latencyMs: number;
  toolSteps: number;
  inputTokens: number;
  outputTokens: number;
  cumulativeTokens: number;
  publisherFetches: number;
}

export function emptyChatAgentTurnMetrics(): ChatAgentTurnMetrics {
  return {
    latencyMs: 0,
    toolSteps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cumulativeTokens: 0,
    publisherFetches: 0,
  };
}
