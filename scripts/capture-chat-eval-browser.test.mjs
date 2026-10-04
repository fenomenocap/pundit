import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { EVAL_SCHEMA_VERSION } from "./chat-battle-test-lib.mjs";
import { REQUIRED_BROWSER_CHECKS } from "./finalize-chat-report.mjs";
import {
  requestFixtureIdentity,
  waitForAnswer,
  captureAndPersist,
  captureLive,
  attachAskDiagnostics,
  captureFailureDiagnostics,
  collectFeaturedFixture,
  fixtureLocator,
  structuredProbabilities,
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
  latestBoardIdentity,
  oversizedPromptCheckPasses,
  parseBacktestCounts,
  percentageTriplet,
  parseArgs,
  reportExpectsMarketRows,
  requiredCheckIds,
  tripletsAgree,
} from "./capture-chat-eval-browser.mjs";

test("compact follow-up context must reveal the actual board and retain its identity and probabilities", async () => {
  let visible = false;
  let clicked = 0;
  const attributes = { "data-fixture-id": "espn:eng.1:901", "data-p-home": "0.6", "data-p-draw": "0.25", "data-p-away": "0.15" };
  const board = {
    isVisible: async () => visible,
    getAttribute: async (name) => attributes[name] ?? null,
    locator: () => ({ count: async () => 2 }),
  };
  const compact = { isVisible: async () => true, locator: () => ({ click: async () => { visible = true; clicked++; } }) };
  const bubble = { getByTestId: (id) => id === "desk-match-board" ? board : compact };
  const page = { getByTestId: () => ({ last: () => bubble }) };
  assert.equal((await latestBoardIdentity(page, "espn:eng.1:901")).boardVisible, false);
  const revealed = await latestBoardIdentity(page, "espn:eng.1:901", true);
  assert.equal(revealed.boardVisible, true);
  assert.equal(revealed.identityMatches, true);
  assert.deepEqual(revealed.probabilities, [0.6, 0.25, 0.15]);
  assert.equal((await latestBoardIdentity(page, "espn:eng.1:902", true)).identityMatches, false);
  assert.equal(clicked, 1);
});

test("request identity reads the API fixtureContext contract without promoting unrelated IDs", () => {
  assert.equal(requestFixtureIdentity({ fixtureContext: { fixtureId: "espn:eng.1:401879280" } }), "espn:eng.1:401879280");
  assert.equal(requestFixtureIdentity({ fixtureId: "espn:eng.1:401879280" }), null);
  assert.equal(requestFixtureIdentity({ fixtureContext: { fixtureId: 401879280 } }), null);
  assert.equal(requestFixtureIdentity({ question: "Leeds vs Newcastle" }), null);
});

test("answer completion uses the editable composer, not the empty draft's disabled Send button", async () => {
  class Textarea { disabled = false; }
  const input = new Textarea();
  let bubbles = 2;
  let error = "";
  const document = {
    querySelectorAll: () => Array(bubbles).fill({}),
    querySelector: (selector) => selector.startsWith("textarea") ? input
      : selector === '[role="alert"]' ? { textContent: error } : { disabled: true },
  };
  const page = {
    waitForFunction: async (predicate, args, options) => ({
      jsonValue: () => runInNewContext(`(${predicate.toString()})(args)`, {
        document, HTMLTextAreaElement: Textarea, args,
      }),
    }),
  };
  const originalWait = page.waitForFunction;
  page.waitForFunction = async (predicate, args, options) => {
    assert.deepEqual(options, { timeout: 180_000, polling: 100 });
    return originalWait(predicate, args, options);
  };
  assert.equal((await waitForAnswer(page, 1)).answered, true);
  input.disabled = true;
  assert.equal(await waitForAnswer(page, 1), null);
  input.disabled = false;
  bubbles = 1;
  assert.equal(await waitForAnswer(page, 1), null);
  error = "Request failed";
  const failed = await waitForAnswer(page, 1);
  assert.equal(failed.answered, false);
  assert.equal(failed.error, error);
});

