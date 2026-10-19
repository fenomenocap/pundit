#!/usr/bin/env node
/**
 * Compare chat-eval quality metrics before/after PR-C template/abstain changes
 * on a saved latest-run.json (e.g. gh run download …).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeTurnQualityMetrics } from "./chat-eval-quality-metrics.mjs";
import { summarizeScenarioOutcomesByCategory } from "./chat-eval-category-reporting.mjs";

const EVAL_CATEGORY = ["betting-maths", "context", "infra"];

async function scenarioCategoryById() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const config = JSON.parse(await readFile(path.join(repoRoot, "evals/chat/scenarios.json"), "utf8"));
  return new Map(config.fixed.map((scenario) => [scenario.id, scenario.category]));
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

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error("usage: rescore-chat-eval-artifact.mjs <merged-latest-run.json> [agent-latest-run.json]");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const categoryById = await scenarioCategoryById();
  const withCategories = (report.scenarios ?? []).map((scenario) => ({
    ...scenario,
    category: EVAL_CATEGORY.includes(scenario.category)
      ? scenario.category
      : categoryById.get(scenario.id) ?? scenario.category ?? "fixed",
  }));
  const legacyReport = { ...report, scenarios: withCategories };
  const legacyTurns = flattenTurns(legacyReport, "legacy");
  let agentTurns = [];
  const agentPath = process.argv[3];
  if (agentPath) {
    const agentReport = JSON.parse(await readFile(agentPath, "utf8"));
    agentTurns = flattenTurns({
      ...agentReport,
      scenarios: (agentReport.scenarios ?? []).map((scenario) => ({
        ...scenario,
        category: categoryById.get(scenario.id) ?? scenario.category ?? "fixed",
      })),
    }, "agent");
  } else {
    agentTurns = legacyTurns.filter((turn) => turn.engine === "agent");
  }

  const engines = report.requestEngine === "both"
    ? [
      { label: "legacy", turns: legacyTurns },
      { label: "agent", turns: agentTurns.length ? agentTurns : legacyTurns.filter((t) => t.engine === "agent") },
    ]
    : [{ label: report.requestEngine ?? "legacy", turns: legacyTurns }];

  const outcomeByCategory = summarizeScenarioOutcomesByCategory(report.scenarios ?? []);
  const table = [];
  for (const { label, turns } of engines) {
    table.push({
      engine: label,
      scope: "all",
      before: fmt(computeTurnQualityMetrics(turns, { metricsVersion: 1 })),
      after: fmt(computeTurnQualityMetrics(turns, { metricsVersion: 2 })),
    });
    for (const category of ["betting-maths", "context", "infra"]) {
      const subset = turns.filter((turn) => turn.category === category);
      table.push({
        engine: label,
        scope: category,
        before: fmt(computeTurnQualityMetrics(subset, { metricsVersion: 1 })),
        after: fmt(computeTurnQualityMetrics(subset, { metricsVersion: 2 })),
      });
    }
  }
  console.log(JSON.stringify({ runId: report.runId, outcomeByCategory, table }, null, 2));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
