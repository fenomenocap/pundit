/**
 * Eval scenario category reporting (betting-maths | context | infra).
 */

import { computeTurnQualityMetrics } from "./chat-eval-quality-metrics.mjs";

export const EVAL_SCENARIO_CATEGORIES = ["betting-maths", "context", "infra"];

const CLEAN_CLASSIFICATIONS = new Set(["PASS", "INCONCLUSIVE", "INTERMITTENT"]);

function bucketForClassification(classification) {
  if (classification === "INCONCLUSIVE") return "inconclusive";
  if (classification === "PASS" || classification === "INTERMITTENT") return "pass";
  return "fail";
}

/** Pass / inconclusive / fail counts per eval category on scenario results. */
export function summarizeScenarioOutcomesByCategory(scenarios) {
  const byCategory = Object.fromEntries(
    EVAL_SCENARIO_CATEGORIES.map((category) => [category, { pass: 0, inconclusive: 0, fail: 0 }]),
  );
  for (const scenario of scenarios ?? []) {
    const category = scenario.category ?? "fixed";
    if (!byCategory[category]) {
      byCategory[category] = { pass: 0, inconclusive: 0, fail: 0 };
    }
    const classification = scenario.classification ?? scenario.outcome ?? "FAIL";
    const bucket = bucketForClassification(classification);
    byCategory[category][bucket] += 1;
  }
  return byCategory;
}

/** Betting-maths scenarios excluding offline runtime-helper fixtures. */
export function summarizeLiveBettingMaths(scenarios) {
  const live = (scenarios ?? []).filter(
    (scenario) => scenario.category === "betting-maths" && scenario.kind !== "runtime-helper",
  );
  const counts = { pass: 0, inconclusive: 0, fail: 0, total: live.length };
  for (const scenario of live) {
    const classification = scenario.classification ?? scenario.outcome ?? "FAIL";
    counts[bucketForClassification(classification)] += 1;
  }
  return counts;
}

/** Per-category turn quality metrics (HTTP 200 turns with answers). */
export function computeTurnQualityMetricsByCategory(turns) {
  const byCategory = {};
  for (const category of EVAL_SCENARIO_CATEGORIES) {
    byCategory[category] = computeTurnQualityMetrics(
      turns.filter((turn) => turn.category === category),
    );
  }
  return byCategory;
}

export function formatLiveBettingMathsHeadline(counts) {
  return `Live betting-maths (excl. offline helpers): pass ${counts.pass}, inconclusive ${counts.inconclusive}, fail ${counts.fail} (${counts.total} scenarios)`;
}
