import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVAL_SCHEMA_VERSION,
  abortSseAfterGrounding,
  classifyResult,
  compareReports,
  createComparisonBaseline,
  createPacer,
  executeRuntimeHelperScenario,
  fetchWithTimeout,
  finalizeClassifications,
  generateAdversarialScenarios,
  gradeDeploymentShas,
  describeDeploymentShas,
  loadPreviousReport,
  loadApiRuntimeCorrectnessHelpers,
  loadApiRuntimeFixtureHelpers,
  loadApiRuntimeRoutingHelpers,
  parseSse,
  recordScenarioFailure,
  recordOptionalScenarioFailure,
  readinessFailures,
  routableRecognizedEntries,
  enabledCompetitionIds,
  describeRecognizedRoutability,
  selectFeaturedMatch,
  selectSuggestionChips,
  selectTwoLeggedTie,
  snapshotAskRequest,
  snapshotSseReproduction,
  validateGrounding,
  validateSse,
  validateAnswerCopy,
  validateAnalystExpression,
  validateAnswerStructure,
  validateAbstainedCounterfactualDiscipline,
  validateCitationContract,
  validateErrorCopy,
  validateFixtureGrounding,
  validateNoDraftLeak,
  validateOneXTwoMarket,
  validateResponseCorrectness,
  validateTeamNewsDiscipline,
  summarizeWebSearchTelemetry,
  validateVerification,
  ABSTAINED_VERIFICATION,
  establishedNothing,
  writeCheckpoint,
  writeFailureReport,
  writeReport
} from "./chat-battle-test-lib.mjs";

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

function completeBrowserEvidence(identity, overrides = {}) {
  const checkViewports = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
  return {
    ...identity,
    url: "https://thepundit.vercel.app/",
    viewport: { width: 390, height: 844 },
    viewports: [{ width: 390, height: 844 }, { width: 1440, height: 900 }],
    console: { errors: [], warnings: [] },
    passed: true,
    summary: "Required production browser contracts passed.",
    checks: [
      {
        id: "fixture-capability-label",
        passed: true,
        evidence: "Observed the recognized-fixture capability label.",
        reproduction: ["Open the recognized fixture", "Submit the fixture question"],
        scenarioIds: ["recognized-friendly-outside-coverage"],
        viewports: checkViewports,
      },
      {
        id: "fixture-context-retention",
        passed: true,
        evidence: "Observed the same fixture after a table detour and follow-up.",
        reproduction: ["Ask about the fixture", "Ask for the table", "Return to the fixture"],
        scenarioIds: ["table-route-preserves-match", "unsupported-followup-and-matchup-replacement"],
        viewports: checkViewports,
      },
      {
        id: "new-chat-clears-context",
        passed: true,
        evidence: "New Chat removed the retained fixture and visible transcript.",
        reproduction: ["Establish fixture context", "Choose New Chat", "Inspect cleared state"],
        scenarioIds: [],
        viewports: checkViewports,
      },
      {
        id: "candidate-no-fixture-badge",
        passed: true,
        evidence: "An unrecognized candidate displayed no fixture badge.",
        reproduction: ["Submit the candidate matchup", "Inspect the assistant badge area"],
        scenarioIds: ["candidate-never-becomes-fixture"],
        viewports: checkViewports,
      },
      {
        id: "analyst-multi-turn-flow",
        passed: true,
        evidence: "The six-turn analyst conversation stayed scoped and retained its fixture.",
        reproduction: ["Run the golden conversation", "Inspect every follow-up"],
        scenarioIds: ["analyst-conversation-golden-path"],
        viewports: checkViewports,
        turnCount: 6,
      },
      {
        id: "cross-surface-fixture-parity",
        passed: true,
        evidence: "Chat, Predictions and Fixtures showed the same fixture capability and market rows.",
        reproduction: ["Open the fixture in Chat", "Compare Predictions and Fixtures"],
        scenarioIds: ["analyst-conversation-golden-path", "market-comparison-coverage"],
        viewports: checkViewports,
        surfaces: ["chat", "fixtures", "predictions"],
      },
      {
        id: "evaluation-calibration-presentation",
        passed: true,
        evidence: "WC and club-season pages identify forecasts and show one consistent timestamp.",
        reproduction: ["Open both evaluation pages", "Inspect headers and calibration tables"],
        scenarioIds: [],
        viewports: checkViewports,
      },
    ],
    ...overrides,
  };
}

function browserContractScenarios() {
  return [
    "recognized-friendly-outside-coverage",
    "table-route-preserves-match",
    "unsupported-followup-and-matchup-replacement",
    "candidate-never-becomes-fixture",
    "analyst-conversation-golden-path",
    "market-comparison-coverage",
  ].map((id) => ({ id, passed: true, outcome: "PASS", evidence: "Browser contract prerequisite." }));
}

test("selectFeaturedMatch uses a model-backed active club fixture with known teams", () => {
  const match = selectFeaturedMatch([
    { competitionId: "eng.1", home: "TBD", away: "Arsenal" },
    { competitionId: "fifa.world", home: "Semifinal 1 Winner", away: "Spain" },
    { competitionId: "uefa.champions_qual", home: "Riga FC", away: "Ararat-Armenia" }
  ]);
  assert.equal(match.home, "Riga FC");
  assert.equal(selectFeaturedMatch([]), null);
});

// The evaluator could not see the two-legged shape at all: every fixture
// scenario supplies a fixtureContext, so none of them asked a bare "X vs Y" of
// a club pair that forms two fixtures -- the question that returned no
// grounding in production.
test("selectTwoLeggedTie finds the earliest club pair that meets twice", () => {
  const legs = selectTwoLeggedTie([
    { competitionId: "eng.1", home: "Arsenal", away: "Coventry City", fixtureId: 1, utcDate: "2026-08-17T15:00:00Z" },
    { competitionId: "uefa.champions_qual", home: "Viking", away: "Dinamo Zagreb", fixtureId: 3, utcDate: "2026-08-26T19:00:00Z" },
    { competitionId: "uefa.champions_qual", home: "Dinamo Zagreb", away: "Viking", fixtureId: 2, utcDate: "2026-08-18T19:00:00Z" },
  ]);
  assert.equal(legs.length, 2);
  assert.equal(legs[0].fixtureId, 2, "legs are ordered by kickoff");
  assert.equal(legs[1].fixtureId, 3);
  assert.equal(selectTwoLeggedTie([
    { competitionId: "eng.1", home: "Arsenal", away: "Coventry City", fixtureId: 1, utcDate: "2026-08-17T15:00:00Z" },
  ]), null);
  assert.equal(selectTwoLeggedTie([]), null);
});

test("selectSuggestionChips reproduces the homepage chips with their fixture identity", () => {
  const chips = selectSuggestionChips([
    { competitionId: "uefa.champions_qual", competition: "UEFA Champions League Qualifiers", home: "Dinamo Zagreb", away: "Viking", fixtureId: 2, utcDate: "2026-08-18T19:00:00Z" },
    { competitionId: "eng.1", competition: "Premier League", home: "TBD", away: "Arsenal", fixtureId: 4, utcDate: "2026-08-19T19:00:00Z" },
  ]);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].fixtureId, "espn:uefa.champions_qual:2");
  assert.match(chips[0].text, /^Dinamo Zagreb vs Viking · UCL · /);
});

test("SSE parser and validator enforce grounding, delta, done order", () => {
  const grounding = {
    kind: "competition",
    competitionId: "eng.1",
    updatedAt: "2026-07-28T00:00:00.000Z",
    standings: [{
      position: 1,
      team: "Arsenal",
      playedGames: 0,
      points: 0,
      goalDifference: 0,
    }],
  };
  const events = parseSse([
    `event: grounding\ndata: ${JSON.stringify({ grounding })}`,
    'event: delta\ndata: {"text":"Hello"}',
    `event: done\ndata: ${JSON.stringify({ answer: "Hello", grounding })}`,
    ""
  ].join("\n\n"));
  assert.deepEqual(events.map(({ event }) => event), ["grounding", "delta", "done"]);
  const expectation = { expectGrounding: "competition", expectCompetitionId: "eng.1" };
  assert.equal(validateSse(events, expectation).passed, true);
  assert.equal(validateSse(events.slice().reverse(), expectation).passed, false);
});

test("cancellation consumes delayed SSE grounding before aborting the body read", async () => {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  let reads = 0;
  const response = {
    body: {
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads === 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
              done: false,
              value: encoder.encode('event: grounding\ndata: {"kind":"competition"}'),
            };
          }
          if (reads === 2) return { done: false, value: encoder.encode("\n\n") };
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          return new Promise((_, reject) => controller.signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          ));
        },
      }),
    },
  };
  const result = await abortSseAfterGrounding(response, controller, { timeoutMs: 250 });
  assert.equal(result.groundingObserved, true);
  assert.equal(result.abortErrorObserved, true);
  assert.ok(result.abortLatencyMs < 250);
  assert.equal(reads, 3);
});

test("grounding validation checks tier-specific payload fidelity", () => {
  const match = validateGrounding({
    kind: "match",
    competitionId: "eng.1",
    home: "Arsenal",
    away: "Liverpool",
    pHome: 0.4,
    pDraw: 0.3,
    pAway: 0.3,
    pOver2_5: 0.52,
    pUnder2_5: 0.48,
    pBttsYes: 0.55,
    pBttsNo: 0.45,
    topScores: [{ score: "1-1", probability: 0.12 }],
    scorelines: [{ score: "1-1", probability: 0.12 }],
    oddsSources: [],
  }, {
    expectGrounding: "match",
    expectCompetitionId: "eng.1",
    expectTeams: ["Liverpool", "Arsenal"],
  });
  assert.equal(match.passed, true);
  assert.equal(validateGrounding({ kind: "match", pHome: 2 }, {
    expectGrounding: "match",
    expectCompetitionId: "eng.1",
  }).passed, false);
  assert.equal(validateGrounding(null, { expectGrounding: null }).passed, true);
  assert.equal(validateGrounding({ kind: "competition", standings: [] }, {
    expectGrounding: "competition",
    expectCompetitionId: "eng.1",
  }).passed, false);
});

test("classification distinguishes baseline, regression, pass, and inconclusive", () => {
  assert.equal(classifyResult({ passed: true, outcome: "PASS" }, null), "PASS");
  assert.equal(classifyResult({ passed: false, outcome: "FAIL" }, null), "FAIL");
  assert.equal(classifyResult(
    { passed: false, outcome: "FAIL", failure: { kind: "timeout" } }, null
  ), "FAIL");
  assert.equal(classifyResult(
    { passed: false, outcome: "FAIL" },
    { passed: true, classification: "PASS" }
  ), "REGRESSION");
  assert.equal(classifyResult(
    { passed: true, outcome: "PASS" },
    { passed: false, classification: "EXISTING ISSUE" }
  ), "INTERMITTENT");
  assert.equal(classifyResult(
    { passed: false, outcome: "FAIL", failure: { kind: "timeout" } },
    { passed: true, classification: "PASS" }
  ), "INTERMITTENT");
  assert.equal(classifyResult(
    { passed: false, outcome: "FAIL", failure: { kind: "timeout" } },
    { passed: false, classification: "INTERMITTENT", failure: { kind: "timeout" } }
  ), "EXISTING ISSUE");
  assert.equal(classifyResult({ passed: false, outcome: "INCONCLUSIVE" }, null), "INCONCLUSIVE");
});

test("fetch timeout keeps explicit attributable evidence", async () => {
  const neverCompletes = async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(
    fetchWithTimeout("https://example.test", {}, 5, neverCompletes),
    /request timed out after 5ms/
  );
});

test("request evidence snapshots do not gain later conversation turns", () => {
  const history = [];
  const turn1 = snapshotAskRequest({
    question: "First question",
    history,
    teamContext: ["Alpha", "Beta"],
    fixtureContext: { fixtureId: "fixture-1" },
  });
  history.push(
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" }
  );
  const turn2 = snapshotAskRequest({
    question: "Second question",
    history,
    teamContext: ["Alpha", "Beta"],
    fixtureContext: { fixtureId: "fixture-1" },
  });
  history.push(
    { role: "user", content: "Second question" },
    { role: "assistant", content: "Second answer" }
  );
  assert.deepEqual(turn1.history, []);
  assert.deepEqual(turn2.history, [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
  ]);
  assert.notEqual(turn2.history, history);
});

test("failed SSE requests have an immutable reproduction before transport validation", () => {
  const reproduction = snapshotSseReproduction("What does the current table show?");
  assert.deepEqual(reproduction, {
    method: "POST",
    path: "/api/ask",
    body: {
      question: "What does the current table show?",
      history: [],
      teamContext: undefined,
      fixtureContext: undefined,
      stream: true,
    },
  });
});

