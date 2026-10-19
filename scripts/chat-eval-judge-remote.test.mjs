import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  judgeEvalTurnsRemote,
  resolveJudgeEvalTurns,
  resolveJudgeMode,
} from "./chat-eval-judge-remote.mjs";
const sampleTurns = [{
  scenarioId: "s1",
  turn: 1,
  httpStatus: 200,
  question: "Lean?",
  answer: "Lean Chelsea on the gap.",
  citations: [],
}];

let savedFetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  delete process.env.CHAT_EVAL_JUDGE_MODE;
  delete process.env.CHAT_EVAL_INTERNAL_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
});

test("resolveJudgeMode defaults to local and rejects unknown values", () => {
  assert.equal(resolveJudgeMode(), "local");
  assert.equal(resolveJudgeMode("remote"), "remote");
  assert.throws(() => resolveJudgeMode("bogus"), /local, remote, or off/);
});

test("resolveJudgeEvalTurns uses local OpenRouter path by default", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const local = await resolveJudgeEvalTurns(sampleTurns, { judgeMode: "local" });
  assert.equal(local.status, "skipped_no_key");
});

test("judgeEvalTurnsRemote skips when internal token is unset", async () => {
  const remote = await judgeEvalTurnsRemote(sampleTurns, { judgeMode: "remote" });
  assert.equal(remote.status, "skipped_no_key");
  assert.match(remote.turns[0].reason, /CHAT_EVAL_INTERNAL_TOKEN unset/);
});

test("judgeEvalTurnsRemote forwards turns to the API and returns its JSON", async () => {
  process.env.CHAT_EVAL_INTERNAL_TOKEN = "ci-token";
  const judgePayload = {
    judgedTurns: 1,
    scoredTurns: 1,
    skippedTurns: 0,
    averages: { overall: 0.71 },
    turns: [{ scenarioId: "s1", skipped: false, scores: { overall: 0.71 } }],
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url).endsWith("/internal/eval/judge"), true);
    assert.equal(init.headers.Authorization, "Bearer ci-token");
    const body = JSON.parse(init.body);
    assert.equal(body.turns.length, 1);
    assert.equal(body.turns[0].answer, sampleTurns[0].answer);
    return new Response(JSON.stringify(judgePayload), { status: 200 });
  };
  const remote = await judgeEvalTurnsRemote(sampleTurns, {
    apiUrl: "https://example.test",
  });
  assert.equal(remote.scoredTurns, 1);
  assert.equal(remote.averages.overall, 0.71);
});

test("resolveJudgeEvalTurns honors CHAT_EVAL_JUDGE_MODE=remote", async () => {
  process.env.CHAT_EVAL_JUDGE_MODE = "remote";
  process.env.CHAT_EVAL_INTERNAL_TOKEN = "ci-token";
  process.env.OPENROUTER_API_KEY = "local-key-not-used-for-remote";
  globalThis.fetch = async () => new Response(JSON.stringify({
    judgedTurns: 1,
    scoredTurns: 1,
    skippedTurns: 0,
    averages: { overall: 0.66 },
    turns: [{ skipped: false, scores: { overall: 0.66 } }],
  }), { status: 200 });
  const result = await resolveJudgeEvalTurns(sampleTurns);
  assert.equal(result.scoredTurns, 1);
  assert.equal(result.averages.overall, 0.66);
});
