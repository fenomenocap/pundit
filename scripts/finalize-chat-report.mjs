#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  finalizeClassifications,
  writeFailureReport,
  writeReport,
} from "./chat-battle-test-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

export const REQUIRED_BROWSER_CHECKS = Object.freeze({
  "fixture-capability-label": ["recognized-friendly-outside-coverage"],
  "fixture-context-retention": [
    "table-route-preserves-match",
    "unsupported-followup-and-matchup-replacement",
  ],
  "new-chat-clears-context": [],
  "candidate-no-fixture-badge": ["candidate-never-becomes-fixture"],
});

function parseArgs(argv) {
  const options = {
    outputDir: path.join(ROOT, "artifacts/chat-evals"),
    browserPath: null,
    criticPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else if (argument === "--browser-json") options.browserPath = path.resolve(argv[++index]);
    else if (argument === "--critic-json") options.criticPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.browserPath || !options.criticPath) {
    throw new Error("--browser-json and --critic-json are required.");
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readLatestRun(outputDir) {
  try {
    return await readJson(path.join(outputDir, "latest-run.json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readJson(path.join(outputDir, "latest.json"));
  }
}

export function evidenceCompatibilityFailures(report, evidence, label) {
  const failures = [];
  if (evidence?.runId !== report.runId) failures.push(`${label}.runId mismatch`);
  if (evidence?.schemaVersion !== report.schemaVersion) failures.push(`${label}.schemaVersion mismatch`);
  if (evidence?.sourceSha !== report.deployment?.sourceSha) failures.push(`${label}.sourceSha mismatch`);
  if (evidence?.deploymentId !== report.deployment?.id) failures.push(`${label}.deploymentId mismatch`);
  const capturedAt = Date.parse(evidence?.capturedAt ?? "");
  const startedAt = Date.parse(report.startedAt ?? "");
  if (Number.isNaN(capturedAt) || Number.isNaN(startedAt) || capturedAt < startedAt) {
    failures.push(`${label}.capturedAt invalid or predates run`);
  }
  return failures;
}

export function evidenceSchemaFailures(report, browserEvidence, criticReview) {
  const failures = [];
  const browserChecks = browserEvidence?.checks;
  const productionUrl = (() => {
    try {
      const parsed = new URL(browserEvidence?.url ?? "");
      return parsed.protocol === "https:" && parsed.origin === new URL(report.webUrl ?? "").origin;
    } catch {
      return false;
    }
  })();
  if (!productionUrl) failures.push("browser evidence URL must match the evaluated production web origin");
  const viewport = browserEvidence?.viewport;
  if (!Number.isInteger(viewport?.width) || viewport.width < 320
    || !Number.isInteger(viewport?.height) || viewport.height < 568) {
    failures.push("browser evidence requires a valid viewport of at least 320x568");
  }
  const consoleEvidence = browserEvidence?.console;
  if (!Array.isArray(consoleEvidence?.errors) || !Array.isArray(consoleEvidence?.warnings)) {
    failures.push("browser evidence requires captured console errors and warnings arrays");
  } else if (consoleEvidence.errors.length > 0) {
    failures.push("browser evidence contains console errors");
  }
  if (typeof browserEvidence?.passed !== "boolean" || typeof browserEvidence?.summary !== "string" || !browserEvidence.summary.trim()
    || !Array.isArray(browserChecks) || browserChecks.length === 0
    || browserChecks.some((check) => typeof check?.id !== "string"
      || typeof check?.passed !== "boolean"
      || typeof check?.evidence !== "string" || !check.evidence.trim()
      || !Array.isArray(check?.reproduction) || check.reproduction.length === 0
      || check.reproduction.some((step) => typeof step !== "string" || !step.trim())
      || !Array.isArray(check?.scenarioIds))) {
    failures.push("browser evidence requires typed checks with id, evidence, reproduction steps, and scenario IDs");
  } else {
    const byId = new Map(browserChecks.map((check) => [check.id, check]));
    if (byId.size !== browserChecks.length) failures.push("browser evidence contains duplicate check IDs");
    const scenarioById = new Map((report.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
    for (const [checkId, requiredScenarioIds] of Object.entries(REQUIRED_BROWSER_CHECKS)) {
      const check = byId.get(checkId);
      if (!check) {
        failures.push(`browser evidence missing required check: ${checkId}`);
        continue;
      }
      for (const scenarioId of requiredScenarioIds) {
        if (!check.scenarioIds.includes(scenarioId)) {
          failures.push(`browser check ${checkId} missing scenario coverage: ${scenarioId}`);
        }
        const scenario = scenarioById.get(scenarioId);
        if (report.progress?.status !== "failed"
          && (!scenario || scenario.passed !== true || scenario.outcome !== "PASS")) {
          failures.push(`browser check ${checkId} references a non-passing scenario: ${scenarioId}`);
        }
      }
    }
  }
  if (typeof criticReview?.materialIssue !== "boolean" || !["PASS", "ISSUES FOUND"].includes(criticReview?.overallVerdict)) {
    failures.push("critic evidence requires materialIssue:boolean and overallVerdict");
  }
  const verdicts = Array.isArray(criticReview?.scenarioVerdicts) ? criticReview.scenarioVerdicts : [];
  const byId = new Map(verdicts.map((item) => [item?.scenarioId, item]));
  for (const scenario of report.scenarios ?? []) {
    if (!scenario.answer || scenario.outcome !== "PASS") continue;
    const verdict = byId.get(scenario.id);
    if (!verdict || !["PASS", "ISSUES FOUND"].includes(verdict.verdict)
      || !Number.isFinite(verdict.correctness) || verdict.correctness < 1 || verdict.correctness > 4
      || (verdict.verdict === "PASS" && verdict.correctness < 3)
      || typeof verdict.reason !== "string" || !verdict.reason.trim()) {
      failures.push(`critic scenario verdict missing or invalid: ${scenario.id}`);
    }
  }
  const turnVerdicts = Array.isArray(criticReview?.turnVerdicts) ? criticReview.turnVerdicts : [];
  const byTurn = new Map(turnVerdicts.map((item) => [`${item?.scenarioId}:${item?.turn}`, item]));
  if (byTurn.size !== turnVerdicts.length) failures.push("critic evidence contains duplicate turn verdicts");
  for (const scenario of report.scenarios ?? []) {
    for (const turn of scenario.turnResults ?? []) {
      if (turn.status !== 200 || typeof turn.answer !== "string" || !turn.answer.trim()) continue;
      const verdict = byTurn.get(`${scenario.id}:${turn.turn}`);
      if (!verdict || !["PASS", "ISSUES FOUND"].includes(verdict.verdict)
        || !Number.isFinite(verdict.correctness) || verdict.correctness < 1 || verdict.correctness > 4
        || (verdict.verdict === "PASS" && verdict.correctness < 3)
        || typeof verdict.reason !== "string" || !verdict.reason.trim()) {
        failures.push(`critic turn verdict missing or invalid: ${scenario.id}#${turn.turn}`);
      }
    }
  }
  return failures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [report, browserEvidence, criticReview] = await Promise.all([
    readLatestRun(options.outputDir),
    readJson(options.browserPath),
    readJson(options.criticPath)
  ]);
  const compatibilityFailures = [
    ...evidenceCompatibilityFailures(report, browserEvidence, "browser"),
    ...evidenceCompatibilityFailures(report, criticReview, "critic"),
  ];
  compatibilityFailures.push(...evidenceSchemaFailures(report, browserEvidence, criticReview));
  if (compatibilityFailures.length > 0) {
    throw new Error(`evidence compatibility failed: ${compatibilityFailures.join("; ")}`);
  }
  report.browserEvidence = browserEvidence;
  report.criticReview = criticReview;
  const criticById = new Map(criticReview.scenarioVerdicts.map((item) => [item.scenarioId, item]));
  const criticByTurn = new Map((criticReview.turnVerdicts ?? []).map((item) => [
    `${item.scenarioId}:${item.turn}`,
    item,
  ]));
  for (const scenario of report.scenarios) {
    const verdict = criticById.get(scenario.id);
    const successfulTurns = (scenario.turnResults ?? []).filter((turn) =>
      turn.status === 200 && typeof turn.answer === "string" && turn.answer.trim()
    );
    const turnReviews = successfulTurns.map((turn) => criticByTurn.get(`${scenario.id}:${turn.turn}`));
    const failedTurn = turnReviews.find((item) => item?.verdict !== "PASS" || item?.correctness < 3);
    if (verdict) {
      scenario.qualitativeScores = { ...(scenario.qualitativeScores ?? {}), correctness: verdict.correctness };
    }
    if (verdict || successfulTurns.length > 0) {
      scenario.correctnessCertified = Boolean(verdict)
        && verdict.verdict === "PASS"
        && verdict.correctness >= 3
        && turnReviews.length === successfulTurns.length
        && !failedTurn;
    }
    if ((verdict && verdict.verdict !== "PASS") || failedTurn) {
      scenario.passed = false;
      scenario.outcome = "FAIL";
      scenario.evidence = `${scenario.evidence}; critic: ${failedTurn?.reason ?? verdict?.reason ?? "correctness issue"}`;
    }
  }
  finalizeClassifications(report, report.comparisonBaseline ?? null);
  report.recommendations = (criticReview.recommendations ?? []).slice(0, 3);
  const browserPassed = browserEvidence.passed
    && browserEvidence.console.errors.length === 0
    && browserEvidence.checks.every((check) => check.passed);
  const criticPassed = criticReview.materialIssue === false && criticReview.overallVerdict === "PASS";
  report.certificationGate.browserPassed = browserPassed;
  report.certificationGate.criticPassed = criticPassed;
  report.certificationGate.passed = report.certificationGate.passed && browserPassed && criticPassed;
  if (!report.certificationGate.passed) {
    report.overall = "ISSUES FOUND";
  }
  report.completedAt = new Date().toISOString();
  const paths = report.progress?.status === "failed"
    ? await writeFailureReport(report, options.outputDir)
    : await writeReport(report, options.outputDir);
  console.log(JSON.stringify({ runId: report.runId, overall: report.overall, report: paths }, null, 2));
}

main().catch((error) => {
  console.error(`chat report finalization failed: ${error.message}`);
  process.exitCode = 1;
});
