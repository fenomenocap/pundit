import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVAL_SCHEMA_VERSION,
  classifyResult,
  compareReports,
  createPacer,
  finalizeClassifications,
  generateAdversarialScenarios,
  loadPreviousReport,
  parseSse,
  readinessFailures,
  selectFeaturedMatch,
  validateSse,
  writeReport
} from "./chat-battle-test-lib.mjs";

test("selectFeaturedMatch excludes completed and placeholder fixtures", () => {
  const match = selectFeaturedMatch([
    { stage: "semifinals", status: "COMPLETED", homeTeam: "Spain", awayTeam: "Brazil" },
    { stage: "final", status: "SCHEDULED", homeTeam: "Semifinal 1 Winner", awayTeam: "TBD" },
    { stage: "3rd-place-match", status: "IN_PLAY", homeTeam: "England", awayTeam: "Argentina" }
  ]);
  assert.equal(match.homeTeam, "England");
});

test("SSE parser and validator enforce grounding, delta, done order", () => {
  const events = parseSse([
    'event: grounding\ndata: {"grounding":{"kind":"tournament"}}',
    'event: delta\ndata: {"text":"Hello"}',
    'event: done\ndata: {"answer":"Hello","grounding":{"kind":"tournament"}}',
    ""
  ].join("\n\n"));
  assert.deepEqual(events.map(({ event }) => event), ["grounding", "delta", "done"]);
  assert.equal(validateSse(events, "tournament").passed, true);
  assert.equal(validateSse(events.slice().reverse(), "tournament").passed, false);
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
  assert.equal(classifyResult({ passed: false, outcome: "INCONCLUSIVE" }, null), "INCONCLUSIVE");
});

test("readiness gating names each failed component", () => {
  assert.deepEqual(readinessFailures({
    status: "loading",
    model: { ready: true },
    football: { ready: false },
    marketOdds: { ready: false }
  }), ["status=loading", "football.ready=false", "marketOdds.ready=false"]);
  assert.deepEqual(readinessFailures({
    status: "ready",
    model: { ready: true },
    football: { ready: true },
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

test("report comparison fails closed across schema or known deployment changes", () => {
  const base = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId: "current",
    deployment: { id: "deploy-b" },
    scenarios: [{ id: "one", classification: "PASS" }]
  };
  assert.equal(compareReports(base, {
    ...base,
    runId: "previous",
    deployment: { id: "deploy-a" }
  }).comparable, false);
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
  assert.equal(JSON.parse(await readFile(path.join(directory, "first.json"), "utf8")).runId, "first");
});
