#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [report, browserEvidence, criticReview] = await Promise.all([
    readLatestRun(options.outputDir),
    readJson(options.browserPath),
    readJson(options.criticPath)
  ]);
  report.browserEvidence = browserEvidence;
  report.criticReview = criticReview;
  report.recommendations = (criticReview.recommendations ?? []).slice(0, 3);
  if (!browserEvidence.passed || criticReview.materialIssue === true) {
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