test("readiness gating names each failed component", () => {
  assert.deepEqual(readinessFailures({
    status: "loading",
    model: { ready: true },
    football: { ready: false },
    activeFixtures: { lastUpdated: "2026-07-28T00:00:00.000Z" },
    marketOdds: { ready: false }
  }), ["status=loading", "football.ready=false", "marketOdds.ready=false"]);
  assert.deepEqual(readinessFailures({
    status: "ready",
    model: { ready: true },
    football: { ready: true },
    activeFixtures: { lastUpdated: "2026-07-28T00:00:00.000Z" },
    marketOdds: { ready: true }
  }), []);
});

test("schema-17 preserves bounded post-run web-search telemetry without inventing attribution", () => {
  assert.deepEqual(summarizeWebSearchTelemetry(
    { webSearch: { totalSearches: 7, consecutiveFailures: 1 } },
    { webSearch: { totalSearches: 11, consecutiveFailures: 0 } }
  ), {
    preflightTotalSearches: 7,
    postRunTotalSearches: 11,
    totalSearchesDelta: 4,
    preflightConsecutiveFailures: 1,
    postRunConsecutiveFailures: 0,
  });
  assert.deepEqual(summarizeWebSearchTelemetry({}, null), {
    preflightTotalSearches: null,
    postRunTotalSearches: null,
    totalSearchesDelta: null,
    preflightConsecutiveFailures: null,
    postRunConsecutiveFailures: null,
  });
});

test("pacer uses monotonic observed gaps, a safety margin and a post-sleep recheck", async () => {
  let clock = 1_000;
  const waits = [];
  const pacer = createPacer(13_000, {
    now: () => clock,
    sleep: async (delay) => {
      waits.push(delay);
      clock += delay;
    }
  });
  await pacer.beforeRequest();
  clock += 2_000;
  await pacer.beforeRequest();
  assert.deepEqual(waits, [11_025]);
  assert.equal(Date.parse(pacer.starts[1]) - Date.parse(pacer.starts[0]), 13_025);
  assert.deepEqual(pacer.observedStartOffsetsMs, [0, 13_025]);
  assert.deepEqual(pacer.observedGapsMs, [13_025]);
});

test("pacer rechecks a timer that wakes early before preserving the next start", async () => {
  let clock = 5_000;
  const waits = [];
  const pacer = createPacer(13_000, {
    now: () => clock,
    safetyMarginMs: 25,
    sleep: async (delay) => {
      waits.push(delay);
      clock += waits.length === 1 ? delay - 100 : delay;
    },
  });
  await pacer.beforeRequest();
  await pacer.beforeRequest();
  assert.equal(waits.length, 2);
  assert.ok(pacer.observedGapsMs[0] >= 13_000);
});

test("report comparison stays comparable across deployments when the schema matches", () => {
  const base = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "current",
    deployment: { id: "deploy-b" },
    scenarios: [{ id: "one", classification: "PASS" }]
  };
  const deploymentChange = compareReports(base, {
    ...base,
    runId: "previous",
    deployment: { id: "deploy-a" }
  });
  assert.equal(deploymentChange.comparable, true);
  assert.match(deploymentChange.reason, /across deployments/);
  assert.equal(compareReports(base, {
    ...base,
    runId: "previous",
    schemaVersion: EVAL_SCHEMA_VERSION - 1
  }).reason, "evaluation schema changed");
});

test("schema changes cannot classify a recovered check as intermittent", () => {
  const current = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "current",
    deployment: { id: "deploy-a" },
    scenarios: [{ id: "one", passed: true, outcome: "PASS" }]
  };
  const previous = {
    schemaVersion: EVAL_SCHEMA_VERSION - 1,
    runId: "previous",
    deployment: { id: "deploy-a" },
    scenarios: [{ id: "one", passed: false, outcome: "FAIL", classification: "EXISTING ISSUE" }]
  };
  finalizeClassifications(current, previous);
  assert.equal(current.scenarios[0].classification, "PASS");
  assert.equal(current.comparison.comparable, false);
});

test("same-schema deployment failures classify against the prior complete report", () => {
  const current = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "current",
    deployment: { id: "deploy-b" },
    scenarios: [{ id: "one", passed: false, outcome: "FAIL" }]
  };
  const previous = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "previous",
    deployment: { id: "deploy-a" },
    scenarios: [{ id: "one", passed: true, outcome: "PASS", classification: "PASS" }]
  };
  finalizeClassifications(current, previous);
  assert.equal(current.scenarios[0].classification, "REGRESSION");
  assert.equal(current.comparison.comparable, true);
});

test("comparison baseline preserves only immutable fields needed by the finalizer", () => {
  const previous = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "prior-run",
    deployment: { id: "deploy-a", sourceSha: "secretly-irrelevant" },
    scenarios: [{
      id: "answer",
      passed: true,
      outcome: "PASS",
      classification: "PASS",
      answer: "Large answer must not be copied.",
    }],
  };
  const baseline = createComparisonBaseline(previous);
  previous.scenarios[0].classification = "REGRESSION";
  assert.deepEqual(baseline, {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "prior-run",
    deployment: { id: "deploy-a" },
    scenarios: [{
      id: "answer",
      passed: true,
      outcome: "PASS",
      classification: "PASS",
      failure: undefined,
    }],
  });
});

test("preserved comparator classifies a recovered same-schema scenario intermittent", () => {
  const prior = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "prior-failure",
    deployment: { id: "deploy-a" },
    scenarios: [{ id: "answer", passed: false, outcome: "FAIL", classification: "EXISTING ISSUE" }],
  };
  const current = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "current-pass",
    deployment: { id: "deploy-b" },
    scenarios: [{ id: "answer", passed: true, outcome: "PASS" }],
  };
  finalizeClassifications(current, createComparisonBaseline(prior));
  assert.equal(current.scenarios[0].classification, "INTERMITTENT");
  assert.equal(current.comparison.previousRunId, "prior-failure");
});

test("adversarial generation covers exactly five required categories", () => {
  const scenarios = generateAdversarialScenarios("2026-07-27", null);
  assert.deepEqual(scenarios.map(({ category }) => category), [
    "ambiguity",
    "follow-ups",
    "grounding",
    "unsupported-certainty",
    "malformed-inputs"
  ]);
  assert.equal(scenarios[2].kind, "inconclusive");
  assert.equal(JSON.stringify(scenarios).includes("World Cup"), false);
  assert.equal(scenarios[1].turns[0].expectGrounding, "season");
  assert.equal(scenarios[1].turns[0].expectTableSourceFidelity, true);
  assert.equal(scenarios[1].turns[0].expectSeasonRanking, undefined);
  assert.equal(scenarios[1].turns[1].question.includes("current table cannot rank"), true);
  assert.equal(scenarios[3].turns[0].expectSeasonRanking, true);
  assert.equal(scenarios[3].turns[0].question.includes("season outlook"), true);
  assert.equal(scenarios[3].turns[1].expectNoCertaintyContradiction, true);
});

test("atomic report writing preserves the previous report and updates latest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-eval-"));
  const makeReport = (runId, passed) => finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId,
    startedAt: "2026-07-27T00:00:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234" },
    scenarios: [{
      id: "scenario",
      passed,
      outcome: passed ? "PASS" : "FAIL",
      evidence: "test"
    }],
    browserEvidence: null,
    recommendations: []
  }, null);
  const first = makeReport("first", true);
  await writeReport(first, directory);
  const second = makeReport("second", false);
  await writeReport(second, directory);
  assert.equal((await loadPreviousReport(directory)).runId, "second");
  assert.equal(
    JSON.parse(await readFile(path.join(directory, "latest-run.json"), "utf8")).runId,
    "second"
  );
  assert.equal(JSON.parse(await readFile(path.join(directory, "first.json"), "utf8")).runId, "first");
});

test("checkpoint writing preserves latest while recording active request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-checkpoint-"));
  const previous = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "previous",
    startedAt: "2026-07-27T00:00:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234" },
    scenarios: [{
      id: "scenario",
      passed: true,
      outcome: "PASS",
      evidence: "test"
    }],
    browserEvidence: null,
    recommendations: []
  }, null);
  await writeReport(previous, directory);
  const partial = {
    ...previous,
    runId: "current",
    progress: {
      status: "running",
      activeScenario: { id: "adversarial-follow-up" },
      activeRequest: {
        scenarioId: "adversarial-follow-up",
        turn: 2,
        startedAt: "2026-07-27T00:01:00.000Z",
      },
      completedScenarioIds: ["competition-grounding"],
      failure: null,
    },
  };
  const checkpointPath = await writeCheckpoint(partial, directory);
  assert.equal((await loadPreviousReport(directory)).runId, "previous");
  assert.deepEqual(
    JSON.parse(await readFile(checkpointPath, "utf8")).progress.activeRequest,
    partial.progress.activeRequest
  );
  const failurePaths = await writeFailureReport(partial, directory);
  assert.equal((await loadPreviousReport(directory)).runId, "previous");
  assert.equal(
    JSON.parse(await readFile(path.join(directory, "latest-run.json"), "utf8")).runId,
    "current"
  );
  assert.equal(
    JSON.parse(await readFile(failurePaths.jsonPath, "utf8")).runId,
    "current"
  );
});

test("finalizer enriches the latest failed run without replacing latest complete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-"));
  const complete = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "complete",
    startedAt: "2026-07-27T00:00:00.000Z",
    completedAt: "2026-07-27T00:01:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234" },
    webUrl: "https://thepundit.vercel.app",
    scenarios: [{
      id: "scenario",
      passed: true,
      outcome: "PASS",
      classification: "PASS",
      evidence: "test",
    }],
    progress: { status: "complete" },
    browserEvidence: null,
    criticReview: null,
    recommendations: [],
    comparison: { reason: "baseline" },
    overall: "PASS",
  };
  await writeReport(complete, directory);
  const failed = {
    ...complete,
    runId: "failed",
    progress: { status: "failed" },
    scenarios: [{
      id: "scenario",
      passed: false,
      outcome: "FAIL",
      classification: "INTERMITTENT",
      evidence: "request timed out",
      failure: { kind: "timeout", message: "request timed out" },
    }],
    overall: "ISSUES FOUND",
  };
  await writeFailureReport(failed, directory);
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  const evidenceIdentity = {
    runId: "failed",
    schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234",
    deploymentId: "deploy-a",
    capturedAt: "2026-07-27T00:06:00.000Z",
  };
  await writeFile(browserPath, JSON.stringify(completeBrowserEvidence(evidenceIdentity)));
  await writeFile(criticPath, JSON.stringify({
    ...evidenceIdentity,
    materialIssue: false,
    overallVerdict: "PASS",
    scenarioVerdicts: [],
    recommendations: ["Keep monitoring."],
  }));

  const result = await runNode([
    "scripts/finalize-chat-report.mjs",
    "--output-dir", directory,
    "--browser-json", browserPath,
    "--critic-json", criticPath,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await loadPreviousReport(directory)).runId, "complete");
  const latestRun = JSON.parse(
    await readFile(path.join(directory, "latest-run.json"), "utf8")
  );
  assert.equal(latestRun.runId, "failed");
  assert.equal(latestRun.browserEvidence.summary, "Required production browser contracts passed.");
  assert.deepEqual(latestRun.recommendations, ["Keep monitoring."]);
});

test("finalizer rejects browser or critic evidence from another run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-mismatch-"));
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "expected-run",
    startedAt: "2026-08-13T10:00:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234" },
    webUrl: "https://thepundit.vercel.app",
    scenarios: browserContractScenarios(),
    progress: { status: "complete" },
    browserEvidence: null,
    recommendations: [],
  }, null);
  await writeReport(report, directory);
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  const identity = {
    runId: "wrong-run",
    schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234",
    deploymentId: "deploy-a",
    capturedAt: "2026-08-13T10:01:00.000Z",
  };
  await writeFile(browserPath, JSON.stringify(completeBrowserEvidence(identity)));
  await writeFile(criticPath, JSON.stringify({
    ...identity,
    materialIssue: false,
    overallVerdict: "PASS",
    scenarioVerdicts: [],
  }));
  const result = await runNode([
    "scripts/finalize-chat-report.mjs",
    "--output-dir", directory,
    "--browser-json", browserPath,
    "--critic-json", criticPath,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /runId mismatch/);
});

test("finalizer rejects a generic browser pass without named UI contract coverage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-browser-schema-"));
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "browser-contract-run",
    startedAt: "2026-08-13T10:00:00.000Z",
    webUrl: "https://thepundit.vercel.app",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234", shaConverged: true },
    scenarios: browserContractScenarios(),
    progress: { status: "complete" },
    browserEvidence: null,
    recommendations: [],
  }, null);
  await writeReport(report, directory);
  const identity = {
    runId: "browser-contract-run",
    schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234",
    deploymentId: "deploy-a",
    capturedAt: "2026-08-13T10:01:00.000Z",
  };
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  await writeFile(browserPath, JSON.stringify({
    ...identity,
    url: "https://thepundit.vercel.app/",
    viewport: { width: 390, height: 844 },
    console: { errors: [], warnings: [] },
    passed: true,
    summary: "Generic browser flow passed.",
    checks: [{
      id: "chat-flow",
      passed: true,
      evidence: "The page rendered.",
      reproduction: ["Open the homepage"],
      scenarioIds: [],
    }],
  }));
  await writeFile(criticPath, JSON.stringify({
    ...identity,
    materialIssue: false,
    overallVerdict: "PASS",
    scenarioVerdicts: [],
  }));

  const result = await runNode([
    "scripts/finalize-chat-report.mjs",
    "--output-dir", directory,
    "--browser-json", browserPath,
    "--critic-json", criticPath,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing required check: fixture-capability-label/);
});

