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

test("agent template share tracks canned compliance markers only", () => {
  assert.equal(computeTurnQualityMetrics([
    { httpStatus: 200, answer: "Lean home with a real take.", engine: "agent" },
  ]).templateShare, 0);
  assert.equal(computeTurnQualityMetrics([
    { httpStatus: 200, answer: "Lean home. Gamble responsibly 18+.", engine: "agent" },
  ]).templateShare, 1);
});

test("template share v2 ignores desk phrasing but v1 counted it", () => {
  const turn = { httpStatus: 200, answer: "My 1X2 is 40% home. Fair decimal 2.10.", engine: "agent" };
  assert.equal(computeTurnQualityMetrics([turn]).templateShare, 0);
  assert.equal(computeTurnQualityMetrics([turn], { metricsVersion: 1 }).templateShare, 1);
});

test("abstainRate counts whole-reply abstains; partialDropRate counts dropped claims with numbers", () => {
  const metrics = computeTurnQualityMetrics([
    { httpStatus: 200, answer: "I could not verify that claim.", verification: { status: "abstain" } },
    { httpStatus: 200, answer: "Home 55%. Current reports conflict, so I've left those claims out.", verification: { status: "conflict", removedClaimCount: 1 } },
  ]);
  assert.equal(metrics.abstainRate, 0.5);
  assert.equal(metrics.partialDropRate, 0.5);
});

test("compareEngineQuality returns both engines", () => {
  const out = compareEngineQuality(
    [{ httpStatus: 200, answer: "legacy answer", usedLlm: false }],
    [{ httpStatus: 200, answer: "agent answer", engine: "agent" }],
  );
  assert.ok(out.legacy);
  assert.ok(out.agent);
});
