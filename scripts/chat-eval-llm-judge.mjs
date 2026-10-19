/**
 * OpenRouter LLM judge for chat eval answers (persona, call, specificity, variety, citations).
 */

export * from "./chat-eval-judge-core.mjs";
export {
  judgeEvalTurnsRemote,
  resolveJudgeEvalTurns,
  resolveJudgeMode,
  remoteJudgeConfigured,
  remoteJudgeBearerToken,
} from "./chat-eval-judge-remote.mjs";