test("finalizer binds every mandatory browser check to mobile and desktop evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-check-viewports-"));
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "check-viewport-run",
    startedAt: "2026-08-13T10:00:00.000Z",
    webUrl: "https://thepundit.vercel.app",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234", shaConverged: true },
    scenarios: browserContractScenarios(),
    progress: { status: "complete" },
    browserEvidence: null,
    recommendations: [],
  }, null);
  await writeReport(report, directory);
  const identity = {
    runId: "check-viewport-run",
    schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234",
    deploymentId: "deploy-a",
    capturedAt: "2026-08-13T10:01:00.000Z",
  };
  const browserEvidence = completeBrowserEvidence(identity);
  browserEvidence.checks.find(({ id }) => id === "analyst-multi-turn-flow").viewports = [
    { width: 390, height: 844 },
  ];
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  await writeFile(browserPath, JSON.stringify(browserEvidence));
  await writeFile(criticPath, JSON.stringify({
    ...identity,
    materialIssue: false,
    overallVerdict: "PASS",
    scenarioVerdicts: [],
  }));

  const result = await runNode([
    "scripts/finalize-chat-report.mjs",
    "--output-dir", directory,
    "--browser-json", browserPath,
    "--critic-json", criticPath,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /browser check analyst-multi-turn-flow requires mobile and desktop evidence/);
});

test("finalizer requires and applies explicit critic correctness for every passed answer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-correctness-"));
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "critic-run",
    startedAt: "2026-08-13T10:00:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234", shaConverged: true },
    webUrl: "https://thepundit.vercel.app",
    scenarios: [...browserContractScenarios(), {
      id: "answer-scenario", passed: true, outcome: "PASS", answer: "Grounded answer.",
      qualitativeScores: { correctness: null }, requiredForCertification: true,
      turnResults: [{ turn: 1, status: 200, answer: "Grounded answer." }],
    }],
    pacing: { minimumIntervalMs: 13_000, requestStarts: ["2026-08-13T10:00:00.000Z"], observedStartOffsetsMs: [0], observedGapsMs: [] },
    progress: { status: "complete" }, browserEvidence: null, recommendations: [],
  }, null);
  assert.equal(report.overall, "ISSUES FOUND");
  await writeReport(report, directory);
  const identity = {
    runId: "critic-run", schemaVersion: EVAL_SCHEMA_VERSION, sourceSha: "abc1234",
    deploymentId: "deploy-a", capturedAt: "2026-08-13T10:01:00.000Z",
  };
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  await writeFile(browserPath, JSON.stringify(completeBrowserEvidence(identity)));
  await writeFile(criticPath, JSON.stringify({
    ...identity, materialIssue: false, overallVerdict: "PASS", recommendations: [],
    scenarioVerdicts: [{ scenarioId: "answer-scenario", verdict: "PASS", correctness: 4, reason: "Verified." }],
    turnVerdicts: [{ scenarioId: "answer-scenario", turn: 1, verdict: "PASS", correctness: 4, reason: "Verified." }],
  }));
  const result = await runNode(["scripts/finalize-chat-report.mjs", "--output-dir", directory,
    "--browser-json", browserPath, "--critic-json", criticPath]);
  assert.equal(result.code, 0, result.stderr);
  const finalized = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  assert.equal(finalized.overall, "PASS");
  assert.equal(
    finalized.scenarios.find(({ id }) => id === "answer-scenario").qualitativeScores.correctness,
    4
  );
});

test("finalizer requires critic coverage for every successful HTTP-200 turn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-turn-critic-"));
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "turn-critic-run",
    startedAt: "2026-08-13T10:00:00.000Z",
    deployment: { id: "deploy-a", source: "test", sourceSha: "abc1234", shaConverged: true },
    webUrl: "https://thepundit.vercel.app",
    scenarios: [...browserContractScenarios(), {
      id: "two-turn-answer", passed: true, outcome: "PASS", answer: "Second answer.",
      qualitativeScores: { correctness: null }, requiredForCertification: true,
      turnResults: [
        { turn: 1, status: 200, answer: "First answer." },
        { turn: 2, status: 200, answer: "Second answer." },
      ],
    }],
    progress: { status: "complete" }, browserEvidence: null, criticReview: null,
    recommendations: [],
  }, null);
  await writeReport(report, directory);
  const identity = { runId: "turn-critic-run", schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234", deploymentId: "deploy-a", capturedAt: "2026-08-13T10:01:00.000Z" };
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  await writeFile(browserPath, JSON.stringify(completeBrowserEvidence(identity)));
  const critic = {
    ...identity, materialIssue: false, overallVerdict: "PASS", recommendations: [],
    scenarioVerdicts: [{ scenarioId: "two-turn-answer", verdict: "PASS", correctness: 4, reason: "Final answer verified." }],
    turnVerdicts: [{ scenarioId: "two-turn-answer", turn: 1, verdict: "PASS", correctness: 4, reason: "First answer verified." }],
  };
  await writeFile(criticPath, JSON.stringify(critic));
  const missing = await runNode(["scripts/finalize-chat-report.mjs", "--output-dir", directory,
    "--browser-json", browserPath, "--critic-json", criticPath]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /two-turn-answer#2/);

  critic.turnVerdicts.push({
    scenarioId: "two-turn-answer", turn: 2, verdict: "ISSUES FOUND", correctness: 2,
    reason: "Second turn contains a material error.",
  });
  critic.materialIssue = true;
  critic.overallVerdict = "ISSUES FOUND";
  await writeFile(criticPath, JSON.stringify(critic));
  const finalizedResult = await runNode(["scripts/finalize-chat-report.mjs", "--output-dir", directory,
    "--browser-json", browserPath, "--critic-json", criticPath]);
  assert.equal(finalizedResult.code, 0, finalizedResult.stderr);
  const finalized = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  assert.equal(finalized.scenarios.find(({ id }) => id === "two-turn-answer").outcome, "FAIL");
  assert.equal(finalized.overall, "ISSUES FOUND");
});

test("finalizer preserves same-schema comparator when critic turns a prior pass into a failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pundit-chat-finalize-comparator-"));
  const prior = {
    schemaVersion: EVAL_SCHEMA_VERSION, runId: "prior", deployment: { id: "deploy-a" },
    scenarios: [{ id: "answer-scenario", passed: true, outcome: "PASS", classification: "PASS" }],
  };
  const report = finalizeClassifications({
    schemaVersion: EVAL_SCHEMA_VERSION, runId: "critic-regression",
    startedAt: "2026-08-13T10:00:00.000Z",
    deployment: { id: "deploy-b", source: "test", sourceSha: "abc1234", shaConverged: true },
    webUrl: "https://thepundit.vercel.app",
    scenarios: [...browserContractScenarios(),
      { id: "answer-scenario", passed: true, outcome: "PASS", answer: "Wrong answer.",
        qualitativeScores: { correctness: null }, requiredForCertification: true }],
    progress: { status: "complete" }, browserEvidence: null, recommendations: [],
    comparisonBaseline: createComparisonBaseline(prior),
  }, prior);
  await writeReport(report, directory);
  const identity = { runId: "critic-regression", schemaVersion: EVAL_SCHEMA_VERSION,
    sourceSha: "abc1234", deploymentId: "deploy-b", capturedAt: "2026-08-13T10:01:00.000Z" };
  const browserPath = path.join(directory, "browser.json");
  const criticPath = path.join(directory, "critic.json");
  await writeFile(browserPath, JSON.stringify(completeBrowserEvidence(identity)));
  await writeFile(criticPath, JSON.stringify({ ...identity, materialIssue: true,
    overallVerdict: "ISSUES FOUND", recommendations: [], scenarioVerdicts: [{
      scenarioId: "answer-scenario", verdict: "ISSUES FOUND", correctness: 1, reason: "Factually wrong.",
    }] }));
  const result = await runNode(["scripts/finalize-chat-report.mjs", "--output-dir", directory,
    "--browser-json", browserPath, "--critic-json", criticPath]);
  assert.equal(result.code, 0, result.stderr);
  const finalized = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
  assert.equal(
    finalized.scenarios.find(({ id }) => id === "answer-scenario").classification,
    "REGRESSION"
  );
  assert.equal(finalized.comparison.previousRunId, "prior");
});

test("scenario failure records the active request and marks later work inconclusive", () => {
  const scenarios = [
    { id: "completed", category: "fixed" },
    { id: "fixed-timeout", category: "fixed" },
    { id: "not-run", category: "follow-ups" },
  ];
  const report = {
    completedAt: null,
    scenarios: [{
      id: "completed",
      passed: true,
      outcome: "PASS",
      classification: null,
    }],
    progress: {
      status: "running",
      activeScenario: { id: "fixed-timeout" },
      activeRequest: {
        scenarioId: "fixed-timeout",
        turn: 2,
        startedAt: "2026-07-27T00:01:00.000Z",
      },
      completedScenarioIds: ["completed"],
      failure: null,
    },
  };
  const failedResult = {
    id: "fixed-timeout",
    category: "fixed",
    passed: false,
    outcome: "FAIL",
    classification: null,
    failure: {
      kind: "timeout",
      message: "request timed out after 240000ms",
    },
  };
  recordScenarioFailure(
    report,
    scenarios,
    1,
    failedResult,
    "2026-07-27T00:05:00.000Z"
  );
  assert.equal(report.progress.status, "failed");
  assert.deepEqual(report.progress.failure, {
    scenarioId: "fixed-timeout",
    request: report.progress.activeRequest,
    kind: "timeout",
    message: "request timed out after 240000ms",
    failedAt: "2026-07-27T00:05:00.000Z",
  });
  assert.equal(report.scenarios[1], failedResult);
  assert.match(report.scenarios[2].evidence, /fixed-timeout/);
  assert.equal(report.scenarios[2].outcome, "INCONCLUSIVE");
});

test("observational request failure is preserved as inconclusive and does not stop certification", () => {
  const reproduction = { method: "POST", path: "/api/ask", body: { question: "A vs B" } };
  const report = {
    completedAt: null,
    scenarios: [],
    progress: {
      status: "running",
      activeScenario: { id: "observational-live-replacement" },
      activeRequest: { scenarioId: "observational-live-replacement", reproduction },
      completedScenarioIds: [],
    },
  };
  const recorded = recordOptionalScenarioFailure(report, {
    id: "observational-live-replacement",
    passed: false,
    outcome: "FAIL",
    requiredForCertification: false,
    reproduction: { requests: [] },
    evidence: "Evaluator request failed: fetch failed",
    failure: { kind: "request_error", message: "fetch failed" },
  });
  assert.equal(recorded.outcome, "INCONCLUSIVE");
  assert.deepEqual(recorded.reproduction.requests, [reproduction]);
  assert.match(recorded.evidence, /continued without retry/);
  assert.deepEqual(report.progress.completedScenarioIds, ["observational-live-replacement"]);
  assert.equal(report.progress.status, "running");
  assert.equal(report.progress.activeScenario, null);
});

test("answer copy guard rejects internal methodology jargon", () => {
  assert.equal(validateAnswerCopy("I favour the home side.").passed, true);
  assert.equal(validateAnswerCopy("Pundit's model favours the home side.").passed, false);
  assert.equal(validateAnswerCopy("The payload says the draw is live.").passed, false);
  assert.equal(validateAnswerCopy("Using Dixon-Coles probabilities here.").passed, false);
  assert.equal(validateAnswerCopy("ClubElo ratings drive the edge.").passed, false);
  assert.equal(validateAnswerCopy("This is model-grounded analysis.").passed, false);
});

test("analyst expression guard enforces direct, scoped and honest follow-ups", () => {
  const good = validateAnalystExpression(
    "I can't price that scorer from this match forecast alone.",
    { expectAnalystVoice: true, expectDirectAnswer: true, expectNarrowFollowup: true, expectCannotReprice: true }
  );
  assert.equal(good.passed, true);
  assert.equal(validateAnalystExpression(
    "The market is lower because it knows the striker is injured, so back the draw for value.",
    { expectNoUnsupportedMarketCausality: true }
  ).passed, false);
  assert.equal(validateAnalystExpression(
    "The markets agree, which proves my view is right.",
    { expectNoUnsupportedMarketCausality: true }
  ).passed, false);
  assert.equal(validateAnalystExpression(
    "The prices are close, but I wouldn't call that a value bet.",
    { expectNoUnsupportedMarketCausality: true }
  ).passed, true);
  assert.equal(validateAnswerStructure("I make it close [[S?]].").assertions.noUnresolvedMarker, false);
});

