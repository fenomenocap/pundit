import assert from "node:assert/strict";
import test from "node:test";
import { judgeEvalTurns } from "./chat-eval-llm-judge.mjs";

test("judgeEvalTurns skips when OpenRouter key is unset", async () => {
  const prior = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const result = await judgeEvalTurns([
    { httpStatus: 200, answer: "Lean home. Gamble responsibly 18+.", question: "Who wins?" },
  ]);
  assert.equal(result.scoredTurns, 0);
  assert.equal(result.turns[0].skipped, true);
  if (prior) process.env.OPENROUTER_API_KEY = prior;
});
