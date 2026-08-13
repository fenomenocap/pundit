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
  if (typeof browserEvidence?.passed !== "boolean" || typeof browserEvidence?.summary !== "string" || !browserEvidence.summary.trim()
    || !Array.isArray(browserChecks) || browserChecks.length === 0
    || browserChecks.some((check) => typeof check?.name !== "string" || typeof check?.passed !== "boolean" || typeof check?.evidence !== "string")) {
    failures.push("browser evidence requires passed, summary, and non-empty typed checks");
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
  for (const scenario of report.scenarios) {
    const verdict = criticById.get(scenario.id);
    if (!verdict) continue;
    scenario.correctnessCertified = verdict.verdict === "PASS" && verdict.correctness >= 3;
    scenario.qualitativeScores = { ...(scenario.qualitativeScores ?? {}), correctness: verdict.correctness };
    if (verdict.verdict !== "PASS") {
      scenario.passed = false;
      scenario.outcome = "FAIL";
      scenario.evidence = `${scenario.evidence}; critic: ${verdict.reason ?? "correctness issue"}`;
    }
  }
  finalizeClassifications(report, null);
  report.recommendations = (criticReview.recommendations ?? []).slice(0, 3);
  const browserPassed = browserEvidence.passed && browserEvidence.checks.every((check) => check.passed);
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
