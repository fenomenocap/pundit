import assert from "node:assert/strict";
import test from "node:test";
import {
  assertJudgeScoredWhenMockSucceeded,
  extractJudgeJsonObject,
  extractOpenRouterJudgeText,
  judgeAnswerTurn,
  judgeEvalTurns,
  normalizeJudgeScores,
  parseJudgeCompletionBody,
  resolveJudgeModel,
} from "./chat-eval-llm-judge.mjs";

function mockCompletion(content) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: typeof content === "string" ? { content } : content }],
    }),
  };
}

test("resolveJudgeModel rejects auto-router ids", () => {
  assert.equal(resolveJudgeModel("openrouter/auto"), "deepseek/deepseek-v4-flash");
  assert.equal(resolveJudgeModel("deepseek/deepseek-v4-flash"), "deepseek/deepseek-v4-flash");
});

test("extractJudgeJsonObject parses fenced and embedded JSON", () => {
  const payload = {
    personaStrength: 0.8,
    clearCall: 0.7,
    specificity: 0.75,
    variety: 0.6,
    citationCorrectness: 0.9,
    overall: 0.76,
    note: "ok",
  };
  assert.deepEqual(extractJudgeJsonObject(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``), payload);
  assert.deepEqual(extractJudgeJsonObject(`Here is the score: ${JSON.stringify(payload)}`), payload);
});

test("normalizeJudgeScores coerces string numerics and derives overall", () => {
  const scores = normalizeJudgeScores({
    personaStrength: "0.8",
    clearCall: 0.7,
    specificity: 0.75,
    variety: 0.6,
    citationCorrectness: 0.9,
    note: "x",
  });
  assert.equal(typeof scores.overall, "number");
  assert.ok(scores.overall > 0);
});

test("extractOpenRouterJudgeText reads text blocks and reasoning fallback", () => {
  assert.equal(
    extractOpenRouterJudgeText({ content: [{ type: "text", text: '{"overall":0.5}' }] }),
    '{"overall":0.5}',
  );
  assert.equal(
    extractOpenRouterJudgeText({ content: "", reasoning: '{"overall":0.5}' }),
    '{"overall":0.5}',
  );
});

test("parseJudgeCompletionBody accepts string overall scores", () => {
  const parsed = parseJudgeCompletionBody({
    choices: [{
      message: {
        content: JSON.stringify({
          personaStrength: "0.8",
          clearCall: "0.7",
          specificity: "0.75",
          variety: "0.6",
          citationCorrectness: "0.9",
          overall: "0.76",
          note: "ok",
        }),
      },
    }],
  });
  assert.equal(parsed.ok, true);
  assert.equal(typeof parsed.scores.overall, "number");
});

test("judgeEvalTurns skips when OpenRouter key is unset", async () => {
  const prior = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const result = await judgeEvalTurns([
    { httpStatus: 200, answer: "Lean home. Gamble responsibly 18+.", question: "Who wins?" },
  ]);
  assert.equal(result.status, "skipped_no_key");
  assert.equal(result.judgedTurns, 0);
  assert.equal(result.scoredTurns, 0);
  assert.equal(result.skippedTurns, 1);
  assert.equal(result.turns[0].skipped, true);
  if (prior) process.env.OPENROUTER_API_KEY = prior;
});

test("judgeEvalTurns scores mock successful OpenRouter responses", async () => {
  const priorFetch = globalThis.fetch;
  const priorModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "openrouter/auto";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.model, "deepseek/deepseek-v4-flash");
    return mockCompletion(JSON.stringify({
      personaStrength: 0.8,
      clearCall: 0.7,
      specificity: 0.75,
      variety: 0.6,
      citationCorrectness: 0.9,
      overall: 0.76,
      note: "ok",
    }));
  };
  const result = await judgeEvalTurns([
    { httpStatus: 200, answer: "Lean home with a markdown [BBC](https://bbc.com) cite.", question: "Who wins?" },
  ], { apiKey: "test-key" });
  assertJudgeScoredWhenMockSucceeded(result, "plain-json");
  assert.equal(result.scoredTurns, 1);
  assert.equal(result.averages.overall, 0.76);
  globalThis.fetch = priorFetch;
  if (priorModel) process.env.OPENROUTER_MODEL = priorModel;
  else delete process.env.OPENROUTER_MODEL;
});

test("judgeEvalTurns scores fenced mock responses", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => mockCompletion(
    "```json\n"
    + JSON.stringify({
      personaStrength: 0.5,
      clearCall: 0.5,
      specificity: 0.5,
      variety: 0.5,
      citationCorrectness: 0.5,
      overall: 0.5,
      note: "fenced",
    })
    + "\n```",
  );
  const result = await judgeEvalTurns([
    { httpStatus: 200, answer: "Avoid — no verified news.", question: "Injuries?" },
  ], { apiKey: "test-key" });
  assertJudgeScoredWhenMockSucceeded(result, "fenced-json");
  assert.equal(result.scoredTurns, 1);
  globalThis.fetch = priorFetch;
});

test("judgeAnswerTurn sends thinking disabled on OpenRouter", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.thinking, { type: "disabled" });
    return mockCompletion("{}");
  };
  await judgeAnswerTurn({ question: "q", answer: "a" }, { apiKey: "test-key" });
  globalThis.fetch = priorFetch;
});
