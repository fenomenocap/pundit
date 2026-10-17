import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_MAX_OUTPUT_TOKENS_PER_STEP } from "./chat-agent-limits";

/** Conservative input-token estimate before an LLM call (chars → tokens). */
export function estimateAnthropicInputTokens(parts: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}): number {
  const blob = parts.system
    + JSON.stringify(parts.messages)
    + JSON.stringify(parts.tools);
  return Math.ceil(blob.length / 3.5);
}

export function projectedStepTokenCost(
  parts: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
  },
  maxOutputTokens: number = AGENT_MAX_OUTPUT_TOKENS_PER_STEP,
): number {
  return estimateAnthropicInputTokens(parts) + maxOutputTokens;
}

export function stepFitsTokenBudget(
  cumulativeTokensSoFar: number,
  perTurnCap: number,
  parts: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
  },
  maxOutputTokens?: number,
): boolean {
  const need = projectedStepTokenCost(parts, maxOutputTokens);
  return cumulativeTokensSoFar + need <= perTurnCap;
}
