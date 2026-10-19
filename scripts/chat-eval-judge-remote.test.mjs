import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  judgeEvalTurnsRemote,
  resolveJudgeEvalTurns,
  resolveJudgeMode,
  remoteJudgeConfigured,
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
  delete process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
});

test("resolveJudgeMode defaults to remote", () => {
  assert.equal(resolveJudgeMode(), "remote");
});

test("resolveJudgeEvalTurns local mode skips when OpenRouter key is unset", async () => {
  const local = await resolveJudgeEvalTurns(sampleTurns, { judgeMode: "local" });
  assert.equal(local.status, "skipped_no_key");
});

test("judgeEvalTurnsRemote reports skipped_unavailable when OIDC token is unset", async () => {
  const remote = await judgeEvalTurnsRemote(sampleTurns);
  assert.equal(remote.status, "skipped_unavailable");
  assert.match(remote.turns[0].reason, /GitHub OIDC unavailable/);
});

test("judgeEvalTurnsRemote maps Railway 503 to skipped_unavailable", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "oidc-token";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "judge_unavailable" }), { status: 503 });
  const remote = await judgeEvalTurnsRemote(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(remote.status, "skipped_unavailable");
  assert.equal(remote.turns[0].reason, "judge_unavailable");
});

test("judgeEvalTurnsRemote maps missing route 404 to judge_unavailable", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "oidc-token";
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  const remote = await judgeEvalTurnsRemote(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(remote.status, "skipped_unavailable");
  assert.equal(remote.turns[0].reason, "judge_unavailable");
});

test("judgeEvalTurnsRemote maps network errors to judge_unavailable", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "oidc-token";
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const remote = await judgeEvalTurnsRemote(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(remote.status, "skipped_unavailable");
  assert.equal(remote.turns[0].reason, "judge_unavailable");
});

test("judgeEvalTurnsRemote remints on 401 and retries once", async () => {
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://example.test/oidc";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "req-token";
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "stale-token";
  let judgeCalls = 0;
  let mintCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/oidc")) {
      mintCalls += 1;
      return new Response(JSON.stringify({ value: `fresh-${mintCalls}` }), { status: 200 });
    }
    judgeCalls += 1;
    if (judgeCalls === 1) {
      assert.equal(init.headers.Authorization, "Bearer fresh-1");
      return new Response("Unauthorized", { status: 401 });
    }
    assert.equal(init.headers.Authorization, "Bearer fresh-2");
    return new Response(JSON.stringify({
      judgedTurns: 1,
      scoredTurns: 1,
      skippedTurns: 0,
      averages: { overall: 0.5 },
      turns: [{ skipped: false, scores: { overall: 0.5 } }],
    }), { status: 200 });
  };
  const remote = await judgeEvalTurnsRemote(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(remote.scoredTurns, 1);
  assert.equal(judgeCalls, 2);
  assert.equal(mintCalls, 2);
});

test("judgeEvalTurnsRemote forwards turns with OIDC bearer and returns scores", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "oidc-token";
  const judgePayload = {
    judgedTurns: 1,
    scoredTurns: 1,
    skippedTurns: 0,
    averages: { overall: 0.71, personaStrength: 0.7, clearCall: 0.72, specificity: 0.68, variety: 0.65, citationCorrectness: 0.8 },
    turns: [{ scenarioId: "s1", skipped: false, scores: { overall: 0.71 } }],
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url).endsWith("/internal/eval/judge"), true);
    assert.equal(init.headers.Authorization, "Bearer oidc-token");
    const body = JSON.parse(init.body);
    assert.equal(body.turns.length, 1);
    return new Response(JSON.stringify(judgePayload), { status: 200 });
  };
  assert.equal(remoteJudgeConfigured(), true);
  const remote = await judgeEvalTurnsRemote(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(remote.scoredTurns, 1);
  assert.equal(remote.averages.overall, 0.71);
});

test("resolveJudgeEvalTurns uses remote mode by default", async () => {
  process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = "oidc-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    judgedTurns: 1,
    scoredTurns: 1,
    skippedTurns: 0,
    averages: { overall: 0.66 },
    turns: [{ skipped: false, scores: { overall: 0.66 } }],
  }), { status: 200 });
  const result = await resolveJudgeEvalTurns(sampleTurns, { apiUrl: "https://example.test" });
  assert.equal(result.scoredTurns, 1);
});
