import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { EVAL_SCHEMA_VERSION } from "./chat-battle-test-lib.mjs";
import { REQUIRED_BROWSER_CHECKS } from "./finalize-chat-report.mjs";
import {
  DEFAULT_WEB_URL,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  browserOutputPath,
  buildEvidence,
  fixtureNamesFromChip,
  identityFromReport,
  isFixtureChipText,
  latestRunPath,
  parseArgs,
  requiredCheckIds,
} from "./capture-chat-eval-browser.mjs";

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("parseArgs defaults to production web and the gitignored eval artifact dir", () => {
  const options = parseArgs([]);
  assert.equal(options.webUrl, DEFAULT_WEB_URL);
  assert.equal(options.webUrl, "https://thepundit.vercel.app");
  assert.equal(options.dryRun, false);
  assert.match(options.outputDir, /artifacts\/chat-evals$/);
  assert.equal(options.output, null);
});

test("parseArgs accepts dry-run and a local web origin without production traffic", () => {
  const options = parseArgs([
    "--dry-run",
    "--web-url", "http://127.0.0.1:3000/",
    "--output-dir", "/tmp/pundit-evals",
    "--interval-ms", "13000",
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.webUrl, "http://127.0.0.1:3000");
  assert.equal(options.outputDir, "/tmp/pundit-evals");
  assert.equal(options.intervalMs, 13_000);
});

test("parseArgs rejects an unknown flag", () => {
  assert.throws(() => parseArgs(["--production"]), /Unknown argument/);
});

test("identityFromReport binds Schema-17 deployment fields from the battle-test report", () => {
  const identity = identityFromReport({
    runId: "2026-09-07T00-00-00-000Z",
    schemaVersion: EVAL_SCHEMA_VERSION,
    deployment: { id: "deploy-a", sourceSha: "abc1234" },
  });
  assert.deepEqual(identity, {
    runId: "2026-09-07T00-00-00-000Z",
    schemaVersion: 17,
    sourceSha: "abc1234",
    deploymentId: "deploy-a",
  });
  assert.throws(
    () => identityFromReport({ runId: "x", schemaVersion: 16, deployment: { id: "d", sourceSha: "s" } }),
    /not Schema-17/
  );
});

test("fixture chips stay desk-openers and never include preview or analysis cues", () => {
  assert.equal(isFixtureChipText("Arsenal vs Coventry City · PL · Tue"), true);
  assert.equal(isFixtureChipText("Dinamo Zagreb vs Viking · UCL · Wed"), true);
  assert.equal(isFixtureChipText("Preview Arsenal vs Coventry City · PL · Tue"), false);
  assert.equal(isFixtureChipText("Pass or play · Arsenal vs Coventry City"), false);
  assert.equal(isFixtureChipText("Price this · Liverpool vs Brighton & Hove Albion"), false);
  assert.deepEqual(
    fixtureNamesFromChip("Arsenal vs Coventry City · PL · Sat"),
    { home: "Arsenal", away: "Coventry City" }
  );
});

test("required browser checks match the finalizer contract", () => {
  assert.deepEqual(requiredCheckIds(), Object.keys(REQUIRED_BROWSER_CHECKS));
  assert.ok(requiredCheckIds().includes("analyst-multi-turn-flow"));
  assert.ok(requiredCheckIds().includes("cross-surface-fixture-parity"));
  assert.equal(
    latestRunPath("/tmp/evals"),
    path.join("/tmp/evals", "latest-run.json")
  );
  assert.equal(
    browserOutputPath("/tmp/evals", "run-1"),
    path.join("/tmp/evals", "run-1.browser.json")
  );
});

test("buildEvidence writes the finalize-compatible browser JSON shape", () => {
  const checks = requiredCheckIds().map((id) => ({
    id,
    passed: true,
    evidence: `Observed ${id}.`,
    reproduction: ["Open the page", "Inspect the contract"],
    scenarioIds: [...(REQUIRED_BROWSER_CHECKS[id] ?? [])],
    viewports: [MOBILE_VIEWPORT, DESKTOP_VIEWPORT],
    ...(id === "analyst-multi-turn-flow" ? { turnCount: 6 } : {}),
    ...(id === "cross-surface-fixture-parity"
      ? { surfaces: ["chat", "fixtures", "predictions"] }
      : {}),
  }));
  const evidence = buildEvidence({
    identity: {
      runId: "run-1",
      schemaVersion: 17,
      sourceSha: "abc1234",
      deploymentId: "deploy-a",
    },
    url: DEFAULT_WEB_URL,
    viewport: MOBILE_VIEWPORT,
    viewports: [MOBILE_VIEWPORT, DESKTOP_VIEWPORT],
    console: { errors: [], warnings: [] },
    checks,
  });
  assert.equal(evidence.url, "https://thepundit.vercel.app/");
  assert.equal(evidence.passed, true);
  assert.equal(evidence.summary, "Required production browser contracts passed.");
  assert.equal(evidence.checks.length, requiredCheckIds().length);
  assert.equal(typeof evidence.capturedAt, "string");
});

test("chat-eval:browser --dry-run stays local and lists the required checks", async () => {
  const result = await runNode([
    "scripts/capture-chat-eval-browser.mjs",
    "--dry-run",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "dry-run");
  assert.equal(payload.productionTraffic, false);
  assert.equal(payload.webUrl, DEFAULT_WEB_URL);
  assert.deepEqual(payload.requiredChecks, requiredCheckIds());
  assert.deepEqual(payload.viewports, [MOBILE_VIEWPORT, DESKTOP_VIEWPORT]);
  assert.equal(payload.minimumRequestIntervalMs, 13_000);
});
