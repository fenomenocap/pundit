import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { EVAL_SCHEMA_VERSION } from "./chat-battle-test-lib.mjs";
import { REQUIRED_BROWSER_CHECKS } from "./finalize-chat-report.mjs";
import {
  BROWSER_COOLDOWN_MS,
  DEFAULT_WEB_URL,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  MIN_BROWSER_REQUEST_INTERVAL_MS,
  OVERSIZED_QUESTION,
  apiCooldownAnchor,
  browserOutputPath,
  buildEvidence,
  createRequestStartPacer,
  finalApiRequestStart,
  identityFromReport,
  latestRunPath,
  oversizedPromptCheckPasses,
  parseBacktestCounts,
  percentageTriplet,
  parseArgs,
  reportExpectsMarketRows,
  requiredCheckIds,
  tripletsAgree,
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
    "--interval-ms", "13025",
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.webUrl, "http://127.0.0.1:3000");
  assert.equal(options.outputDir, "/tmp/pundit-evals");
  assert.equal(options.intervalMs, 13_025);
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

test("browser request pacer preserves the safety interval across one shared clock", async () => {
  let clock = 1_000;
  const waits = [];
  const pacer = createRequestStartPacer({
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += waits.length === 1 ? ms - 5 : ms;
    },
  });
  await pacer.beforeRequest();
  clock += 1_000;
  await pacer.beforeRequest();
  clock += 25_000;
  await pacer.beforeRequest();
  assert.deepEqual(waits, [12_025, 5]);
  assert.deepEqual(pacer.starts, [1_000, 14_025, 39_025]);
  assert.ok(pacer.starts.slice(1).every((start, index) =>
    start - pacer.starts[index] >= MIN_BROWSER_REQUEST_INTERVAL_MS
  ));
});

test("browser request pacer and CLI reject intervals below the 25ms safety floor", () => {
  assert.throws(
    () => createRequestStartPacer({ intervalMs: MIN_BROWSER_REQUEST_INTERVAL_MS - 1 }),
    /at least 13025/
  );
  assert.throws(
    () => parseArgs(["--interval-ms", "13024"]),
    /at least 13025/
  );
});

test("browser request pacer enforces the API-to-browser cooldown from authoritative wall time", async () => {
  let monotonicClock = 5_000;
  let wallClock = Date.parse("2026-09-14T04:31:00.000Z");
  const waits = [];
  const pacer = createRequestStartPacer({
    now: () => monotonicClock,
    wallNow: () => wallClock,
    firstRequestNotBeforeEpochMs: wallClock + BROWSER_COOLDOWN_MS,
    wait: async (ms) => {
      waits.push(ms);
      const elapsed = waits.length === 1 ? ms - 5 : ms;
      monotonicClock += elapsed;
      wallClock += elapsed;
    },
  });
  await pacer.beforeRequest();
  assert.deepEqual(waits, [60_000, 5]);
  assert.equal(pacer.wallStarts[0], "2026-09-14T04:32:00.000Z");
});

test("browser cooldown resolves the final API start and uses later harness completion as a safe anchor", () => {
  const report = {
    completedAt: "2026-09-14T04:40:00.000Z",
    pacing: {
      requestStarts: ["2026-09-14T04:30:00.000Z", "2026-09-14T04:31:12.345Z"],
    },
  };
  const finalStart = finalApiRequestStart(report);
  assert.deepEqual(finalStart, {
    value: "2026-09-14T04:31:12.345Z",
    epochMs: Date.parse("2026-09-14T04:31:12.345Z"),
  });
  assert.deepEqual(apiCooldownAnchor(report, finalStart), {
    value: report.completedAt,
    epochMs: Date.parse(report.completedAt),
  });
  assert.throws(() => finalApiRequestStart({ pacing: { requestStarts: [] } }), /authoritative/);
});

test("cross-surface probability parsing and report-driven market expectation stay explicit", () => {
  assert.deepEqual(percentageTriplet("Home 50.0% Draw 25.0% Away 25.0%"), [0.5, 0.25, 0.25]);
  assert.equal(tripletsAgree([0.5, 0.25, 0.25], [0.5005, 0.2495, 0.25]), true);
  assert.equal(tripletsAgree([0.5, 0.25, 0.25], [0.51, 0.24, 0.25]), false);
  assert.equal(reportExpectsMarketRows({ scenarios: [{
    id: "market-comparison-coverage", observations: { turn1: { oddsSourceCount: 1 } },
  }] }), true);
  assert.equal(reportExpectsMarketRows({ scenarios: [{
    id: "market-comparison-coverage", observations: { turn1: { oddsSourceCount: 0 } },
  }] }), false);
});

test("frozen backtest counts require real non-zero fixtures and forecasts", () => {
  assert.deepEqual(
    parseBacktestCounts("64 finished fixtures · 192 calibration forecasts"),
    { fixtureCount: 64, forecastCount: 192 }
  );
  assert.deepEqual(
    parseBacktestCounts("0 finished fixtures · 0 calibration forecasts"),
    { fixtureCount: 0, forecastCount: 0 }
  );
  assert.equal(parseBacktestCounts("No completed evaluation yet."), null);
});

test("oversized prompt evidence requires a rendered error and zero request starts", () => {
  assert.equal(OVERSIZED_QUESTION.length, 501);
  const valid = {
    inputLength: 501,
    errorVisible: true,
    askRequestsBefore: 10,
    askRequestsAfter: 10,
    pacedStartsBefore: 10,
    pacedStartsAfter: 10,
  };
  assert.equal(oversizedPromptCheckPasses(valid), true);
  assert.equal(oversizedPromptCheckPasses({ ...valid, askRequestsAfter: 11 }), false);
  assert.equal(oversizedPromptCheckPasses({ ...valid, pacedStartsAfter: 11 }), false);
  assert.equal(oversizedPromptCheckPasses({ ...valid, errorVisible: false }), false);
  assert.equal(oversizedPromptCheckPasses({ ...valid, inputLength: 500 }), false);
});

test("required browser checks match the finalizer contract", () => {
  assert.deepEqual(requiredCheckIds(), Object.keys(REQUIRED_BROWSER_CHECKS));
  assert.ok(requiredCheckIds().includes("analyst-multi-turn-flow"));
  assert.ok(requiredCheckIds().includes("cross-surface-fixture-parity"));
  assert.ok(requiredCheckIds().includes("visible-analyst-loading-state"));
  assert.ok(requiredCheckIds().includes("oversized-prompt-client-error"));
  assert.ok(requiredCheckIds().includes("frozen-backtest-nonempty"));
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
  assert.equal(payload.minimumRequestIntervalMs, 13_025);
  assert.equal(payload.apiToBrowserCooldownMs, 60_000);
  assert.equal(payload.webVersionPath, "/api/version");
  assert.equal(payload.apiVersionPath, "/version");
});