test("golden conversation guards trace exact-score prices and table-wide counts", () => {
  const match = {
    kind: "match",
    home: "Alpha",
    away: "Beta",
    pHome: 0.5,
    pDraw: 0.3,
    pAway: 0.2,
    scorelines: [{ score: "2-1", probability: 0.125 }],
  };
  assert.equal(validateResponseCorrectness(
    "I make Alpha 2-1 Beta a 12.5% chance, so my fair decimal price is 8.00.",
    [],
    match,
    { expectExactScoreFairPrice: "2-1" }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "I make Alpha 2-1 Beta a 12.5% chance, so my fair decimal price is 6.00.",
    [],
    match,
    { expectExactScoreFairPrice: "2-1" }
  ).passed, false);

  const competition = {
    kind: "competition",
    standings: [
      { team: "Alpha", playedGames: 2 },
      { team: "Beta", playedGames: 1 },
    ],
  };
  assert.equal(validateResponseCorrectness(
    "Alpha lead. Every club has played two matches.",
    [],
    competition,
    { expectTableMatchCountsGrounded: true }
  ).passed, false);
});

test("answer structure guard catches an emptied section and a missing headline 1X2", () => {
  // The shape production actually served: a bold label over nothing.
  assert.equal(validateAnswerStructure("**Verdict**").passed, false);
  assert.equal(validateAnswerStructure("**Verdict**\n\n**Likely scorelines**\n**2-1 (11.4%)** leads.")
    .assertions.noOrphanedSectionLabel, false);
  const intact = "**Verdict**\nMan United win **77.6%**, draw **14.2%**, Hull **8.2%**.";
  assert.equal(validateAnswerStructure(intact, { expectHeadlineOneXTwo: true }).passed, true);
  // A label whose body legitimately follows a blank line is not orphaned.
  assert.equal(validateAnswerStructure("**Verdict**\n\nArsenal win **61.0%**.").passed, true);
  assert.equal(
    validateAnswerStructure(
      "**Verdict**\nI could not establish a complete same-source, same-time bookmaker 1X2 market.",
      { expectHeadlineOneXTwo: true }
    ).assertions.headlineOneXTwoPresent,
    false
  );
  // The provider can label this normally completed (`end_turn`) even though
  // the final probability and its bold marker were cut mid-token.
  for (const truncated of [
    "**Verdict**\nArsenal are at 92.7%, the draw at 2.3%, and City at 5.",
    "**Verdict**\nArsenal are at 92.7%, the draw at 2.3%, and City at **5.",
  ]) {
    const validation = validateAnswerStructure(truncated, { expectHeadlineOneXTwo: true });
    assert.equal(validation.assertions.structurallyCompleteEnding, false, truncated);
    assert.equal(validation.passed, false, truncated);
  }
  assert.equal(
    validateAnswerStructure("Arsenal are at 92.7%, the draw at 2.3%, and City at 5.").passed,
    false,
    "ending integrity must not depend on a headline-1X2 scenario flag"
  );
  for (const truncated of [
    "Arsenal 92.7%, draw 2.3%, City is 5.",
    "Home is 61.0%, away 5.",
  ]) {
    assert.equal(validateAnswerStructure(truncated).passed, false, truncated);
  }
  for (const complete of [
    "Arsenal are at 92.7%. The score is 5.",
    "Arsenal had 60% possession. They faced Schalke 04.",
    "Arsenal are 92.7%; Bet365 has City at 5.",
  ]) {
    assert.equal(validateAnswerStructure(complete).passed, true, complete);
  }
  for (const complete of [
    "**Verdict**\nArsenal are at **92.7%**, the draw at **2.3%**, and City at **5.0%**.",
    "**Verdict**\nArsenal 92.7%, draw 2.3%, City 5.0%. The main caveat is rotation.",
    "**Verdict**\nArsenal 92.7%, draw 2.3%, City 5.0%\n\n- Rotation",
  ]) {
    assert.equal(
      validateAnswerStructure(complete, { expectHeadlineOneXTwo: true }).passed,
      true,
      complete
    );
  }
});

test("the built match guard chain keeps model numbers and still drops external prices", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const config = JSON.parse(await readFile(path.join(repoRoot, "evals/chat/scenarios.json"), "utf8"));
  const byId = new Map(config.fixed.map((scenario) => [scenario.id, scenario]));
  for (const id of [
    "model-probabilities-survive-market-guard",
    "external-market-price-still-fails-closed",
  ]) {
    const scenario = byId.get(id);
    assert.equal(scenario?.helper, "sanitizeFinalMatchAnswer", `missing built guard scenario ${id}`);
    const actual = executeRuntimeHelperScenario(scenario, repoRoot);
    for (const text of scenario.expectText ?? []) {
      assert.equal(actual.includes(text), true, `${id} lost required text: ${text}`);
    }
    for (const text of scenario.forbidText ?? []) {
      assert.equal(actual.includes(text), false, `${id} retained forbidden text: ${text}`);
    }
    assert.equal(validateAnswerStructure(actual).passed, true, `${id} left an empty section label`);
  }
  assert.equal(
    validateAnswerStructure(
      executeRuntimeHelperScenario(byId.get("model-probabilities-survive-market-guard"), repoRoot),
      { expectHeadlineOneXTwo: true }
    ).passed,
    true
  );
});

// `chat-eval:dry-run` only lints the manifest -- it never executes a scenario --
// so an answer-survival scenario that is not pinned here is dead weight that CI
// never runs. These four are the guardrail: each is a shape production actually
// served, and each must be checked by the real delivery chain on every push.
test("a correct match answer survives the whole delivery chain", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const config = JSON.parse(await readFile(path.join(repoRoot, "evals/chat/scenarios.json"), "utf8"));
  const byId = new Map(config.fixed.map((scenario) => [scenario.id, scenario]));
  for (const id of [
    "full-match-answer-survives-intact",
    "uncited-injury-claim-is-still-removed",
    "bare-numeric-marker-never-reaches-user",
    "team-news-abstains-without-wiping-verdict",
  ]) {
    const scenario = byId.get(id);
    assert.equal(scenario?.kind, "runtime-helper", `missing answer-survival scenario ${id}`);
    const actual = executeRuntimeHelperScenario(scenario, repoRoot);
    for (const text of scenario.expectText ?? []) {
      assert.equal(actual.includes(text), true, `${id} lost required text: ${text}`);
    }
    for (const text of scenario.forbidText ?? []) {
      assert.equal(actual.includes(text), false, `${id} retained forbidden text: ${text}`);
    }
    // Every one of these is a match answer that still has something to say, so
    // the structural contract applies to all of them and not only to the
    // untouched one.
    assert.equal(
      validateAnswerStructure(actual, { expectHeadlineOneXTwo: true }).passed,
      true,
      `${id} lost its structure or headline 1X2`
    );
    assert.equal(validateAnswerCopy(actual).passed, true, `${id} leaked internal jargon`);
    assert.equal(validateNoDraftLeak(actual).passed, true, `${id} leaked a draft or tool call`);
    assert.equal(validateTeamNewsDiscipline(actual).passed, true, `${id} left team news unsourced`);
  }
});

test("team-news guard accepts a sourced claim or an explicit abstention", () => {
  assert.equal(validateTeamNewsDiscipline(
    "Villa are without their first-choice keeper, who is suspended (BBC Sport, 12 Apr)."
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "Reported on 3 May 2026: their centre-back is doubtful."
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "No verified team-news update was established for this fixture."
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "No additional verified, dated injury update was established by the available evidence."
  ).passed, true);
  // Nothing to source: an answer that never asserts availability is unaffected.
  assert.equal(validateTeamNewsDiscipline(
    "The model gives the home side a clear edge on the totals market."
  ).passed, true);
});

test("team-news guard accepts the relative dates search results actually carry", () => {
  // Verbatim shape of a live production answer that this guard wrongly failed:
  // every claim was attributed, but to "1 day ago" rather than a calendar date.
  assert.equal(validateTeamNewsDiscipline(
    "Aarhus have injury concerns: Tobias Molgaard and Nicolai Poulsen are out"
    + " injured, per Sports Mole (1 day ago). Freetips.com (2 days ago) adds that"
    + " Frederik Tingager is doubtful. Dailysports.net (12 hours ago) reports the"
    + " visitors have no injury concerns."
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "He is suspended for this one (The Athletic, 3 hours ago)."
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "Their captain returned to training yesterday, per the club."
  ).passed, true);
});

test("team-news guard rejects an unsourced availability claim", () => {
  assert.equal(validateTeamNewsDiscipline(
    "Their striker is injured and will be ruled out for this one."
  ).passed, false);
  assert.equal(validateTeamNewsDiscipline(
    "Expect a much-changed starting XI after midweek."
  ).passed, false);
  assert.equal(validateTeamNewsDiscipline(
    "No verified, dated team-news update was established. If Saliba and Timber are missed and Saka joins them, the clean-sheet chance falls."
  ).passed, false);
  assert.equal(validateTeamNewsDiscipline("").passed, false);
});

