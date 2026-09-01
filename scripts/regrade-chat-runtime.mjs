#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  regradeRecordedRuntimeHelpers,
  renderMarkdown,
} from "./chat-battle-test-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = {
    reportPath: null,
    scenariosPath: path.join(ROOT, "evals/chat/scenarios.json"),
    evaluatorSha: null,
    targetIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--report") options.reportPath = path.resolve(argv[++index]);
    else if (argument === "--scenarios-path") options.scenariosPath = path.resolve(argv[++index]);
    else if (argument === "--evaluator-sha") options.evaluatorSha = argv[++index];
    else if (argument === "--scenario") options.targetIds.push(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.reportPath || !/^[0-9a-f]{40}$/i.test(options.evaluatorSha ?? "")
    || options.targetIds.length === 0) {
    throw new Error("--report, --evaluator-sha, and at least one --scenario are required");
  }
  return options;
}

async function atomicWrite(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, filePath);
}

function gitShowJson(sha, relativePath) {
  return JSON.parse(gitShowBytes(sha, relativePath).toString("utf8"));
}

function gitShowBytes(sha, relativePath) {
  return execFileSync("git", ["show", `${sha}:${relativePath}`], {
    cwd: ROOT,
    encoding: null,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const relativeScenariosPath = path.relative(ROOT, options.scenariosPath);
  if (relativeScenariosPath.startsWith("..") || path.isAbsolute(relativeScenariosPath)) {
    throw new Error("scenario manifest must be inside the repository");
  }
  const originalBytes = await readFile(options.reportPath);
  const report = JSON.parse(originalBytes.toString("utf8"));
  const currentScenarios = JSON.parse(await readFile(options.scenariosPath, "utf8"));
  const originalScenarios = gitShowJson(report?.deployment?.sourceSha, relativeScenariosPath);
  const evaluatorScenarios = gitShowJson(options.evaluatorSha, relativeScenariosPath);
  if (JSON.stringify(evaluatorScenarios) !== JSON.stringify(currentScenarios)) {
    throw new Error("current scenario manifest does not match evaluator SHA");
  }
  const originalNonFixed = { ...originalScenarios, fixed: [] };
  const currentNonFixed = { ...currentScenarios, fixed: [] };
  if (JSON.stringify(originalNonFixed) !== JSON.stringify(currentNonFixed)) {
    throw new Error("scenario manifest changed outside fixed runtime-helper expectations");
  }
  const boundPaths = [
    relativeScenariosPath,
    "scripts/chat-battle-test-lib.mjs",
    "scripts/regrade-chat-runtime.mjs",
  ];
  for (const boundPath of boundPaths) {
    const committed = gitShowBytes(options.evaluatorSha, boundPath);
    const current = await readFile(path.join(ROOT, boundPath));
    if (!committed.equals(current)) {
      throw new Error(`bound evaluator file does not match evaluator SHA: ${boundPath}`);
    }
  }

  const regraded = regradeRecordedRuntimeHelpers(
    report,
    originalScenarios.fixed,
    currentScenarios.fixed,
    options.targetIds,
    {
      evaluatorSha: options.evaluatorSha,
      regradedAt: new Date().toISOString(),
      originalArtifactSha256: createHash("sha256").update(originalBytes).digest("hex"),
      originalArtifactPath: options.reportPath,
      hashRecordedActual: (actual) => createHash("sha256")
        .update(JSON.stringify(actual)).digest("hex"),
    }
  );
  const outputDir = path.dirname(options.reportPath);
  const json = `${JSON.stringify(regraded, null, 2)}\n`;
  const markdown = renderMarkdown(regraded);
  const regradedJsonPath = path.join(outputDir, `${report.runId}.regraded.json`);
  const regradedMarkdownPath = path.join(outputDir, `${report.runId}.regraded.md`);
  await atomicWrite(regradedJsonPath, json);
  await atomicWrite(regradedMarkdownPath, markdown);
  await atomicWrite(path.join(outputDir, "latest.json"), json);
  await atomicWrite(path.join(outputDir, "latest.md"), markdown);
  await atomicWrite(path.join(outputDir, "latest-run.json"), json);
  console.log(JSON.stringify({
    runId: report.runId,
    overall: regraded.overall,
    requiredFailures: regraded.certificationGate?.requiredFailures,
    regradedJsonPath,
    regradedMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(`runtime regrade failed: ${error.message}`);
  process.exitCode = 1;
});
