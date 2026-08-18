import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVAL_SCHEMA_VERSION,
  classifyResult,
  compareReports,
  createComparisonBaseline,
  createPacer,
  executeRuntimeHelperScenario,
  fetchWithTimeout,
  finalizeClassifications,
  generateAdversarialScenarios,
  loadPreviousReport,
  loadApiRuntimeCorrectnessHelpers,
  loadApiRuntimeFixtureHelpers,
  loadApiRuntimeRoutingHelpers,
  parseSse,
  recordScenarioFailure,
  recordOptionalScenarioFailure,
  readinessFailures,
  selectFeaturedMatch,
  selectSuggestionChips,
  selectTwoLeggedTie,
  snapshotAskRequest,
  snapshotSseReproduction,
  validateGrounding,
  validateSse,
  validateAnswerCopy,
  validateAnswerStructure,
  validateCitationContract,
  validateErrorCopy,
  validateFixtureGrounding,
  validateNoDraftLeak,
  validateOneXTwoMarket,
  validateResponseCorrectness,
  validateTeamNewsDiscipline,
  validateVerification,
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
  return {
    ...identity,
    url: "https://thepundit.vercel.app/",
    viewport: { width: 390, height: 844 },
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
      },
      {
        id: "fixture-context-retention",
        passed: true,
        evidence: "Observed the same fixture after a table detour and follow-up.",
        reproduction: ["Ask about the fixture", "Ask for the table", "Return to the fixture"],
        scenarioIds: ["table-route-preserves-match", "unsupported-followup-and-matchup-replacement"],
      },
      {
        id: "new-chat-clears-context",
        passed: true,
        evidence: "New Chat removed the retained fixture and visible transcript.",
        reproduction: ["Establish fixture context", "Choose New Chat", "Inspect cleared state"],
        scenarioIds: [],
      },
      {
        id: "candidate-no-fixture-badge",
        passed: true,
        evidence: "An unrecognized candidate displayed no fixture badge.",
        reproduction: ["Submit the candidate matchup", "Inspect the assistant badge area"],
        scenarioIds: ["candidate-never-becomes-fixture"],
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
  assert.equal(classifyResult({ passed: false, outcome: "FAIL" }, null), "EXISTING ISSUE");
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

test("pacer waits for the remaining request interval", async () => {
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
  assert.deepEqual(waits, [11_000]);
  assert.equal(Date.parse(pacer.starts[1]) - Date.parse(pacer.starts[0]), 13_000);
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
    }],
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
  assert.equal(validateAnswerCopy("Pundit's model favours the home side.").passed, true);
  assert.equal(validateAnswerCopy("Using Dixon-Coles probabilities here.").passed, false);
  assert.equal(validateAnswerCopy("ClubElo ratings drive the edge.").passed, false);
  assert.equal(validateAnswerCopy("This is model-grounded analysis.").passed, false);
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
  });
});

test("schema-10 fixture grounding distinguishes capability without leaking model probabilities", () => {
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

test("schema-10 verification contract enforces shape, counts, and abstention semantics", () => {
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

test("schema-10 complete market validator enforces source, time, legs and arithmetic", () => {
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

test("schema-10 correctness guard catches the four screenshot-class failures", () => {
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

test("schema-10 certification cannot pass required inconclusive or unsupported correctness", () => {
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

test("schema-10 permanent certification matrix names every authorized regression family", async () => {
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
