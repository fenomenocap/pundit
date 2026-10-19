import { createRequire } from "node:module";
import path from "node:path";

const requireCjs = createRequire(__filename);

export type JudgeEvalPayload = {
  scenarioId?: string | null;
  turn?: number | null;
  question?: string;
  answer?: string;
  citations?: Array<{ url?: string; link?: string }>;
};

export type JudgeEvalBatchResult = {
  judgedTurns: number;
  scoredTurns: number;
  skippedTurns: number;
  averages: Record<string, number | null>;
  turns: unknown[];
  status?: string;
};

type JudgeCoreModule = {
  judgeEvalTurnPayloads: (
    turns: JudgeEvalPayload[],
    options?: { maxTurns?: number; paceMs?: number; apiKey?: string },
  ) => Promise<JudgeEvalBatchResult>;
};

let cached: JudgeCoreModule | null = null;

export function getChatEvalJudgeCore(): JudgeCoreModule {
  if (!cached) {
    const corePath = path.resolve(__dirname, "../../../../scripts/chat-eval-judge-core.mjs");
    cached = requireCjs(corePath) as JudgeCoreModule;
  }
  return cached;
}