test("failed answer diagnostics preserve expected and actual bubble counts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "pundit-answer-counts-"));
  const page = {
    waitForFunction: async () => { throw new Error("Timeout"); },
    evaluate: async () => ({ assistantBubbleCount: 3, composer: { disabled: false }, alerts: [] }),
    screenshot: async () => {},
  };
  try {
    await assert.rejects(waitForAnswer(page, 2), /Timeout/);
    const diagnostics = await captureFailureDiagnostics(page, MOBILE_VIEWPORT, { outputDir },
      { runId: "answer-counts" }, { collected: { currentPrompt: "Who scores?" } });
    assert.deepEqual(diagnostics.answerWait, { previousBubbleCount: 2, expectedMinimumBubbleCount: 3 });
    assert.equal(diagnostics.page.assistantBubbleCount, 3);
    assert.equal(diagnostics.page.composer.disabled, false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

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
    wallNow: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += waits.length === 1 ? ms - 5 : ms;
    },
  });
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  clock += 1_000;
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  clock += 25_000;
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  assert.deepEqual(waits, [12_025, 5]);
  assert.deepEqual(pacer.starts, [1_000, 14_025, 39_025]);
  assert.ok(pacer.starts.slice(1).every((start, index) =>
    start - pacer.starts[index] >= MIN_BROWSER_REQUEST_INTERVAL_MS
  ));
});

test("browser pacer preserves both intervals after a backward wall-clock correction", async () => {
  let monotonicClock = 1_000;
  let wallClock = Date.parse("2026-10-04T17:30:00.000Z");
  const waits = [];
  const pacer = createRequestStartPacer({
    now: () => monotonicClock,
    wallNow: () => wallClock,
    wait: async (ms) => { waits.push(ms); monotonicClock += ms; wallClock += ms; },
  });
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  monotonicClock += 13_025;
  wallClock += 12_925;
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  assert.deepEqual(waits, [100]);
  assert.equal(pacer.starts[1] - pacer.starts[0], 13_125);
  assert.equal(Date.parse(pacer.wallStarts[1]) - Date.parse(pacer.wallStarts[0]), 13_025);
});