test("match grounding reports market-source coverage and can assert it", () => {
  const thin = {
    kind: "match",
    competitionId: "eng.1",
    home: "Arsenal",
    away: "Villa",
    pHome: 0.5,
    pDraw: 0.25,
    pAway: 0.25,
    pOver2_5: 0.54,
    pUnder2_5: 0.46,
    pBttsYes: 0.56,
    pBttsNo: 0.44,
    topScores: [{ score: "1-0", probability: 0.1 }],
    scorelines: [{ score: "1-0", probability: 0.1 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: []
  };
  // Empty market coverage is reported but does not fail by default.
  const lenient = validateGrounding(thin, { expectGrounding: "match" });
  assert.equal(lenient.passed, true);
  assert.equal(lenient.observations.oddsSourceCount, 0);
  assert.equal(lenient.observations.stakePricesPresent, false);

  // A strict run can require at least one market line.
  const strict = validateGrounding(thin, { expectGrounding: "match", expectOddsSources: true });
  assert.equal(strict.passed, false);
  assert.ok(strict.failures.some((failure) => failure.includes("oddsSourcesPopulated")));

  const covered = validateGrounding(
    { ...thin, oddsSources: [{ source: "kalshi", pHome: 0.5, pDraw: 0.25, pAway: 0.25 }] },
    { expectGrounding: "match", expectOddsSources: true }
  );
  assert.equal(covered.passed, true);
  assert.deepEqual(covered.observations.oddsSourceNames, ["kalshi"]);
});

test("400 error copy guard rejects schema field leaks", () => {
  assert.equal(validateErrorCopy({ error: "Couldn't understand that request." }).passed, true);
  assert.equal(validateErrorCopy({ error: "'history' must be an array." }).passed, false);
  assert.equal(validateErrorCopy({ error: "history must be an array" }).passed, false);
});

test("citation provenance gates exact clickable citations and rejects draft narration", () => {
  const citation = { id: "S1", title: "Club update", url: "https://example.com/news", date: "2026-08-12" };
  assert.equal(validateCitationContract(
    "Player is available ([Club update](https://example.com/news), 2026-08-12).",
    [citation],
    true
  ).passed, true);
  assert.equal(validateCitationContract("Player is available. [[S99]]", [], true).passed, false);
  assert.equal(validateNoDraftLeak("Let me search for the latest injuries.").passed, false);
  assert.equal(validateNoDraftLeak("No verified injury update was established.").passed, true);
});

test("draft-leak gate catches structural tool-call markup, not just narration", () => {
  // The exact answer a user was shown in production.
  const screenshot = ']<]minimax[>[<tool_call> ]<]minimax[>[<tool_call> <invoke name="web_search">'
    + " <query>Dinamo Zagreb vs Viking FK Champions League qualifier 2026 team news injuries"
    + " lineup</query> </invoke> </tool_call>";
  const leaks = [
    screenshot,
    // Truncated / unclosed variants: the live leaks were malformed.
    '<tool_call> <invoke name="web_search',
    "<invoke name=\"web_search\"> <query>arsenal injuries</query>",
    "]<]minimax[>[",
    "<|tool_calls_begin|>",
    '<parameter name="query">arsenal injuries</parameter>',
    // The second live shape: a bare, unclosed JSON tool payload.
    '{  "search_queries": ["Arsenal team news injuries Premier League August 2026"]',
    '{"name": "web_search", "arguments": {"query": "arsenal injuries"}}',
    '[[search_query:Premier League title race August 2026 Arsenal favourites]]',
    '[web_search:Celtic LASK Champions League playoff team news]',
  ];
  for (const leak of leaks) {
    const result = validateNoDraftLeak(leak);
    assert.equal(result.passed, false, `expected a leak failure for: ${leak}`);
    assert.ok(result.failures.length > 0);
  }

  // Legitimate answers must not be failed by the widened gate.
  for (const clean of [
    "Arsenal are favoured at 61.2%, with expected goals <1.5 for Coventry.",
    "Your query about away form: Arsenal win 54% of away fixtures this season.",
    "In SQL a <query> is a statement sent to the database, not a football term.",
    "No verified injury update was established by the available evidence.",
    "{Note} the model rates Arsenal the stronger side at 61%.",
  ]) {
    assert.equal(validateNoDraftLeak(clean).passed, true, `expected a pass for: ${clean}`);
  }
});

test("latency gate uses individual requests and enforces p90 after ten samples", () => {
  const report = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    scenarios: Array.from({ length: 10 }, (_, index) => ({
      id: `s${index}`,
      passed: true,
      classification: null,
      requestLatencies: [index === 9 ? 19_999 : 1_000],
    })),
  };
  finalizeClassifications(report, null);
  assert.deepEqual(report.latencyGate, {
    samples: 10,
    p90Ms: 1_000,
    everyRequestUnder90s: true,
    p90Under20s: true,
    observedSamples: 10,
    observedP90Ms: 1_000,
  });
});

test("certification gate uses required traffic and requires every release identity and evidence gate", () => {
  const required = Array.from({ length: 10 }, (_, index) => ({
    id: `required-${index}`,
    requiredForCertification: true,
    passed: true,
    outcome: "PASS",
    requestLatencies: [index === 9 ? 19_999 : 1_000],
  }));
  const base = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    pacing: {
      minimumIntervalMs: 13_000,
      requestStarts: ["2026-08-13T10:00:00.000Z", "2026-08-13T10:00:13.025Z"],
      observedStartOffsetsMs: [0, 13_025],
      observedGapsMs: [13_025],
    },
    deployment: { id: "railway-deploy-123", shaConverged: true },
    browserEvidence: {
      passed: true,
      console: { errors: [], warnings: [] },
      checks: [{ passed: true }],
    },
    criticReview: { materialIssue: false, overallVerdict: "PASS" },
    scenarios: [...required, {
      id: "optional-slow-observation",
      requiredForCertification: false,
      passed: true,
      outcome: "PASS",
      requestLatencies: [27_473],
    }],
  };
  finalizeClassifications(base, null);
  assert.equal(base.certificationGate.passed, true);
  assert.equal(base.latencyGate.samples, 10);
  assert.equal(base.latencyGate.observedSamples, 11);
  assert.equal(base.latencyGate.p90Under20s, true);
  assert.equal(base.latencyGate.observedP90Ms, 19_999);

  const unknownDeployment = structuredClone(base);
  unknownDeployment.deployment.id = "unknown";
  finalizeClassifications(unknownDeployment, null);
  assert.equal(unknownDeployment.certificationGate.deploymentIdValid, false);
  assert.equal(unknownDeployment.certificationGate.passed, false);

  const requiredFailure = structuredClone(base);
  requiredFailure.scenarios[0].passed = false;
  requiredFailure.scenarios[0].outcome = "FAIL";
  finalizeClassifications(requiredFailure, null);
  assert.deepEqual(requiredFailure.certificationGate.requiredFailures, ["required-0"]);
  assert.equal(requiredFailure.certificationGate.passed, false);

  const slowRequired = structuredClone(base);
  slowRequired.scenarios[8].requestLatencies = [20_001];
  slowRequired.scenarios[9].requestLatencies = [20_001];
  finalizeClassifications(slowRequired, null);
  assert.equal(slowRequired.certificationGate.latencyPassed, false);
  assert.equal(slowRequired.certificationGate.passed, false);

  const underpaced = structuredClone(base);
  underpaced.pacing.observedStartOffsetsMs = [0, 12_999];
  underpaced.pacing.observedGapsMs = [12_999];
  finalizeClassifications(underpaced, null);
  assert.equal(underpaced.pacingGate.passed, false);
  assert.equal(underpaced.certificationGate.passed, false);

  const optionalMaterialFailure = structuredClone(base);
  optionalMaterialFailure.scenarios.at(-1).passed = false;
  optionalMaterialFailure.scenarios.at(-1).outcome = "FAIL";
  finalizeClassifications(optionalMaterialFailure, null);
  assert.deepEqual(optionalMaterialFailure.certificationGate.optionalMaterialFailures,
    ["optional-slow-observation"]);
  assert.equal(optionalMaterialFailure.certificationGate.passed, false);

  const safeObservation = structuredClone(base);
  safeObservation.scenarios.at(-1).passed = false;
  safeObservation.scenarios.at(-1).outcome = "INCONCLUSIVE";
  safeObservation.scenarios.at(-1).answer = null;
  safeObservation.scenarios.at(-1).turnResults = [];
  finalizeClassifications(safeObservation, null);
  assert.equal(safeObservation.scenarios.at(-1).observationalInconclusiveSafe, true);
  assert.equal(safeObservation.certificationGate.passed, true);

  const unsafeObservation = structuredClone(base);
  unsafeObservation.scenarios.at(-1).passed = false;
  unsafeObservation.scenarios.at(-1).outcome = "INCONCLUSIVE";
  unsafeObservation.scenarios.at(-1).answer = "A materially defective answer.";
  unsafeObservation.scenarios.at(-1).turnResults = [
    { turn: 1, status: 200, answer: "A materially defective answer." },
  ];
  finalizeClassifications(unsafeObservation, null);
  assert.deepEqual(unsafeObservation.certificationGate.unsafeObservationalInconclusive,
    ["optional-slow-observation"]);
  assert.equal(unsafeObservation.certificationGate.passed, false);
});

test("schema-17 fixture grounding distinguishes capability without leaking model probabilities", () => {
  const fixture = {
    fixtureId: "espn:club.friendly:800",
    primarySource: "espn",
    primarySourceFixtureId: "800",
    homeTeam: { id: "ars", name: "Arsenal" },
    awayTeam: { id: "liv", name: "Liverpool" },
    kickoff: "2026-08-18T19:00:00.000Z",
    venue: "National Stadium",
    neutralVenue: true,
    competition: { id: "club.friendly", name: "Club Friendly", category: "club-friendly" },
    status: "scheduled",
    recognition: "authoritative",
    observedSources: [{ source: "espn", sourceFixtureId: "800", authority: "authoritative", observedAt: "2026-08-13T10:00:00Z" }],
    observationHistory: [],
  };
  const valid = validateFixtureGrounding({
    kind: "fixture",
    fixture,
    capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
  }, {
    expectFixtureId: fixture.fixtureId,
    expectTeams: ["Liverpool", "Arsenal"],
    expectCapability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    expectCompetitionCategory: "club-friendly",
    expectNeutralVenue: true,
  });
  assert.equal(valid.passed, true);
  assert.equal(validateFixtureGrounding({
    kind: "fixture",
    fixture,
    capability: { status: "outside-coverage", reason: "friendly-policy-disabled" },
    pHome: 0.5,
  }).passed, false);
  assert.equal(validateFixtureGrounding({
    kind: "fixture",
    fixture,
    capability: { status: "outside-coverage", reason: "ratings-unavailable" },
  }).passed, false);
});

test("schema-17 verification contract enforces shape, counts, and abstention semantics", () => {
  assert.equal(validateVerification({
    status: "verified", supportedClaimCount: 1, removedClaimCount: 0,
  }, { expectVerification: ["verified"] }).passed, true);
  assert.equal(validateVerification({
    status: "verified", supportedClaimCount: 0, removedClaimCount: 0,
  }).passed, false);
  assert.equal(validateVerification({
    status: "abstain", supportedClaimCount: 0, removedClaimCount: 1,
  }, { requireCitation: true, allowAbstention: true }).passed, true);
  assert.equal(validateVerification(null).passed, false);
});

