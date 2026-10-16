import assert from "node:assert/strict";
import test from "node:test";
import { compareEngineQuality, computeTurnQualityMetrics } from "./chat-eval-quality-metrics.mjs";

test("computeTurnQualityMetrics counts template and citation coverage", () => {
  const metrics = computeTurnQualityMetrics([
    { httpStatus: 200, answer: "My 1X2 is 40% home. Gamble responsibly 18+.", usedLlm: true },
    { httpStatus: 200, answer: "See [BBC](https://bbc.com/sport) for news.", usedLlm: false },
  ]);
  assert.ok(metrics.templateShare > 0);
  assert.ok(metrics.citationCoverage > 0);
  assert.equal(metrics.llmCallRate, 0.5);
});

test("compareEngineQuality returns both engines", () => {
  const out = compareEngineQuality(
    [{ httpStatus: 200, answer: "legacy answer", usedLlm: false }],
    [{ httpStatus: 200, answer: "agent answer", engine: "agent" }],
  );
  assert.ok(out.legacy);
  assert.ok(out.agent);
});
