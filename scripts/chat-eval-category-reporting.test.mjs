import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  EVAL_SCENARIO_CATEGORIES,
  formatLiveBettingMathsHeadline,
  summarizeLiveBettingMaths,
  summarizeScenarioOutcomesByCategory,
} from "./chat-eval-category-reporting.mjs";
import { renderMarkdown } from "./chat-battle-test-lib.mjs";
import { summarizeTranscript } from "./render-chat-transcript.mjs";

test("every fixed scenario declares a supported eval category", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  for (const file of ["evals/chat/scenarios.json", "evals/chat/scenarios.monitor.json"]) {
    const config = JSON.parse(await readFile(path.join(repoRoot, file), "utf8"));
    for (const scenario of config.fixed) {
      assert.ok(
        EVAL_SCENARIO_CATEGORIES.includes(scenario.category),
        `${file} ${scenario.id} missing category`,
      );
    }
  }
});

test("summarizeLiveBettingMaths excludes runtime-helper fixtures", () => {
  const scenarios = [
    { id: "live", category: "betting-maths", kind: "featured-turns", classification: "PASS" },
    { id: "offline", category: "betting-maths", kind: "runtime-helper", classification: "FAIL" },
    { id: "ctx", category: "context", classification: "PASS" },
  ];
  assert.deepEqual(summarizeLiveBettingMaths(scenarios), {
    pass: 1,
    inconclusive: 0,
    fail: 0,
    total: 1,
  });
});

test("renderMarkdown and summarizeTranscript surface live betting-maths headline", () => {
  const report = {
    startedAt: "2026-10-19T00:00:00.000Z",
    runId: "run-cat",
    deployment: { id: "d", source: "test", shaConverged: true },
    comparison: { reason: "first" },
    overall: "PASS",
    certificationGate: { passed: true },
    pacingGate: { passed: true, minimumObservedGapMs: 13000, minimumIntervalMs: 13000 },
    scenarios: [
      { id: "live", category: "betting-maths", kind: "json", classification: "PASS" },
      { id: "helper", category: "betting-maths", kind: "runtime-helper", classification: "FAIL" },
    ],
    liveBettingMaths: { pass: 1, inconclusive: 0, fail: 0, total: 1 },
    byCategory: summarizeScenarioOutcomesByCategory([
      { id: "live", category: "betting-maths", classification: "PASS" },
      { id: "helper", category: "betting-maths", classification: "FAIL" },
    ]),
  };
  const md = renderMarkdown(report);
  assert.match(md, /Live betting-maths \(excl\. offline helpers\): pass 1, inconclusive 0, fail 0 \(1 scenarios\)/);
  const summary = summarizeTranscript(report);
  assert.equal(summary.liveBettingMaths.total, 1);
  assert.match(summary.liveBettingMathsHeadline, /pass 1/);
});

test("formatLiveBettingMathsHeadline matches counts", () => {
  assert.match(
    formatLiveBettingMathsHeadline({ pass: 2, inconclusive: 1, fail: 0, total: 3 }),
    /pass 2, inconclusive 1, fail 0 \(3 scenarios\)/,
  );
});
