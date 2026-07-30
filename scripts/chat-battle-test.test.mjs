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
  createPacer,
  fetchWithTimeout,
  finalizeClassifications,
  generateAdversarialScenarios,
  loadPreviousReport,
  parseSse,
  recordScenarioFailure,
  readinessFailures,
  selectFeaturedMatch,
  validateGrounding,
  validateSse,
  validateAnswerCopy,
  validateErrorCopy,
  validateTeamNewsDiscipline,
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

test("selectFeaturedMatch uses a model-backed active club fixture with known teams", () => {
  const match = selectFeaturedMatch([
    { competitionId: "eng.1", home: "TBD", away: "Arsenal" },
    { competitionId: "fifa.world", home: "Semifinal 1 Winner", away: "Spain" },
    { competitionId: "uefa.champions_qual", home: "Riga FC", away: "Ararat-Armenia" }
  ]);
  assert.equal(match.home, "Riga FC");
  assert.equal(selectFeaturedMatch([]), null);
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
    deployment: { id: "deploy-a", source: "test" },
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
    deployment: { id: "deploy-a", source: "test" },
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
    deployment: { id: "deploy-a", source: "test" },
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
  await writeFile(browserPath, JSON.stringify({ passed: true, summary: "browser passed" }));
  await writeFile(criticPath, JSON.stringify({
    materialIssue: false,
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
  assert.equal(latestRun.browserEvidence.summary, "browser passed");
  assert.deepEqual(latestRun.recommendations, ["Keep monitoring."]);
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

test("answer copy guard rejects internal methodology jargon", () => {
  assert.equal(validateAnswerCopy("Pundit's model favours the home side.").passed, true);
  assert.equal(validateAnswerCopy("Using Dixon-Coles probabilities here.").passed, false);
  assert.equal(validateAnswerCopy("ClubElo ratings drive the edge.").passed, false);
  assert.equal(validateAnswerCopy("This is model-grounded analysis.").passed, false);
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
