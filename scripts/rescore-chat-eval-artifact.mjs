#!/usr/bin/env node
/**
 * Compare chat-eval quality metrics and scenario PASS/INC/FAIL under old vs new
 * assertion profiles on saved latest-run.json (e.g. gh run download …).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeTurnQualityMetrics } from "./chat-eval-quality-metrics.mjs";
import { summarizeScenarioOutcomesByCategory } from "./chat-eval-category-reporting.mjs";
import { gradeRecordedJsonScenario } from "./chat-eval-gate-lib.mjs";

const EVAL_CATEGORY = ["betting-maths", "context", "infra"];

async function scenarioCatalog() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const fixed = JSON.parse(await readFile(path.join(repoRoot, "evals/chat/scenarios.json"), "utf8"));
  const monitor = JSON.parse(await readFile(path.join(repoRoot, "evals/chat/scenarios.monitor.json"), "utf8"));
  const map = new Map();
  for (const scenario of [...fixed.fixed, ...monitor.fixed]) {
    map.set(scenario.id, scenario);
  }
  return map;
}

function flattenTurns(report, engineLabel) {
  const turns = [];
  for (const scenario of report?.scenarios ?? []) {
    for (const turn of scenario.turnResults ?? []) {
      turns.push({
        scenarioId: scenario.id,
        category: scenario.category ?? "fixed",
        turn: turn.turn,
        httpStatus: turn.status,
        answer: turn.answer,
        verification: turn.verification,
        usedLlm: turn.usedLlm,
        engine: turn.engine ?? engineLabel,
      });
    }
  }
  return turns;
}

function fmt(metrics) {
  return {
    templateShare: Number(metrics.templateShare.toFixed(4)),
    abstainRate: Number(metrics.abstainRate.toFixed(4)),
    partialDropRate: Number((metrics.partialDropRate ?? 0).toFixed(4)),
    citationCoverage: Number(metrics.citationCoverage.toFixed(4)),
  };
}

function resolveCategory(scenario, categoryById) {
  if (EVAL_CATEGORY.includes(scenario.category)) return scenario.category;
  return categoryById.get(scenario.id) ?? scenario.category ?? "fixed";
}

function bucketOutcome(scenarioResult, httpStatus) {
  if (httpStatus && httpStatus !== 200) return "INCONCLUSIVE";
  return scenarioResult.passed ? "PASS" : "FAIL";
}

function emptyOutcomeBuckets() {
  return Object.fromEntries(EVAL_CATEGORY.map((c) => [c, { PASS: 0, INCONCLUSIVE: 0, FAIL: 0 }]));
}

function summarizeRegradedOutcomes(regraded) {
  const byEngine = {};
  for (const row of regraded) {
    const engine = row.engine;
    if (!byEngine[engine]) {
      byEngine[engine] = emptyOutcomeBuckets();
      byEngine[engine].all = { PASS: 0, INCONCLUSIVE: 0, FAIL: 0 };
    }
    const category = row.category;
    const bucket = row.outcome;
    byEngine[engine].all[bucket] += 1;
    if (byEngine[engine][category]) {
      byEngine[engine][category][bucket] += 1;
    }
  }
  return byEngine;
}

function summarizeRecordedOutcomes(report, categoryById, engineLabel) {
  const byEngine = { [engineLabel]: emptyOutcomeBuckets() };
  byEngine[engineLabel].all = { PASS: 0, INCONCLUSIVE: 0, FAIL: 0 };
  for (const scenario of report?.scenarios ?? []) {
    const category = resolveCategory(scenario, categoryById);
    if (!EVAL_CATEGORY.includes(category)) continue;
    const bucket = scenario.classification ?? scenario.outcome ?? "FAIL";
    const normalized = bucket === "INCONCLUSIVE" || bucket === "INTERMITTENT"
      ? "INCONCLUSIVE"
      : bucket === "PASS" ? "PASS" : "FAIL";
    byEngine[engineLabel][category][normalized] += 1;
    byEngine[engineLabel].all[normalized] += 1;
  }
  return byEngine[engineLabel];
}

function regradeReport(report, catalog, categoryById, engineLabel, relaxedEvalAssertions) {
  const rows = [];
  for (const recorded of report?.scenarios ?? []) {
    const template = catalog.get(recorded.id);
    const category = resolveCategory(recorded, categoryById);
    if (!EVAL_CATEGORY.includes(category)) continue;
    let outcome;
    if (template?.turns?.length && recorded.turnResults?.length === template.turns.length) {
      const graded = gradeRecordedJsonScenario(template, recorded.turnResults, { relaxedEvalAssertions });
      outcome = bucketOutcome(graded, recorded.status);
    } else {
      const bucket = recorded.classification ?? recorded.outcome ?? "FAIL";
      outcome = bucket === "INCONCLUSIVE" || bucket === "INTERMITTENT"
        ? "INCONCLUSIVE"
        : bucket === "PASS" ? "PASS" : "FAIL";
    }
    rows.push({ id: recorded.id, engine: engineLabel, category, outcome });
  }
  return rows;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error("usage: rescore-chat-eval-artifact.mjs <legacy-latest-run.json> [agent-latest-run.json]");
  }
  const catalog = await scenarioCatalog();
  const categoryById = new Map([...catalog.entries()].map(([id, scenario]) => [id, scenario.category]));

  const legacyReport = JSON.parse(await readFile(reportPath, "utf8"));
  const agentPath = process.argv[3];
  const agentReport = agentPath ? JSON.parse(await readFile(agentPath, "utf8")) : null;

  const legacyTurns = flattenTurns(legacyReport, "legacy");
  const agentTurns = agentReport ? flattenTurns(agentReport, "agent") : legacyTurns.filter((t) => t.engine === "agent");

  const engines = [
    { label: "legacy", report: legacyReport, turns: legacyTurns },
    { label: "agent", report: agentReport ?? legacyReport, turns: agentTurns.length ? agentTurns : legacyTurns.filter((t) => t.engine === "agent") },
  ];

  const table = [];
  for (const { label, turns } of engines) {
    table.push({
      engine: label,
      scope: "all",
      before: fmt(computeTurnQualityMetrics(turns, { metricsVersion: 1 })),
      after: fmt(computeTurnQualityMetrics(turns, { metricsVersion: 2 })),
    });
    for (const category of EVAL_CATEGORY) {
      const subset = turns.filter((turn) => turn.category === category);
      table.push({
        engine: label,
        scope: category,
        before: fmt(computeTurnQualityMetrics(subset, { metricsVersion: 1 })),
        after: fmt(computeTurnQualityMetrics(subset, { metricsVersion: 2 })),
      });
    }
  }

  const assertionRescore = {
    oldAssertions: Object.fromEntries(
      engines.map(({ label, report }) => [label, summarizeRecordedOutcomes(report, categoryById, label)]),
    ),
    newAssertions: summarizeRegradedOutcomes(
      engines.flatMap(({ label, report }) => regradeReport(report, catalog, categoryById, label, true)),
    ),
    preBcRegradeSubset: summarizeRegradedOutcomes(
      engines.flatMap(({ label, report }) => regradeReport(report, catalog, categoryById, label, false)),
    ),
    note: "oldAssertions = recorded PASS/INC/FAIL from run 39202480958. newAssertions = same answers re-asserted with PR-C rules; catalog-aligned turns regraded, others keep recorded outcome.",
  };

  const outcomeByCategory = summarizeScenarioOutcomesByCategory(legacyReport.scenarios ?? []);
  console.log(JSON.stringify({
    runId: legacyReport.runId,
    outcomeByCategory,
    qualityMetrics: table,
    assertionRescore,
  }, null, 2));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