test("a forward wall-clock jump cannot bypass the monotonic browser interval", async () => {
  let monotonicClock = 1_000;
  let wallClock = Date.parse("2026-10-04T17:30:00.000Z");
  const pacer = createRequestStartPacer({
    now: () => monotonicClock,
    wallNow: () => wallClock,
    wait: async (ms) => { monotonicClock += ms; wallClock += ms; },
  });
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  monotonicClock += 1_000;
  wallClock += 20_000;
  await pacer.beforeRequest();
  pacer.recordRequestStart({});
  assert.equal(pacer.starts[1] - pacer.starts[0], 13_025);
  assert.equal(Date.parse(pacer.wallStarts[1]) - Date.parse(pacer.wallStarts[0]), 32_025);
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
  pacer.recordRequestStart({});
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

test("actual request pacing survives dispatch delays of 219ms then 52ms", async () => {
  let clock = 1_000;
  const waits = [];
  const pacer = createRequestStartPacer({ now: () => clock, wallNow: () => clock,
    wait: async (ms) => { waits.push(ms); clock += ms; } });
  await pacer.beforeRequest();
  assert.deepEqual(pacer.starts, []);
  clock += 219;
  const first = {};
  const observed = pacer.recordRequestStart(first);
  assert.equal(pacer.recordRequestStart(first), observed);
  assert.equal(pacer.starts.length, 1);
  await pacer.beforeRequest();
  clock += 52;
  pacer.recordRequestStart({});
  pacer.assertComplete();
  assert.deepEqual(waits, [13_025]);
  assert.deepEqual(pacer.starts, [1_219, 14_296]);
  assert.equal(Date.parse(pacer.wallStarts[1]) - Date.parse(pacer.wallStarts[0]), 13_077);
  assert.deepEqual(pacer.failures, []);
});

test("unexpected POSTs and missing network starts fail without authorizing further traffic", async () => {
  const pacer = createRequestStartPacer();
  pacer.recordRequestStart({});
  assert.throws(() => pacer.assertComplete(), /Unexpected \/api\/ask request/);
  await assert.rejects(pacer.beforeRequest(), /Unexpected \/api\/ask request/);
  const missing = createRequestStartPacer();
  await missing.beforeRequest();
  assert.throws(() => missing.assertComplete(), /no observed \/api\/ask request/);
  await assert.rejects(missing.beforeRequest(), /no observed \/api\/ask request/);
  assert.deepEqual(missing.starts, []);
});

test("diagnostics bind the exact monotonic and wall samples once per network request", async () => {
  const events = {};
  let clock = 1_000;
  const pacer = createRequestStartPacer({ now: () => clock, wallNow: () => clock });
  const progress = { collected: {} };
  attachAskDiagnostics({ on: (name, listener) => { events[name] = listener; } }, MOBILE_VIEWPORT, progress, pacer);
  await pacer.beforeRequest();
  clock += 219;
  const request = { method: () => "POST", url: () => "https://api.example.test/api/ask", postDataJSON: () => ({ question: "Briefing" }) };
  events.request(request);
  events.request(request);
  pacer.recordRequestStart(request);
  assert.equal(progress.collected.askRequests.length, 1);
  assert.equal(pacer.starts.length, 1);
  assert.equal(progress.collected.askRequests[0].requestedAt, pacer.wallStarts[0]);
  assert.equal(progress.collected.askRequests[0].monotonicStartMs, pacer.starts[0]);
  assert.equal(progress.collected.askRequests[0].authorized, true);
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


test("canonical fixture selection ignores first-row ordering and team aliases on every surface", async () => {
  const canonical = { fixtureId: "espn:eng.1:123" };
  const selectors = [];
  const locator = {
    isVisible: async () => true,
    waitFor: async () => {},
    getAttribute: async (name) => ({ "data-fixture-id": canonical.fixtureId,
      "data-home": "Man City", "data-away": "Sunderland" })[name] ?? null,
  };
  const page = { locator: (selector) => { selectors.push(selector); return locator; } };
  const featured = await collectFeaturedFixture(page, canonical);
  assert.equal(featured.fixtureId, canonical.fixtureId);
  assert.equal(featured.home, "Man City");
  for (const surface of ["fixture-row", "model-fixture-row"]) fixtureLocator(page, surface, canonical.fixtureId);
  assert.equal(selectors.length, 3);
  assert.ok(selectors.every((selector) => selector.includes('[data-fixture-id="espn:eng.1:123"]')));
  assert.ok(selectors.every((selector) => !/City|Sunderland/.test(selector)));
  assert.throws(() => fixtureLocator(page, "fixture-row", null), /Canonical fixture ID/);
});

test("probability parity reads structured attributes and fails closed for missing values", async () => {
  const locator = { getAttribute: async (name) => ({ "data-p-home": "0.822", "data-p-draw": "0.144", "data-p-away": "0.034" })[name] };
  assert.deepEqual(await structuredProbabilities(locator), [0.822, 0.144, 0.034]);
  assert.equal(await structuredProbabilities({ getAttribute: async () => null }), null);
});

test("a viewport timeout saves report-bound partial evidence before rethrowing without retries", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "pundit-browser-partial-"));
  const report = { runId: "timeout-run", schemaVersion: EVAL_SCHEMA_VERSION,
    completedAt: "2026-09-14T10:00:00.000Z",
    pacing: { requestStarts: ["2026-09-14T09:59:00.000Z"] },
    deployment: { id: "deploy-a", sourceSha: "abc1234" }, apiUrl: "http://localhost:3001" };
  const options = { outputDir, webUrl: "http://localhost:3000", intervalMs: MIN_BROWSER_REQUEST_INTERVAL_MS };
  let calls = 0;
  let closed = false;
  const order = [];
  const page = {
    on: () => {},
    evaluate: async () => { order.push("page snapshot"); return { composer: { value: "Retry me", disabled: false }, alerts: ["Request failed"] }; },
    screenshot: async (options) => { order.push("screenshot"); await writeFile(options.path, "captured-pixels"); },
  };
  const dependencies = {
    captureWebVersion: async () => ({ sha: "abc1234" }),
    captureApiVersion: async () => ({ sha: "abc1234" }),
    canonicalFixtureSnapshot: async () => ({ fixtureId: "espn:eng.1:123", reportMatches: true }),
    loadPlaywright: () => ({ chromium: { launch: async () => ({
      newContext: async () => ({ newPage: async () => page, close: async () => { order.push("context close"); } }),
      close: async () => { closed = true; order.push("browser close"); },
    }) } }),
    runViewportChecks: async (_page, _url, viewport, _pacer, _report, _canonical, _traffic, progress) => {
      calls += 1;
      progress.phase = "fixtures-parity";
      progress.collected.currentPrompt = "What will the 1X2 be?";
      progress.collected.fixtures = { fixtureId: "espn:eng.1:123", probabilities: [0.5, 0.3, 0.2] };
      progress.checks = { "frozen-backtest-rendering": {
        id: "frozen-backtest-rendering", passed: true, evidence: "Already observed frozen artifact",
        reproduction: ["Open evaluation"], scenarioIds: [], viewports: [viewport],
      } };
      throw new Error("locator.getAttribute timed out");
    },
  };
  try {
    await assert.rejects(captureAndPersist(options, report,
      (opts, run) => captureLive(opts, run, dependencies)), /timed out/);
    const evidence = JSON.parse(await readFile(browserOutputPath(outputDir, report.runId), "utf8"));
    assert.equal(evidence.passed, false);
    assert.equal(evidence.failure.phase, "fixtures-parity");
    assert.equal(evidence.runId, report.runId);
    assert.equal(evidence.deploymentId, "deploy-a");
    assert.equal(evidence.collected.fixtures.fixtureId, "espn:eng.1:123");
    assert.deepEqual(evidence.collected.requestStarts, []);
    assert.ok(evidence.checks.some((check) => check.evidence === "Already observed frozen artifact"));
    assert.ok(requiredCheckIds().every((id) => evidence.checks.some((check) => check.id === id)));
    assert.equal(calls, 1);
    assert.equal(closed, true);
    assert.deepEqual(order, ["page snapshot", "screenshot", "context close", "browser close"]);
    assert.equal(evidence.collected.failureDiagnostics.currentPrompt, "What will the 1X2 be?");
    assert.deepEqual(evidence.collected.failureDiagnostics.viewport, MOBILE_VIEWPORT);
    assert.deepEqual(evidence.collected.failureDiagnostics.page.alerts, ["Request failed"]);
    assert.equal(await readFile(evidence.collected.failureDiagnostics.screenshotPath, "utf8"), "captured-pixels");
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("ask diagnostics retain actual response status and transport failure without secrets or unrelated requests", () => {
  const events = {};
  const page = { on: (event, listener) => { events[event] = listener; } };
  const progress = { collected: {} };
  attachAskDiagnostics(page, DESKTOP_VIEWPORT, progress);
  const request = (question, errorText = null) => ({
    method: () => "POST", url: () => "https://api.example.test/api/ask",
    postDataJSON: () => ({ question, fixtureContext: { fixtureId: "espn:eng.1:901" }, secret: "must-not-be-copied" }),
    failure: () => errorText ? { errorText } : null,
  });
  events.request({ method: () => "GET", url: () => "https://api.example.test/ready" });
  const rejected = request("What are the odds?");
  events.request(rejected);
  events.response({ request: () => rejected, status: () => 429 });
  events.requestfinished(rejected);
  const aborted = request("Back to that match", "net::ERR_ABORTED");
  events.request(aborted);
  events.requestfailed(aborted);
  assert.equal(progress.collected.askRequests.length, 2);
  assert.equal(progress.collected.askRequests[0].status, 429);
  assert.equal(progress.collected.askRequests[1].requestFailed, "net::ERR_ABORTED");
  assert.equal(progress.collected.askRequests[1].url, "https://api.example.test/api/ask");
  assert.equal(progress.collected.currentPrompt, "Back to that match");
  assert.equal(JSON.stringify(progress).includes("must-not-be-copied"), false);
  for (let index = 0; index < 55; index++) { const item = request("x".repeat(1_000)); events.request(item); events.requestfinished(item); }
  assert.equal(progress.collected.askRequests.length, 50);
  assert.equal(progress.collected.currentPrompt.length, 501);
});

test("failure page snapshots are bounded and include the restored composer and all alerts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "pundit-browser-diagnostic-"));
  const input = { value: "x".repeat(1_000), disabled: false };
  const document = {
    title: "Pundit", documentElement: { scrollWidth: 390 }, body: { innerText: "b".repeat(20_000) },
    querySelector: (selector) => selector.startsWith("textarea") ? input : { outerHTML: "d".repeat(30_000) },
    querySelectorAll: (selector) => selector === '[data-testid="desk-pundit-bubble"]' ? [{}, {}, {}]
      : selector === "button" ? [{ getAttribute: () => "Send", disabled: true }]
      : [{ textContent: "" }, { textContent: "Actual error" }],
  };
  const page = {
    evaluate: async (predicate) => runInNewContext(`(${predicate.toString()})()`, {
      document, location: { href: "https://web.example.test/" }, innerWidth: 390, innerHeight: 844,
    }),
    screenshot: async () => { throw new Error("Renderer unavailable"); },
  };
  try {
    const evidence = await captureFailureDiagnostics(page, MOBILE_VIEWPORT, { outputDir }, { runId: "diagnostic-run" }, { collected: { currentPrompt: "Original submitted question" } });
    assert.equal(evidence.page.composer.value.length, 501);
    assert.equal(evidence.page.bodyText.length, 12_000);
    assert.equal(evidence.page.dom.length, 24_000);
    assert.equal(evidence.page.assistantBubbleCount, 3);
    assert.deepEqual(Array.from(evidence.page.alerts), ["", "Actual error"]);
    assert.equal(evidence.currentPrompt, "Original submitted question");
    assert.match(evidence.errors[0], /Renderer unavailable/);
    assert.equal(evidence.screenshotPath, undefined);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test("a run with no priced fixture still captures both viewports as incomplete evidence", async () => {
  const report = {
    runId: "no-fixture-run", schemaVersion: EVAL_SCHEMA_VERSION,
    completedAt: "2026-09-14T10:00:00.000Z",
    pacing: { requestStarts: ["2026-09-14T09:59:00.000Z"] },
    deployment: { id: "deploy-a", sourceSha: "abc1234" },
    apiUrl: "http://localhost:3001",
    preflight: { fixtureDiscovery: { featured: null } },
  };
  const seen = [];
  const evidence = await captureLive(
    { webUrl: "http://localhost:3000", intervalMs: MIN_BROWSER_REQUEST_INTERVAL_MS },
    report,
    {
      captureWebVersion: async () => ({ sha: "abc1234" }),
      captureApiVersion: async () => ({ sha: "abc1234", deploymentId: "deploy-a" }),
      canonicalFixtureSnapshot: async () => null,
      loadPlaywright: () => ({ chromium: { launch: async () => ({
        newContext: async () => ({ newPage: async () => ({ on: () => {} }), close: async () => {} }),
        close: async () => {},
      }) } }),
      runViewportChecks: async (_page, _url, viewport, _pacer, _report, canonical) => {
        seen.push({ viewport, canonical });
        return [{ id: "cross-surface-fixture-parity", passed: false,
          evidence: "No priced fixture exists in the evaluated window.",
          reproduction: ["Inspect the active slate"], scenarioIds: [], viewports: [viewport] }];
      },
    }
  );
  assert.equal(evidence.passed, false);
  assert.equal(evidence.failure, undefined);
  assert.deepEqual(seen.map(({ viewport }) => viewport), [MOBILE_VIEWPORT, DESKTOP_VIEWPORT]);
  assert.ok(seen.every(({ canonical }) => canonical === null));
});


test("canonical fixture outside the three opening chips is selected from the full slate", async () => {
  const canonical = { fixtureId: "espn:eng.1:999", home: "Leeds", away: "Newcastle" };
  const selectors = [];
  const slate = { waitFor: async () => {} };
  const page = { locator: (selector) => {
    selectors.push(selector);
    return selector.includes("desk-featured-fixture")
      ? { isVisible: async () => false }
      : (assert.ok(selector.endsWith(":visible")), slate);
  } };
  const selected = await collectFeaturedFixture(page, canonical);
  assert.equal(selected.source, "slate");
  assert.equal(selected.fixtureId, canonical.fixtureId);
  assert.equal(selected.locator, slate);
  assert.ok(selectors.every((selector) => selector.includes(canonical.fixtureId)));
});
