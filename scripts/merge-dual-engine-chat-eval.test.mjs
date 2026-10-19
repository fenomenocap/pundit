import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mergeDualEngineChatEvalReports } from "./merge-dual-engine-chat-eval.mjs";
import { JUDGE_SKIPPED_NO_KEY_NOTE, JUDGE_SKIPPED_UNAVAILABLE_NOTE } from "./chat-eval-llm-judge.mjs";

test("mergeDualEngineChatEvalReports writes latest.json and latest.md beside latest-run.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "merge-eval-"));
  const deployment = {
    id: "deploy-test",
    source: "test",
    sourceSha: "abc",
    apiSha: "abc",
    webSha: "def",
    shaConverged: true,
  };
  const legacy = {
    schemaVersion: 17,
    runId: "legacy-run",
    startedAt: "2026-10-17T12:00:00.000Z",
    overall: "ISSUES FOUND",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: false },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{
      id: "sample",
      category: "betting-maths",
      classification: "FAIL",
      turnResults: [{
        turn: 1,
        status: 200,
        answer: "Legacy answer.",
        request: { question: "Q?" },
        engine: "legacy",
      }],
    }],
    byCategory: { "betting-maths": { pass: 0, inconclusive: 0, fail: 1 } },
  };
  const agent = {
    schemaVersion: 17,
    runId: "agent-run",
    startedAt: "2026-10-17T13:00:00.000Z",
    overall: "PASS",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{
      id: "sample",
      category: "betting-maths",
      classification: "PASS",
      turnResults: [{
        turn: 1,
        status: 200,
        answer: "Agent answer.",
        request: { question: "Q?" },
        engine: "agent",
      }],
    }],
    byCategory: { "betting-maths": { pass: 1, inconclusive: 0, fail: 0 } },
  };
  const outputPath = path.join(dir, "latest-run.json");
  await mergeDualEngineChatEvalReports(legacy, agent, outputPath);
  const latestJson = JSON.parse(await readFile(path.join(dir, "latest.json"), "utf8"));
  const latestMd = await readFile(path.join(dir, "latest.md"), "utf8");
  assert.equal(latestJson.requestEngine, "both");
  assert.ok(latestJson.agentEval.byCategory["betting-maths"].pass === 1);
  assert.ok(latestJson.qualityMetricsByCategory["betting-maths"]);
  assert.match(latestMd, /legacy-run/);
  assert.match(latestMd, /ISSUES FOUND/);
  assert.match(latestMd, /Live betting-maths/);
});

test("mergeDualEngineChatEvalReports records skipped_no_key judge when local mode lacks OpenRouter key", async () => {
  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorMode = process.env.CHAT_EVAL_JUDGE_MODE;
  delete process.env.OPENROUTER_API_KEY;
  process.env.CHAT_EVAL_JUDGE_MODE = "local";
  const dir = await mkdtemp(path.join(os.tmpdir(), "merge-eval-no-key-"));
  const deployment = {
    id: "deploy-test",
    source: "test",
    sourceSha: "abc",
    apiSha: "abc",
    webSha: "def",
    shaConverged: true,
  };
  const turn = {
    turn: 1,
    status: 200,
    answer: "Answer.",
    request: { question: "Q?" },
    engine: "legacy",
  };
  const legacy = {
    schemaVersion: 17,
    runId: "legacy-run",
    startedAt: "2026-10-17T12:00:00.000Z",
    overall: "PASS",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{ id: "sample", classification: "PASS", turnResults: [turn] }],
  };
  const agent = {
    schemaVersion: 17,
    runId: "agent-run",
    startedAt: "2026-10-17T13:00:00.000Z",
    overall: "PASS",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{ id: "sample", classification: "PASS", turnResults: [{ ...turn, engine: "agent" }] }],
  };
  const merged = await mergeDualEngineChatEvalReports(
    legacy,
    agent,
    path.join(dir, "latest-run.json"),
  );
  assert.equal(merged.llmJudgeSummary.status, "skipped_no_key");
  assert.equal(merged.llmJudgeSummary.note, JUDGE_SKIPPED_NO_KEY_NOTE);
  assert.equal(merged.llmJudgeSummary.judgedTurns, 0);
  assert.equal(merged.llmJudgeSummary.scoredTurns, 0);
  assert.equal(merged.llmJudgeSummary.skippedTurns, 1);
  assert.equal(merged.agentEval.llmJudgeSummary.status, "skipped_no_key");
  const latestMd = await readFile(path.join(dir, "latest.md"), "utf8");
  assert.match(latestMd, /judge: skipped \(no key\)/);
  if (priorKey) process.env.OPENROUTER_API_KEY = priorKey;
  else delete process.env.OPENROUTER_API_KEY;
  if (priorMode) process.env.CHAT_EVAL_JUDGE_MODE = priorMode;
  else delete process.env.CHAT_EVAL_JUDGE_MODE;
});

test("mergeDualEngineChatEvalReports records skipped_unavailable when remote OIDC is unset", async () => {
  const priorMode = process.env.CHAT_EVAL_JUDGE_MODE;
  const priorOidc = process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN;
  delete process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN;
  process.env.CHAT_EVAL_JUDGE_MODE = "remote";
  const dir = await mkdtemp(path.join(os.tmpdir(), "merge-eval-no-oidc-"));
  const deployment = {
    id: "deploy-test",
    source: "test",
    sourceSha: "abc",
    apiSha: "abc",
    webSha: "def",
    shaConverged: true,
  };
  const turn = {
    turn: 1,
    status: 200,
    answer: "Answer.",
    request: { question: "Q?" },
    engine: "legacy",
  };
  const legacy = {
    schemaVersion: 17,
    runId: "legacy-run",
    startedAt: "2026-10-17T12:00:00.000Z",
    overall: "PASS",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{ id: "sample", classification: "PASS", turnResults: [turn] }],
  };
  const agent = {
    schemaVersion: 17,
    runId: "agent-run",
    startedAt: "2026-10-17T13:00:00.000Z",
    overall: "PASS",
    deployment,
    comparison: { reason: "first run" },
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [{ id: "sample", classification: "PASS", turnResults: [{ ...turn, engine: "agent" }] }],
  };
  const merged = await mergeDualEngineChatEvalReports(
    legacy,
    agent,
    path.join(dir, "latest-run.json"),
  );
  assert.equal(merged.llmJudgeSummary.status, "skipped_unavailable");
  assert.equal(merged.llmJudgeSummary.note, JUDGE_SKIPPED_UNAVAILABLE_NOTE);
  assert.equal(merged.agentEval.llmJudgeSummary.status, "skipped_unavailable");
  if (priorMode) process.env.CHAT_EVAL_JUDGE_MODE = priorMode;
  else delete process.env.CHAT_EVAL_JUDGE_MODE;
  if (priorOidc) process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN = priorOidc;
  else delete process.env.CHAT_EVAL_GITHUB_OIDC_TOKEN;
});