test("schema-17 complete market validator enforces source, time, legs and arithmetic", () => {
  const legs = [
    { outcome: "home", decimalOdds: 2, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
    { outcome: "draw", decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
    { outcome: "away", decimalOdds: 4, source: "Book", observedAt: "2026-08-13T10:00:00Z" },
  ];
  const valid = validateOneXTwoMarket(legs);
  assert.equal(valid.passed, true);
  assert.deepEqual(valid.market.impliedProbabilities, { home: 0.5, draw: 0.25, away: 0.25 });
  assert.deepEqual(valid.market.noVigProbabilities, { home: 0.5, draw: 0.25, away: 0.25 });
  assert.equal(validateOneXTwoMarket(legs.slice(0, 2)).reason, "missing-or-duplicate-leg");
  assert.equal(validateOneXTwoMarket([{ ...legs[0], source: "Other" }, legs[1], legs[2]]).reason, "mixed-source");
  assert.equal(validateOneXTwoMarket([{ ...legs[0], observedAt: "2026-08-13T10:01:00Z" }, legs[1], legs[2]]).reason, "mixed-observation-time");
});

test("runtime-helper scenarios execute the current API correctness module, not canned prose", async () => {
  const helpers = loadApiRuntimeCorrectnessHelpers(path.resolve(import.meta.dirname, ".."));
  const config = JSON.parse(await readFile(
    path.resolve(import.meta.dirname, "../evals/chat/scenarios.json"),
    "utf8"
  ));
  const runtime = new Map(config.fixed.filter(({ kind }) => kind === "runtime-helper")
    .map((scenario) => [scenario.id, scenario]));
  for (const id of [
    "complete-market-arithmetic",
    "combined-scoreline-arithmetic",
    "incomplete-market-fails-closed",
    "third-party-probability-labelling",
    "recognized-friendly-outside-coverage",
    "temporary-fixture-unavailability",
    "unsupported-followup-and-matchup-replacement",
    "neutral-venue-missing-input",
    "friendly-capability-runtime-contract",
    "temporary-capability-runtime-contract",
    "stale-manager-official-conflict",
    "correction-after-wrong-history",
    "one-one-is-not-over-two-five",
    "unrelated-citation-rejected",
    "degraded-search-retrieval-verifier",
    "two-legged-tie-resolves-to-a-real-leg",
    "suggestion-chip-identity-selects-its-leg",
  ]) {
    assert.equal(runtime.has(id), true, `missing built runtime helper scenario ${id}`);
  }
  assert.equal(helpers.validateCompleteOneXTwoMarket(runtime.get("complete-market-arithmetic").args[0]).valid, true);
  assert.deepEqual(
    helpers.validateCompleteOneXTwoMarket(runtime.get("incomplete-market-fails-closed").args[0]),
    { valid: false, reason: "missing-leg" }
  );
  const combined = runtime.get("combined-scoreline-arithmetic");
  const combinedActual = executeRuntimeHelperScenario(combined, path.resolve(import.meta.dirname, ".."));
  assert.equal(combinedActual.includes("13.6%"), true);
  assert.equal(combinedActual.includes("21%"), false);
  const attribution = runtime.get("third-party-probability-labelling").args[0];
  const label = helpers.probabilityAttributionLabel(attribution);
  assert.equal(helpers.hasValidProbabilityAttribution(label, attribution), true);
  assert.deepEqual(
    helpers.attributeManagerEra(...runtime.get("stale-manager-official-conflict").args),
    runtime.get("stale-manager-official-conflict").expect
  );
  assert.equal(helpers.containsCorrectionCue(runtime.get("correction-after-wrong-history").args[0]), true);
  assert.equal(helpers.settleScorelineTotal(...runtime.get("one-one-is-not-over-two-five").args), "lose");
  assert.match(
    helpers.applyClaimDecisions(...runtime.get("unrelated-citation-rejected").args).answer,
    /could not establish/i
  );
  assert.match(
    helpers.applyClaimDecisions(...runtime.get("degraded-search-retrieval-verifier").args).answer,
    /sources conflict/i
  );
  const fixtureHelpers = loadApiRuntimeFixtureHelpers(path.resolve(import.meta.dirname, ".."));
  assert.deepEqual(
    fixtureHelpers.evaluateFixtureCapability(...runtime.get("friendly-capability-runtime-contract").args),
    runtime.get("friendly-capability-runtime-contract").expect
  );
  assert.deepEqual(
    fixtureHelpers.evaluateFixtureCapability(...runtime.get("temporary-capability-runtime-contract").args),
    runtime.get("temporary-capability-runtime-contract").expect
  );
  const routingHelpers = loadApiRuntimeRoutingHelpers(path.resolve(import.meta.dirname, ".."));
  assert.equal(typeof routingHelpers.resolveAskContext, "function");
  for (const id of [
    "recognized-friendly-outside-coverage",
    "temporary-fixture-unavailability",
    "unsupported-followup-and-matchup-replacement",
    "neutral-venue-missing-input",
    // Both legs of a tie carry the same two clubs. Asking for one used to
    // resolve to nothing at all, and no scenario here could see it because
    // every other fixture scenario supplies a fixtureContext.
    "two-legged-tie-resolves-to-a-real-leg",
    "suggestion-chip-identity-selects-its-leg",
  ]) {
    assert.equal(runtime.get(id).helper, "resolveFixtureRoutingSequence");
    assert.deepEqual(
      executeRuntimeHelperScenario(runtime.get(id), path.resolve(import.meta.dirname, "..")),
      runtime.get(id).expect,
      `built routing result mismatch for ${id}`
    );
  }
});

test("schema-17 correctness guard catches the four screenshot-class failures", () => {
  assert.equal(validateResponseCorrectness(
    "Pundit's forecast is 52% home, 25% draw and 23% away.",
    [],
    { kind: "fixture" },
    { expectNoPunditProbabilities: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "These are bookmaker probabilities from third-party data, not a Pundit forecast.",
    [],
    null,
    { expectThirdPartyLabel: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "A 1-1 result lands over 2.5 goals.",
    [],
    null,
    { expectOneOneNotOver25: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "The old manager remains in charge.",
    [],
    null,
    { expectCorrectionAcknowledgement: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "You're right; correction: the official club update confirms the new manager ([Club update](https://club.example/update)).",
    [{ id: "S1", title: "Club update", url: "https://club.example/update", date: "2026-08-13" }],
    null,
    { expectCorrectionAcknowledgement: true }
  ).passed, true);
});

test("response correctness validates explicit combined scoreline sums at the stated precision", () => {
  const grounding = {
    kind: "match",
    home: "Dinamo Zagreb",
    away: "Viking",
    scorelines: [
      { score: "2-1", probability: 0.0795 },
      { score: "2-0", probability: 0.0568 },
      { score: "1-1", probability: 0.102 },
    ],
  };
  for (const answer of [
    "The 2-1 and 2-0 outcomes combine to 13.6%.",
    "The 2-1 (7.95%) and 2-0 (5.68%) scorelines are 13.63% together.",
    "The 2-1 and 2-0 scorelines collectively account for 13.6%.",
    "The 2-1 and 2-0 cases combine to about 14%.",
    "The leading scorelines are 2-1 (7.95%) and 2-0 (5.68%).",
    "The 2-1 and 2-0 outcomes combine to 13.6%, while 1-1 is 10.2%.",
    "The 1-1 outcome is 10.2%, while 2-1 and 2-0 combine to 13.6%.",
    "Dinamo Zagreb's 2-1 and 2-0 wins combine to 13.6%.",
  ]) {
    assert.equal(validateResponseCorrectness(answer, [], grounding).passed, true, answer);
  }
  for (const answer of [
    "The 2-1 and 2-0 cases combine to about 21%.",
    "The 2-1 and 2-0 outcomes are 13.4% together.",
    "The 2-1 and 4-0 outcomes combine to 13.6%.",
  ]) {
    const validation = validateResponseCorrectness(answer, [], grounding);
    assert.equal(validation.assertions.combinedScorelineArithmetic, false, answer);
    assert.equal(validation.passed, false, answer);
  }
  const missingRequiredAggregate = validateResponseCorrectness(
    "The leading scorelines are 2-1 (7.95%) and 2-0 (5.68%).",
    [],
    grounding,
    { expectCombinedScorelineArithmetic: true }
  );
  assert.equal(missingRequiredAggregate.assertions.combinedScorelineArithmetic, false);
  assert.equal(missingRequiredAggregate.passed, false);
  const wrongOrientation = validateResponseCorrectness(
    "Viking's 2-1 and 2-0 wins combine to 13.6%.",
    [],
    grounding
  );
  assert.equal(wrongOrientation.assertions.combinedScorelineArithmetic, true);
  assert.equal(wrongOrientation.assertions.combinedScorelineOrientation, false);
  assert.equal(wrongOrientation.passed, false);
});

test("response correctness rejects grounded rank, mass and request-fidelity defects", () => {
  const grounding = {
    kind: "match",
    home: "Arsenal",
    away: "Coventry",
    scorelines: [
      { score: "4-0", probability: 0.1254 },
      { score: "5-0", probability: 0.1216 },
      { score: "3-0", probability: 0.1034 },
      { score: "6-0", probability: 0.0983 },
      { score: "7-0", probability: 0.0681 },
      { score: "2-0", probability: 0.064 },
      { score: "4-1", probability: 0.0471 },
    ],
  };
  assert.equal(validateResponseCorrectness(
    "The top five scorelines are all Arsenal clean sheets.", [], grounding
  ).passed, true);
  const falseRank = validateResponseCorrectness(
    "The seven most likely scorelines are all Arsenal wins without conceding, totalling roughly 67%.",
    [], grounding
  );
  assert.equal(falseRank.assertions.scorelineRankClaimsGrounded, false);
  assert.equal(falseRank.assertions.scorelineMassClaimsGrounded, false);
  assert.equal(falseRank.passed, false);

  assert.equal(validateResponseCorrectness(
    "Pundit's team-strength rating gap is the main input behind the edge.",
    [], grounding, { expectModelEvidenceOnly: true, expectNamedModelInput: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "Kalshi and Polymarket are 14 points below Pundit's model.",
    [], grounding, { expectModelEvidenceOnly: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "The outputs all point the same way, so the edge is large.",
    [], grounding, { expectNamedModelInput: true }
  ).passed, false);
});

test("schema-17 rejects certainty, scoreline universals, counts and draw-mass contradictions", () => {
  const grounding = {
    kind: "match",
    home: "Arsenal",
    away: "Coventry",
    pHome: 0.9728,
    pDraw: 0.0229,
    pAway: 0.0043,
    scorelines: [
      { score: "4-0", probability: 0.1254 },
      { score: "5-0", probability: 0.1216 },
      { score: "3-0", probability: 0.1034 },
      { score: "6-0", probability: 0.0983 },
      { score: "7-0", probability: 0.0681 },
      { score: "2-0", probability: 0.064 },
      { score: "4-1", probability: 0.0471 },
      { score: "1-1", probability: 0.0109 },
      { score: "1-2", probability: 0.0019 },
    ],
  };
  assert.equal(validateResponseCorrectness(
    "Six of the top seven are Arsenal clean-sheet wins. Draw scoreline probability is 2.3%.",
    [], grounding
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "Seven of the top eight are Arsenal-to-nil scorelines.", [], grounding
  ).assertions.scorelineCleanSheetCountsGrounded, false);
  assert.equal(validateResponseCorrectness(
    "Every scoreline at or above 0.1% is an Arsenal win.", [], grounding
  ).assertions.scorelineUniversalClaimsGrounded, false);
  assert.equal(validateResponseCorrectness(
    "Coventry does not register above the 0.1% threshold on any winning scoreline.", [], grounding
  ).assertions.scorelineUniversalClaimsGrounded, false);
  assert.equal(validateResponseCorrectness(
    "The mark 1.3% of scorelines are tied.", [], grounding
  ).assertions.drawMassGrounded, false);

  const season = {
    kind: "season",
    seasonOutlook: { titleProbabilities: [{ team: "Arsenal", probability: 0.9347 }] },
  };
  assert.equal(validateResponseCorrectness(
    "Arsenal are favourites at 93.47%; this is not a guarantee.", [], season,
    { expectNoCertaintyContradiction: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner. Arsenal is most likely at 93.47%, not a certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner. Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner. Arsenal will win.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner, but Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner but Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner however Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner yet Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner and Arsenal will win with 100% certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Arsenal are favourites, but not a certainty.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner but can identify Arsenal as most likely at 93.47%.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner and can identify Arsenal as most likely at 93.47%.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true);
  assert.equal(validateResponseCorrectness(
    "No guarantee: Arsenal will win.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  assert.equal(validateResponseCorrectness(
    "Pundit cannot guarantee a winner, Arsenal will win.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  for (const certainty of [
    "Arsenal are certain champions.",
    "Arsenal are definitely the champions.",
    "Arsenal win the league, guaranteed.",
    "There is no doubt Arsenal are champions.",
  ]) assert.equal(validateResponseCorrectness(
    certainty, [], season, { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false, certainty);
  assert.equal(validateResponseCorrectness(
    "Arsenal are not definitely the champions; they are merely favourites.", [], season,
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true);
  assert.equal(validateResponseCorrectness(
    "Arsenal will win with 100% certainty.", [],
    { kind: "season", seasonOutlook: { titleProbabilities: [{ team: "Arsenal", probability: 1 }] } },
    { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false);
  for (const refusal of [
    "It is not 100% certain Arsenal will win.",
    "There is no certainty Arsenal will win.",
    "It is not guaranteed Arsenal will win.",
    "I cannot say Arsenal will win.",
    "It is impossible to guarantee Arsenal will win.",
    "It would be wrong to guarantee Arsenal will win.",
    "Nobody can guarantee Arsenal will win.",
  ]) assert.equal(validateResponseCorrectness(
    refusal, [], season, { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, true, refusal);
  for (const contradiction of [
    "It is impossible to guarantee Arsenal will win, but Arsenal will win with 100% certainty.",
    "Nobody can guarantee Arsenal will win yet Arsenal will definitely be champion.",
    "Pundit cannot guarantee a winner although Arsenal will win.",
    "Pundit cannot guarantee a winner nevertheless Arsenal will win.",
    "Pundit cannot guarantee a winner even so Arsenal will win.",
    "Arsenal will certainly win the league.",
    "Arsenal are certain to win the league.",
    "Arsenal are sure to win the league.",
    "Arsenal will undoubtedly win the league.",
  ]) assert.equal(validateResponseCorrectness(
    contradiction, [], season, { expectNoCertaintyContradiction: true }
  ).assertions.noCertaintyContradiction, false, contradiction);
});

test("schema-17 rejects unsupported competition, fixture-status and capability-reason claims", () => {
  assert.equal(validateResponseCorrectness(
    "All teams have zero games, so the supplied ordering is not an on-field ranking.", [],
    { kind: "competition", standings: [] }
  ).passed, true);
  for (const unsafe of [
    "Coventry play in the Championship.",
    "Bournemouth lead by seeding.",
    "The positions reflect squad rankings used by the model.",
    "Coventry, Hull, Leeds and Sunderland are the promoted clubs.",
  ]) assert.equal(validateResponseCorrectness(
    unsafe, [], { kind: "competition", standings: [] }
  ).assertions.competitionClaimsGrounded, false, unsafe);

  assert.equal(validateResponseCorrectness(
    "The result is already on the record.", [],
    { kind: "match", home: "Arsenal", away: "Coventry", scorelines: [] }
  ).assertions.fixtureStatusGrounded, false);

  const missingContext = {
    kind: "fixture",
    capability: { status: "insufficient-model-input", reason: "required-context-missing" },
  };
  assert.equal(validateResponseCorrectness(
    "A required model input is missing, so no probabilities are available.", [], missingContext
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "Confirmed squad, injury and availability data are required to unblock coverage.", [], missingContext
  ).assertions.capabilityReasonFidelity, false);
  assert.equal(validateResponseCorrectness(
    "The most important input is market staleness; team-strength ratings also exist.", [], null,
    { expectNamedModelInput: true }
  ).assertions.namedModelInput, false);
});

test("schema-17 catches leading malformed fragments and named-player claims after abstention", () => {
  assert.equal(validateAnswerStructure(
    "). Could you share the specific match?"
  ).assertions.noMalformedLeadingFragment, false);
  assert.equal(validateAnswerStructure(
    "Could you share the specific match?"
  ).passed, true);
  assert.equal(validateTeamNewsDiscipline(
    "No verified, dated team-news update was established. Confirmed absence of Saliba and Timber would matter."
  ).passed, false);
  assert.equal(validateTeamNewsDiscipline(
    "No verified, dated team-news update was established. A generic lineup change would matter."
  ).passed, false);
  assert.equal(validateTeamNewsDiscipline(
    "No verified, dated team-news update was established. The model probabilities remain available."
  ).passed, true);
});

test("season request fidelity requires the grounded leaders and forbids invented percentages", () => {
  const grounding = {
    kind: "season",
    seasonOutlook: {
      titleProbabilities: [
        { team: "Arsenal", probability: 0.9275 },
        { team: "Man City", probability: 0.0594 },
      ],
    },
  };
  assert.equal(validateResponseCorrectness(
    "Arsenal lead at 92.75%, followed by Man City at 5.94%.",
    [], grounding, { expectSeasonRanking: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "No verified, dated team-news update was established.",
    [], grounding, { expectSeasonRanking: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "One upset changes the season by 2.6%.",
    [], { kind: "competition" }, { expectNoUngroundedProbability: true }
  ).passed, false);
});

test("schema-17 table-source fidelity refuses tied-table rankings without leaking season probabilities", () => {
  const grounding = {
    kind: "season",
    standings: [
      { team: "Arsenal", playedGames: 0, points: 0, goalDifference: 0 },
      { team: "Man City", playedGames: 0, points: 0, goalDifference: 0 },
    ],
    seasonOutlook: {
      titleProbabilities: [
        { team: "Arsenal", probability: 0.9275 },
        { team: "Man City", probability: 0.0594 },
      ],
    },
  };
  assert.equal(validateResponseCorrectness(
    "The current table cannot rank the teams: every club has zero matches, points and goal difference.",
    [], grounding, { expectTableSourceFidelity: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "The table is tied, but Arsenal lead at 92.75% and Man City follow at 5.94%.",
    [], grounding, { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, false);
  assert.equal(validateResponseCorrectness(
    "Arsenal and Man City are the leading contenders.",
    [], grounding, { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, false);
  assert.equal(validateResponseCorrectness(
    "The table cannot rank them.",
    [], { ...grounding, standings: [{ team: "Arsenal", playedGames: 0, points: 0, goalDifference: 0 }] },
    { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, false);

  // A played table separates the teams, so refusing to rank is no longer the
  // right answer -- but the ranking still has to come from the table. Before
  // this, `allRowsTied` was a precondition of passing, so every run after
  // matchday one reported a product failure no answer could have avoided.
  const played = {
    kind: "season",
    standings: [
      { position: 1, team: "Brighton", playedGames: 1, points: 3, goalDifference: 4 },
      { position: 2, team: "Arsenal", playedGames: 1, points: 3, goalDifference: 3 },
      { position: 3, team: "Everton", playedGames: 1, points: 3, goalDifference: 2 },
    ],
    seasonOutlook: {
      titleProbabilities: [
        { team: "Arsenal", probability: 0.9275 },
        { team: "Man City", probability: 0.0594 },
      ],
    },
  };
  assert.equal(validateResponseCorrectness(
    "Brighton lead the supplied table on goal difference after one match; no title probability is inferred from it.",
    [], played, { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, true);
  // The substitution the assertion exists to catch: the table is set aside and
  // ratings-and-schedule season probabilities are handed back instead.
  assert.equal(validateResponseCorrectness(
    "Arsenal lead the title race at 92.75%, with Man City on 5.94%.",
    [], played, { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, false);
  // Ranking someone the table does not have at the top is not table-sourced.
  assert.equal(validateResponseCorrectness(
    "Man City are the leading contenders.",
    [], played, { expectTableSourceFidelity: true }
  ).assertions.tableSourceFidelity, false);
});

test("schema-17 rejects abstained probability counterfactuals, false product scope and history denial", () => {
  assert.equal(validateAbstainedCounterfactualDiscipline(
    "No verified team news was established. If an attacker is rotated, the model's home-win edge shrinks and the draw moves toward 12%.",
    "abstain"
  ).passed, false);
  assert.equal(validateAbstainedCounterfactualDiscipline(
    "No verified team news was established. The model probabilities remain unchanged in this answer.",
    "abstain"
  ).passed, true);
  assert.equal(validateAbstainedCounterfactualDiscipline(
    "If an attacker is rotated, the model probability falls.",
    "verified"
  ).passed, true);

  assert.equal(validateResponseCorrectness(
    "This is general reasoning, not Pundit's model output.", [], null,
    { expectAccurateProductScope: true, expectNoCategoricalSourceNonexistence: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "Pundit's evaluation data covers World Cup 2026 results only.", [], null,
    { expectAccurateProductScope: true }
  ).assertions.productScopeAccurate, false);
  assert.equal(validateResponseCorrectness(
    "No verified source exists for a tactical-concepts question.", [], null,
    { expectNoCategoricalSourceNonexistence: true }
  ).assertions.noCategoricalSourceNonexistence, false);
  assert.equal(validateResponseCorrectness(
    "Your earlier answer did not identify a matchup.", [], null,
    { expectNoHistoryDenial: true }
  ).passed, true);
  assert.equal(validateResponseCorrectness(
    "I don't have the previous answer to reference.", [], null,
    { expectNoHistoryDenial: true }
  ).assertions.noHistoryDenial, false);
});

test("combined-scoreline manifest scenario exercises the built settled sanitizer", async () => {
  const config = JSON.parse(await readFile(
    path.resolve(import.meta.dirname, "../evals/chat/scenarios.json"),
    "utf8"
  ));
  const scenario = config.fixed.find(({ id }) => id === "combined-scoreline-arithmetic");
  assert.equal(scenario?.kind, "runtime-helper");
  assert.equal(scenario?.helper, "sanitizeFinalMatchAnswer");
  const actual = executeRuntimeHelperScenario(scenario, path.resolve(import.meta.dirname, ".."));
  assert.equal(actual.includes("13.6%"), true);
  assert.equal(actual.includes("21%"), false);
});

test("high-line geometry rejects both backwards formulations and requires the real trade-off", () => {
  for (const answer of [
    "A high line shrinks the space behind the defence.",
    "A high line shrinks the space between defence and goalkeeper.",
    "The gap between the defensive line and the keeper is reduced by a high defensive line.",
  ]) {
    assert.equal(validateResponseCorrectness(
      answer, [], null, { expectCorrectHighLineGeometry: true }
    ).passed, false, answer);
  }
  for (const answer of [
    "A high line compresses space between the units ahead of the defence, but creates more space behind it for direct passes.",
    "A high defensive line compresses space in front of the defence but leaves more space behind it for the goalkeeper to cover.",
    "A high defensive line leaves space behind the back line exposed, increasing the risk from runs in behind.",
    "A high defensive line shrinks the defence-to-midfield gap; one vertical pass in behind can become a clean run on goal, so a sweeper-keeper must cover behind.",
    "**Space in behind.** The further the back four push up, the larger the gap behind them.",
    "A high defensive line pushes the back four up. **Space in behind.** This leaves a larger gap behind them.",
    "The back four advance and open a larger channel behind them.",
    "A high line does not reduce space behind the defence; it leaves more space behind for the keeper to cover.",
    "A high defensive line creates a larger gap behind the defence.",
    "A high defensive line leaves a larger gap behind the defence.",
  ]) {
    assert.equal(validateResponseCorrectness(
      answer, [], null, { expectCorrectHighLineGeometry: true }
    ).passed, true, answer);
  }
  assert.equal(validateResponseCorrectness(
    "A high line reduces the space behind the defence, although a runner can still make a clean run on goal.",
    [], null, { expectCorrectHighLineGeometry: true }
  ).passed, false);
  assert.equal(validateResponseCorrectness(
    "A high defensive line shrinks the space behind the defence. The back four push up, creating a larger gap behind them.",
    [], null, { expectCorrectHighLineGeometry: true }
  ).passed, false);
  for (const answer of [
    "A high line leaves less room behind the defence, but invites runs in behind.",
    "A high line narrows the space behind the defence, although balls in behind remain dangerous.",
    "A high line does not leave more space behind, although runs in behind remain dangerous.",
    "A high line creates no larger gap behind the defence, although balls in behind remain dangerous.",
    "The back four push up, but there is not a larger gap behind them even when runners play in behind.",
    "A high line doesn't increase the space behind, although runners attack in behind.",
    "The back four push up without leaving more space behind, although balls are played in behind.",
    "A high line does not widen the extra room behind, although runners attack in behind.",
    "The back four push up, but there is no extra space behind them even when balls are played in behind.",
    "A high line leaves no room behind the defence, although runners attack in behind.",
    "A high line pushes the back four up. It does not leave more space behind them.",
    "A high line pushes the back four up. It doesn't leave more room behind them.",
    "A high line pushes the back four up. It does not produce more space behind them, but invites runs in behind.",
    "A high line pushes the back four up. It does not result in more room behind them, but balls in behind remain dangerous.",
    "A high line creates zero extra space behind them, but runners attack in behind.",
    "A high line fails to create more room behind them, but invites runs in behind.",
    "A high defensive line removes space behind the defence but still invites runs in behind.",
    "A high defensive line eliminates the space behind the defence while runners attack in behind.",
    "A high defensive line decreases space behind the defence, though balls in behind remain dangerous.",
    "A high defensive line makes the gap behind the defence shorter, but invites runs in behind.",
    "A high defensive line makes the space behind tighter, inviting runs in behind.",
    "A high defensive line produces a smaller gap behind the defence, inviting runs in behind.",
    "The back four push up. That creates less room behind them. Runners attack in behind.",
    "A high line compacts midfield. The winger makes runs in behind against a low block.",
  ]) assert.equal(validateResponseCorrectness(
    answer, [], null, { expectCorrectHighLineGeometry: true }
  ).passed, false, answer);

  // Correct geometry stated across a sentence boundary. Every single-sentence
  // pattern stops at `[^.!?\n]`, so a live answer that established the high
  // line in one sentence and its trade-off in the next was failed for putting
  // a full stop in it.
  for (const answer of [
    "A high defensive line compresses the pitch. The trade-off is space: if the first line is beaten, the back four are already close to halfway, so a single pass in behind turns into a one-on-one with the keeper and a clean run on goal.",
    "The back four step up to squeeze the pitch. That leaves more room behind the defence for a runner to attack.",
  ]) assert.equal(validateResponseCorrectness(
    answer, [], null, { expectCorrectHighLineGeometry: true }
  ).assertions.highLineSpaceBehindAcknowledged, true, answer);

  // The consequence must belong to this defence. A later clause about a low
  // block is a different structure and does not acknowledge anything.
  assert.equal(validateResponseCorrectness(
    "A high line compacts midfield. Two sentences later, unrelated. The winger makes runs in behind against a low block.",
    [], null, { expectCorrectHighLineGeometry: true }
  ).assertions.highLineSpaceBehindAcknowledged, false);
});

test("schema-17 treats unavailable verification as an abstention, like abstain", () => {
  // Which of the two a turn lands on depends only on whether any cited page
  // happened to be fetchable. An answer controls neither, and the product
  // branches on them together, so the evaluator must not accept one and fail
  // the other. It previously accepted `abstain` and failed `unavailable`.
  for (const status of ["abstain", "unavailable"]) {
    assert.equal(validateVerification(
      { status, supportedClaimCount: 0, removedClaimCount: 2 },
      { requireCitation: true, allowAbstention: true }
    ).assertions.verificationStatus, true, status);
  }
  // Without allowAbstention, neither is accepted.
  for (const status of ["abstain", "unavailable"]) {
    assert.equal(validateVerification(
      { status, supportedClaimCount: 0, removedClaimCount: 2 },
      { requireCitation: true }
    ).assertions.verificationStatus, false, status);
  }
  // A conflict that still supported a claim is not an abstention.
  assert.equal(validateVerification(
    { status: "conflict", supportedClaimCount: 1, removedClaimCount: 1 },
    { requireCitation: true, allowAbstention: true }
  ).assertions.verificationStatus, false);
  assert.deepEqual([...ABSTAINED_VERIFICATION].sort(), ["abstain", "unavailable"]);

  // A conflict that supported nothing established nothing: sources were
  // retrieved, all of them contradicted each other, and no claim was left
  // standing. There is nothing to cite, so requiring a citation fails an answer
  // for not standing on sources it had just refused to stand on.
  assert.equal(establishedNothing({ status: "conflict", supportedClaimCount: 0, removedClaimCount: 1 }), true);
  assert.equal(validateVerification(
    { status: "conflict", supportedClaimCount: 0, removedClaimCount: 1 },
    { requireCitation: true, allowAbstention: true }
  ).assertions.verificationStatus, true);
  // A conflict that DID support a claim is not an abstention and still owes
  // its citation.
  assert.equal(establishedNothing({ status: "conflict", supportedClaimCount: 2, removedClaimCount: 1 }), false);
  assert.equal(validateVerification(
    { status: "conflict", supportedClaimCount: 2, removedClaimCount: 1 },
    { requireCitation: true, allowAbstention: true }
  ).assertions.verificationStatus, false);
  // "verified" with zero supported claims is incoherent and must not be
  // laundered into an abstention.
  assert.equal(establishedNothing({ status: "verified", supportedClaimCount: 0, removedClaimCount: 0 }), false);
});

test("schema-17 certification cannot pass required inconclusive or unsupported correctness", () => {
  const report = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    scenarios: [
      { id: "friendly", passed: false, outcome: "INCONCLUSIVE", requiredForCertification: true },
      { id: "answer", passed: true, outcome: "PASS", answer: "An answer", qualitativeScores: { correctness: null } },
    ],
  };
  finalizeClassifications(report, null);
  assert.equal(report.overall, "ISSUES FOUND");
  assert.deepEqual(report.certificationGate.requiredInconclusive, ["friendly"]);
  assert.deepEqual(report.certificationGate.unsupportedCorrectness, ["answer"]);
});

test("schema-17 permanent certification matrix names every authorized regression family", async () => {
  const config = JSON.parse(await readFile(
    path.resolve(import.meta.dirname, "../evals/chat/scenarios.json"),
    "utf8"
  ));
  assert.equal(config.schemaVersion, EVAL_SCHEMA_VERSION);
  const ids = new Set(config.fixed.map(({ id }) => id));
  for (const id of [
    "active-match-grounding",
    "temporary-fixture-unavailability",
    "recognized-friendly-outside-coverage",
    "candidate-never-becomes-fixture",
    "unsupported-followup-and-matchup-replacement",
    "table-route-preserves-match",
    "replacing-is-not-epl",
    "priced-fixture-retains-1x2-context",
    "incomplete-market-fails-closed",
    "complete-market-arithmetic",
    "third-party-probability-labelling",
    "model-probabilities-survive-market-guard",
    "external-market-price-still-fails-closed",
    "neutral-venue-missing-input",
    "stale-manager-official-conflict",
    "correction-after-wrong-history",
    "one-one-is-not-over-two-five",
    "combined-scoreline-arithmetic",
    "unrelated-citation-rejected",
    "degraded-search-retrieval-verifier",
    "two-legged-tie-resolves-to-a-real-leg",
    "suggestion-chip-identity-selects-its-leg",
    "observational-live-two-legged-matchup",
    "observational-live-suggestion-chip",
  ]) {
    assert.equal(ids.has(id), true, `missing permanent scenario ${id}`);
  }
  const byId = new Map(config.fixed.map((scenario) => [scenario.id, scenario]));
  for (const id of [
    "recognized-friendly-outside-coverage",
    "temporary-fixture-unavailability",
    "unsupported-followup-and-matchup-replacement",
    "neutral-venue-missing-input",
    "two-legged-tie-resolves-to-a-real-leg",
    "suggestion-chip-identity-selects-its-leg",
  ]) {
    assert.equal(byId.get(id).kind, "runtime-helper");
    assert.notEqual(byId.get(id).requiredForCertification, false);
  }
  // Live-set shape decides whether these can run at all, so they stay
  // observational -- but a failure, as opposed to an absent tie, still counts.
  assert.equal(byId.get("observational-live-two-legged-matchup").kind, "two-legged-matchup");
  assert.equal(byId.get("observational-live-suggestion-chip").kind, "suggestion-chip");
  for (const id of [
    "observational-live-friendly",
    "observational-live-temporary",
    "observational-live-replacement",
    "observational-live-neutral-venue",
    "observational-live-two-legged-matchup",
    "observational-live-suggestion-chip",
  ]) {
    assert.equal(byId.get(id).requiredForCertification, false);
  }
  assert.deepEqual(byId.get("sse-ordering"), {
    id: "sse-ordering",
    description: "Streaming emits grounding before deltas and terminates with done.",
    kind: "sse",
    question: "What does the current Premier League table show?",
    expectGrounding: "competition",
    expectCompetitionId: "eng.1",
  });
});

// ---------------------------------------------------------------------------
// Deployment SHA convergence
//
// The gate used to demand source === api === web. vercel-ignore-build.mjs
// skips a web rebuild for an API-only commit, so that equality is false on
// every API-only push. Convergence now means "served is at or ahead of the
// floor that commit forced for that target", graded through the one shared
// rule in deploy-build-paths.mjs.
// ---------------------------------------------------------------------------

function gitIn(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeIn(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commitIn(cwd, message, files) {
  for (const [relative, content] of Object.entries(files)) writeIn(cwd, relative, content);
  gitIn(cwd, "add", ".");
  gitIn(cwd, "commit", "-qm", message);
  return gitIn(cwd, "rev-parse", "HEAD");
}

async function withDeployRepo(run) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pundit-battle-sha-"));
  try {
    gitIn(cwd, "init", "-q", "-b", "main");
    gitIn(cwd, "config", "user.email", "test@example.com");
    gitIn(cwd, "config", "user.name", "Test");
    const seed = commitIn(cwd, "seed", {
      "package.json": "{}",
      "packages/api/src.ts": "api-0",
      "packages/web/page.tsx": "web-0",
    });
    await run(cwd, seed);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test("an API-only commit converges even though the web deploy legitimately lags", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const apiOnly = commitIn(cwd, "api only", { "packages/api/src.ts": "api-1" });
    const graded = gradeDeploymentShas({ sourceSha: apiOnly, apiSha: apiOnly, webSha: seed, cwd });
    assert.equal(graded.targets.api.floorSha, apiOnly);
    // Vercel skipped this commit, so the seed is still the web floor.
    assert.equal(graded.targets.web.floorSha, seed);
    assert.equal(graded.targets.api.state, "match");
    assert.equal(graded.targets.web.state, "match");
    assert.equal(graded.shaConverged, true);
  });
});

test("a served commit newer than the floor is ahead, not a fault", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const apiOnly = commitIn(cwd, "api only", { "packages/api/src.ts": "api-1" });
    // Vercel fails open to a build when the commit range is unusable, so the
    // web deploy can carry a commit its floor never demanded.
    const graded = gradeDeploymentShas({ sourceSha: apiOnly, apiSha: apiOnly, webSha: apiOnly, cwd });
    assert.equal(graded.targets.web.floorSha, seed);
    assert.equal(graded.targets.web.state, "ahead");
    assert.equal(graded.shaConverged, true);
  });
});

test("a genuinely stale API deploy still fails convergence", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const apiOnly = commitIn(cwd, "api only", { "packages/api/src.ts": "api-1" });
    // Railway had to rebuild for this commit and is still serving the parent.
    const graded = gradeDeploymentShas({ sourceSha: apiOnly, apiSha: seed, webSha: seed, cwd });
    assert.equal(graded.targets.api.state, "stale");
    assert.equal(graded.shaConverged, false);
  });
});

test("a genuinely stale web deploy still fails convergence", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const webCommit = commitIn(cwd, "web change", { "packages/web/page.tsx": "web-1" });
    const graded = gradeDeploymentShas({ sourceSha: webCommit, apiSha: webCommit, webSha: seed, cwd });
    assert.equal(graded.targets.web.floorSha, webCommit);
    assert.equal(graded.targets.web.state, "stale");
    assert.equal(graded.shaConverged, false);
  });
});

test("a target that reports no SHA at all fails convergence", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const graded = gradeDeploymentShas({ sourceSha: seed, apiSha: seed, webSha: null, cwd });
    assert.equal(graded.targets.web.state, "missing");
    assert.equal(graded.shaConverged, false);
  });
});

test("a served commit this clone has never seen is inconclusive, not a false failure", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const graded = gradeDeploymentShas({
      sourceSha: seed,
      apiSha: "0".repeat(40),
      webSha: seed,
      cwd,
    });
    assert.equal(graded.targets.api.state, "unknown");
    assert.equal(graded.shaConverged, null);
  });
});

test("the rendered report names each target's served SHA, state and floor", async () => {
  await withDeployRepo(async (cwd, seed) => {
    const apiOnly = commitIn(cwd, "api only", { "packages/api/src.ts": "api-1" });
    const graded = gradeDeploymentShas({ sourceSha: apiOnly, apiSha: apiOnly, webSha: seed, cwd });
    const described = describeDeploymentShas({
      apiSha: apiOnly, webSha: seed, shaGrading: graded.targets,
    });
    assert.match(described, /api=.*\(match vs floor/);
    assert.match(described, /web=.*\(match vs floor/);
  });
});

// ---------------------------------------------------------------------------
// Recognized-fixture routability
//
// `/api/fixtures/recognized` publishes every *observed* identity; in shadow
// mode chat routes only the enabled ESPN competition windows. Selecting an
// observed-but-unrouted identity and then demanding fixture grounding produced
// a guaranteed failure that was not a product fault.
// ---------------------------------------------------------------------------

const routableEntry = (fixtureId, competitionId, category, capability) => ({
  fixture: { fixtureId, competition: { id: competitionId, category } },
  capability,
});

const OBSERVED_ENTRIES = [
  routableEntry("espn:club.friendly:1", "club.friendly", "club-friendly",
    { status: "outside-coverage", reason: "friendly-policy-disabled" }),
  routableEntry("espn:eng.1:2", "eng.1", "domestic-league", { status: "priced" }),
  routableEntry("espn:uefa.champions_qual:3", "uefa.champions_qual", "continental-club",
    { status: "insufficient-model-input", reason: "required-context-missing" }),
];

test("shadow mode drops identities outside the routed competition windows", () => {
  const routable = routableRecognizedEntries(OBSERVED_ENTRIES, {
    registryEnabled: false,
    enabledCompetitionIds: ["eng.1", "uefa.champions_qual"],
  });
  // The friendly is observed and published, but chat cannot route it, so a
  // scenario asserting its routed contract could only ever fail.
  assert.deepEqual(routable.map((entry) => entry.fixture.fixtureId), ["espn:eng.1:2", "espn:uefa.champions_qual:3"]);
});

test("expanded routing keeps every observed identity, friendlies included", () => {
  const routable = routableRecognizedEntries(OBSERVED_ENTRIES, {
    registryEnabled: true,
    enabledCompetitionIds: ["eng.1"],
  });
  assert.equal(routable.length, OBSERVED_ENTRIES.length);
});

test("shadow mode still routes non-priced fixtures inside an enabled window", () => {
  const routable = routableRecognizedEntries(OBSERVED_ENTRIES, {
    registryEnabled: false,
    enabledCompetitionIds: ["eng.1", "uefa.champions_qual"],
  });
  // The filter narrows by competition window, not by capability: a recognized
  // non-priced fixture in a routed window is still a real, testable case.
  assert.ok(routable.some(({ capability }) => capability.status === "insufficient-model-input"));
});

test("a completed fixture is not routable, in either registry mode", () => {
  // Chat routes against the forward-looking active ESPN set, so a match already
  // played is outside the window for the same reason a friendly is outside the
  // routed competitions. Verified live: a recognized, routed, completed fixture
  // ("Kairat vs Levski") returns grounding: null and the discovery-candidate
  // notice, never fixture-tier grounding -- so selecting one could only ever
  // fail the routed contract.
  const played = {
    fixture: {
      fixtureId: "espn:uefa.champions_qual:9",
      competition: { id: "uefa.champions_qual", category: "continental-club" },
      status: "completed",
    },
    capability: { status: "insufficient-model-input", reason: "required-context-missing" },
  };
  const entries = [...OBSERVED_ENTRIES, played];
  for (const registryEnabled of [false, true]) {
    const routable = routableRecognizedEntries(entries, {
      registryEnabled,
      enabledCompetitionIds: ["eng.1", "uefa.champions_qual"],
    });
    assert.ok(
      !routable.some((entry) => entry.fixture.fixtureId === played.fixture.fixtureId),
      `completed fixture leaked with registryEnabled=${registryEnabled}`
    );
  }
});

test("the routed competition windows come from readiness, not from a hardcoded list", () => {
  assert.deepEqual(
    enabledCompetitionIds({ activeFixtures: { byCompetition: { "eng.1": 20, "uefa.champions_qual": 7 } } }),
    ["eng.1", "uefa.champions_qual"]
  );
  assert.deepEqual(enabledCompetitionIds({}), []);
  assert.deepEqual(enabledCompetitionIds(null), []);
});

test("routability evidence names the mode and the windows it routes", () => {
  const shadow = describeRecognizedRoutability({
    registryEnabled: false, enabledCompetitionIds: ["eng.1"], observed: 75, routable: 74,
  });
  assert.match(shadow, /shadow mode/);
  assert.match(shadow, /eng\.1/);
  assert.match(shadow, /74 of 75/);
  assert.match(
    describeRecognizedRoutability({ registryEnabled: true, observed: 75, routable: 75 }),
    /routing enabled/
  );
});

test("schema-17 separates search narration from a conditional offer to search", () => {
  // "Send those and I'll search for current team news" is not narration of a
  // search in progress -- it is what happens after the reader supplies a
  // fixture, and it is the most useful sentence a clarification reply can end
  // on. A live answer to an ambiguous question failed for offering to help.
  for (const offer of [
    "Send those and I\u2019ll search for current team news with sources.",
    "Once you give me the fixture, I\u2019ll check the latest team news.",
    "If you share the match, I will look at the market too.",
  ]) assert.equal(validateNoDraftLeak(offer).passed, true, offer);

  // Real narration still fails, including when an offer sits elsewhere in the
  // same answer.
  for (const narration of [
    "Let me check the latest news before answering.",
    "I will search for the team news now.",
    "Now I have enough to answer.",
    "Search results show three absences.",
    "Send me the fixture. Now I have enough to answer.",
  ]) assert.equal(validateNoDraftLeak(narration).passed, false, narration);
});

test("schema-17 accepts an unqualified space-behind acknowledgement", () => {
  // "The cost is space behind the defence: a single pass over the top turns
  // the press into a foot race" is as clear as this check gets, and the
  // qualifier list ("more space behind") scored it nothing. Safe to accept
  // unqualified, because reversed geometry is rejected independently.
  for (const answer of [
    "A high line lets the forwards press. The cost is space behind the defence: a single pass over the top turns the press into a foot race.",
    "A high defensive line shortens the press. The trade-off is the gap behind the back four.",
  ]) assert.equal(validateResponseCorrectness(
    answer, [], null, { expectCorrectHighLineGeometry: true }
  ).assertions.highLineSpaceBehindAcknowledged, true, answer);

  // Reversed geometry still fails outright, acknowledgement or not.
  for (const answer of [
    "A high defensive line shrinks the space behind the defence.",
    "A high line removes the space behind the back four entirely.",
  ]) assert.equal(validateResponseCorrectness(
    answer, [], null, { expectCorrectHighLineGeometry: true }
  ).passed, false, answer);
});
