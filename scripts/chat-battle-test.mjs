#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  EVAL_SCHEMA_VERSION,
  MIN_REQUEST_INTERVAL_MS,
  createPacer,
  fetchWithTimeout,
  finalizeClassifications,
  generateAdversarialScenarios,
  loadPreviousReport,
  parseSse,
  qualitativeScores,
  recordScenarioFailure,
  sanitizeEvidence,
  selectFeaturedMatch,
  readinessFailures,
  validateGrounding,
  validateSse,
  validateAnswerCopy,
  validateErrorCopy,
  writeCheckpoint,
  writeFailureReport,
  writeReport
} from "./chat-battle-test-lib.mjs";

const DEFAULT_API_URL = "https://sports-predictapi-production.up.railway.app";
const DEFAULT_WEB_URL = "https://thepundit.vercel.app";
const ROOT = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = {
    apiUrl: DEFAULT_API_URL,
    webUrl: DEFAULT_WEB_URL,
    outputDir: path.join(ROOT, "artifacts/chat-evals"),
    scenariosPath: path.join(ROOT, "evals/chat/scenarios.json"),
    intervalMs: MIN_REQUEST_INTERVAL_MS,
    timeoutMs: 240_000,
    dryRun: false,
    deploymentId: process.env.PUNDIT_DEPLOYMENT_ID ?? null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--api-url") options.apiUrl = argv[++index];
    else if (argument === "--web-url") options.webUrl = argv[++index];
    else if (argument === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else if (argument === "--scenarios-path") options.scenariosPath = path.resolve(argv[++index]);
    else if (argument === "--interval-ms") options.intervalMs = Number(argv[++index]);
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--deployment-id") options.deploymentId = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) {
    throw new Error("--interval-ms must be a non-negative number.");
  }
  return options;
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function fetchJson(url, init, timeoutMs) {
  const started = Date.now();
  const response = await fetchWithTimeout(url, init, timeoutMs);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { invalidJson: text.slice(0, 500) };
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
    latencyMs: Date.now() - started,
    headers: Object.fromEntries(response.headers.entries())
  };
}

async function preflight(options) {
  let health;
  let ready;
  try {
    health = await fetchJson(`${options.apiUrl}/health`, {}, options.timeoutMs);
  } catch (error) {
    throw new Error(`health unreachable: ${error.message}`);
  }
  if (!health.ok || health.body?.status !== "ok") {
    throw new Error(`health failed: HTTP ${health.status} ${sanitizeEvidence(health.body)}`);
  }
  try {
    ready = await fetchJson(`${options.apiUrl}/ready`, {}, options.timeoutMs);
  } catch (error) {
    throw new Error(`readiness unreachable: ${error.message}`);
  }
  const failures = readinessFailures(ready.body);
  if (!ready.ok || failures.length > 0) {
    throw new Error(`readiness failed: HTTP ${ready.status}; ${failures.join(", ")}; ${sanitizeEvidence(ready.body)}`);
  }
  return { health, ready };
}

async function discoverFeatured(options) {
  const result = await fetchJson(`${options.apiUrl}/api/model/active`, {}, options.timeoutMs);
  if (!result.ok || !Array.isArray(result.body?.fixtures)) {
    throw new Error(`active model discovery failed: HTTP ${result.status}`);
  }
  return { featured: selectFeaturedMatch(result.body.fixtures), result };
}

function baseResult(scenario) {
  return {
    id: scenario.id,
    category: scenario.category ?? "fixed",
    passed: false,
    outcome: "FAIL",
    classification: null,
    status: null,
    latencyMs: null,
    requestStarts: [],
    assertions: {},
    answer: null,
    grounding: undefined,
    qualitativeScores: null,
    evidence: ""
  };
}

function failureKind(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed?\s*out|timeout/i.test(message)) return "timeout";
  if (/abort/i.test(message)) return "aborted";
  return "request_error";
}

function failedScenarioResult(scenario, error, requestStarts) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...baseResult(scenario),
    outcome: "FAIL",
    requestStarts,
    failure: {
      kind: failureKind(error),
      message: sanitizeEvidence(message),
    },
    evidence: `Evaluator request failed: ${sanitizeEvidence(message)}`,
  };
}

async function jsonTurn(
  scenario,
  turnIndex,
  options,
  pacer,
  turn,
  history,
  teamContext,
  onRequestStart
) {
  await pacer.beforeRequest();
  const start = pacer.starts.at(-1);
  await onRequestStart({
    scenarioId: scenario.id,
    category: scenario.category ?? "fixed",
    requestKind: "json",
    turn: turnIndex + 1,
    question: turn.question,
    startedAt: start,
  });
  const response = await fetchJson(`${options.apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: turn.question,
      history,
      teamContext
    })
  }, options.timeoutMs);
  return { ...response, start };
}

async function runJsonScenario(scenario, options, pacer, onRequestStart) {
  const result = baseResult(scenario);
  const history = [];
  const assertionFailures = [];
  let teamContext = scenario.teamContext;
  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const response = await jsonTurn(
      scenario,
      turnIndex,
      options,
      pacer,
      turn,
      history,
      teamContext,
      onRequestStart
    );
    result.requestStarts.push(response.start);
    result.status = response.status;
    result.latencyMs = (result.latencyMs ?? 0) + response.latencyMs;
    if (!response.ok) {
      result.evidence = `HTTP ${response.status}: ${sanitizeEvidence(response.body)}`;
      return result;
    }
    const grounding = response.body?.grounding ?? null;
    const groundingValidation = validateGrounding(grounding, turn);
    const turnNumber = history.length / 2 + 1;
    for (const [name, passed] of Object.entries(groundingValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    result.answer = response.body?.answer ?? "";
    result.grounding = grounding;
    teamContext = grounding?.kind === "match"
      ? [grounding.home, grounding.away]
      : undefined;
    history.push(
      { role: "user", content: turn.question },
      { role: "assistant", content: result.answer }
    );
    if (!result.answer.trim()) {
      result.evidence = `Turn ${history.length / 2} returned an empty answer.`;
      return result;
    }
    const copyValidation = validateAnswerCopy(result.answer);
    result.assertions.plainLanguageCopy = copyValidation.passed;
    assertionFailures.push(...copyValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    assertionFailures.push(...groundingValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
  }
  if (scenario.kind === "certainty") {
    const resistsCertainty = /\b(probab|likely|uncertain|cannot|can't|no guarantee|not certain|model|estimate)\b/i.test(result.answer);
    result.assertions.resistsUnsupportedCertainty = resistsCertainty;
    if (!resistsCertainty) {
      assertionFailures.push(
        `final answer did not visibly resist unsupported certainty: ${sanitizeEvidence(result.answer)}`
      );
    }
  }
  result.passed = Object.values(result.assertions).every(Boolean);
  result.outcome = result.passed ? "PASS" : "FAIL";
  result.evidence = result.passed
    ? `${scenario.turns.length} turn(s), grounding=${result.grounding?.kind ?? "null"}, answer=${result.answer.length} chars.`
    : assertionFailures.join("; ");
  result.qualitativeScores = qualitativeScores(result);
  return result;
}

async function runInvalidScenario(scenario, options, pacer, onRequestStart) {
  const result = baseResult(scenario);
  await pacer.beforeRequest();
  const start = pacer.starts.at(-1);
  result.requestStarts.push(start);
  await onRequestStart({
    scenarioId: scenario.id,
    category: scenario.category ?? "fixed",
    requestKind: "invalid",
    turn: 1,
    question: scenario.body?.question ?? null,
    startedAt: start,
  });
  const response = await fetchJson(`${options.apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(scenario.body)
  }, options.timeoutMs);
  result.status = response.status;
  result.latencyMs = response.latencyMs;
  result.assertions.expectedStatus = response.status === scenario.expectStatus;
  result.assertions.sanitizedError = typeof response.body?.error === "string"
    && !/(anthropic|api[_-]?key|stack|token)/i.test(response.body.error);
  const errorCopy = validateErrorCopy(response.body);
  result.assertions.noSchemaLeak = errorCopy.passed;
  result.passed = Object.values(result.assertions).every(Boolean);
  result.outcome = result.passed ? "PASS" : "FAIL";
  result.evidence = errorCopy.passed
    ? `HTTP ${response.status}: ${sanitizeEvidence(response.body)}`
    : `${errorCopy.failures.join("; ")} — ${sanitizeEvidence(response.body)}`;
  return result;
}

async function runSseScenario(scenario, options, pacer, onRequestStart) {
  const result = baseResult(scenario);
  await pacer.beforeRequest();
  const start = pacer.starts.at(-1);
  result.requestStarts.push(start);
  await onRequestStart({
    scenarioId: scenario.id,
    category: scenario.category ?? "fixed",
    requestKind: "sse",
    turn: 1,
    question: scenario.question,
    startedAt: start,
  });
  const started = Date.now();
  const response = await fetchWithTimeout(`${options.apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: scenario.question, stream: true })
  }, options.timeoutMs);
  const text = await response.text();
  result.status = response.status;
  result.latencyMs = Date.now() - started;
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    result.evidence = `Expected SSE, received HTTP ${response.status}: ${sanitizeEvidence(text)}`;
    return result;
  }
  const events = parseSse(text);
  const validation = validateSse(events, scenario);
  Object.assign(result, validation);
  result.outcome = result.passed ? "PASS" : "FAIL";
  const done = events.findLast(({ event }) => event === "done");
  result.answer = done?.payload?.answer ?? "";
  const copyValidation = validateAnswerCopy(result.answer);
  result.assertions.plainLanguageCopy = copyValidation.passed;
  if (!copyValidation.passed) {
    result.passed = false;
    result.failures = [...(result.failures ?? []), ...copyValidation.failures];
  }
  result.evidence = result.passed
    ? `SSE order: ${events.map(({ event }) => event).join(" → ")}.`
    : [...(result.failures ?? []), `SSE order: ${events.map(({ event }) => event).join(" → ")}.`].join("; ");
  result.qualitativeScores = qualitativeScores(result);
  return result;
}

async function runScenario(scenario, options, pacer, featured, onRequestStart) {
  if (scenario.kind === "inconclusive") {
    return {
      ...baseResult(scenario),
      outcome: "INCONCLUSIVE",
      evidence: scenario.reason
    };
  }
  if (scenario.kind === "featured") {
    if (!featured) {
      return {
        ...baseResult(scenario),
        outcome: "INCONCLUSIVE",
        evidence: "No model-backed active club fixture with known teams."
      };
    }
    return runJsonScenario({
      ...scenario,
      kind: "json",
      teamContext: [featured.home, featured.away],
      turns: [{
        question: `What does Pundit's model say about ${featured.home} vs ${featured.away}?`,
        expectGrounding: "match",
        expectTeams: [featured.home, featured.away],
        expectCompetitionId: featured.competitionId
      }]
    }, options, pacer, onRequestStart);
  }
  if (scenario.kind === "featured-follow-up") {
    if (!featured) {
      return {
        ...baseResult(scenario),
        outcome: "INCONCLUSIVE",
        evidence: "No model-backed active club fixture for a valid contextual follow-up."
      };
    }
    return runJsonScenario({
      ...scenario,
      kind: "json",
      teamContext: [featured.home, featured.away],
      turns: [
        {
          question: `Compare ${featured.home} and ${featured.away}.`,
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectCompetitionId: featured.competitionId
        },
        {
          question: "Which side has the stronger model case, and why?",
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectCompetitionId: featured.competitionId
        }
      ]
    }, options, pacer, onRequestStart);
  }
  if (scenario.kind === "invalid") {
    return runInvalidScenario(scenario, options, pacer, onRequestStart);
  }
  if (scenario.kind === "sse") {
    return runSseScenario(scenario, options, pacer, onRequestStart);
  }
  return runJsonScenario(scenario, options, pacer, onRequestStart);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenarioConfig = JSON.parse(await readFile(options.scenariosPath, "utf8"));
  if (scenarioConfig.schemaVersion !== EVAL_SCHEMA_VERSION) {
    throw new Error(`Scenario schema ${scenarioConfig.schemaVersion} does not match evaluator schema ${EVAL_SCHEMA_VERSION}.`);
  }
  if (options.dryRun) {
    const generated = generateAdversarialScenarios("dry-run", null);
    console.log(JSON.stringify({
      mode: "dry-run",
      productionTraffic: false,
      fixedScenarios: scenarioConfig.fixed.map(({ id }) => id),
      adversarialCategories: generated.map(({ category }) => category),
      minimumRequestIntervalMs: options.intervalMs,
      outputDir: options.outputDir
    }, null, 2));
    return;
  }
  if (options.intervalMs < MIN_REQUEST_INTERVAL_MS) {
    throw new Error(`Production request spacing must be at least ${MIN_REQUEST_INTERVAL_MS} ms.`);
  }

  const startedAt = new Date();
  const runId = timestampId(startedAt);
  const previous = await loadPreviousReport(options.outputDir);
  const preflightResult = await preflight(options);
  const { featured, result: fixtureDiscovery } = await discoverFeatured(options);
  const seed = runId.slice(0, 10);
  const adversarial = generateAdversarialScenarios(seed, featured);
  const scenarios = [...scenarioConfig.fixed, ...adversarial];
  const pacer = createPacer(options.intervalMs);
  const deploymentHeader = preflightResult.health.headers["x-railway-deployment-id"]
    ?? preflightResult.ready.headers["x-railway-deployment-id"]
    ?? null;
  const report = {
    schemaVersion: EVAL_SCHEMA_VERSION,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    apiUrl: options.apiUrl,
    webUrl: options.webUrl,
    deployment: {
      id: options.deploymentId ?? deploymentHeader ?? "unknown",
      source: options.deploymentId ? "argument/environment" : deploymentHeader ? "response header" : "unavailable",
      readinessTimestamps: {
        model: preflightResult.ready.body.model.lastUpdated,
        football: preflightResult.ready.body.football.lastUpdated,
        activeFixtures: preflightResult.ready.body.activeFixtures.lastUpdated,
        marketOdds: preflightResult.ready.body.marketOdds.lastUpdated
      }
    },
    preflight: {
      health: { status: preflightResult.health.status, body: preflightResult.health.body },
      readiness: { status: preflightResult.ready.status, body: preflightResult.ready.body },
      fixtureDiscovery: {
        status: fixtureDiscovery.status,
        featured: featured ? {
          homeTeam: featured.home,
          awayTeam: featured.away,
          competitionId: featured.competitionId,
          competition: featured.competition,
          utcDate: featured.utcDate,
          stage: featured.stage,
        } : null
      }
    },
    pacing: {
      minimumIntervalMs: options.intervalMs,
      requestStarts: pacer.starts
    },
    progress: {
      status: "running",
      activeScenario: null,
      activeRequest: null,
      completedScenarioIds: [],
      failure: null,
    },
    scenarios: [],
    browserEvidence: null,
    criticReview: null,
    recommendations: [],
    comparison: null,
    overall: null
  };

  await writeCheckpoint(report, options.outputDir);
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const requestStartIndex = pacer.starts.length;
    report.progress.activeScenario = {
      id: scenario.id,
      category: scenario.category ?? "fixed",
      index: scenarioIndex,
    };
    report.progress.activeRequest = null;
    report.completedAt = new Date().toISOString();
    await writeCheckpoint(report, options.outputDir);
    try {
      const result = await runScenario(
        scenario,
        options,
        pacer,
        featured,
        async (request) => {
          report.progress.activeRequest = request;
          report.completedAt = new Date().toISOString();
          await writeCheckpoint(report, options.outputDir);
        }
      );
      report.scenarios.push(result);
      report.progress.completedScenarioIds.push(scenario.id);
      report.progress.activeScenario = null;
      report.progress.activeRequest = null;
      report.completedAt = new Date().toISOString();
      await writeCheckpoint(report, options.outputDir);
    } catch (error) {
      const failed = failedScenarioResult(
        scenario,
        error,
        pacer.starts.slice(requestStartIndex)
      );
      recordScenarioFailure(report, scenarios, scenarioIndex, failed);
      finalizeClassifications(report, previous);
      const checkpointPath = await writeCheckpoint(report, options.outputDir);
      const paths = await writeFailureReport(report, options.outputDir);
      console.error(`chat battle test stopped at ${scenario.id}: ${failed.failure.message}`);
      console.log(JSON.stringify({
        runId,
        overall: report.overall,
        requests: pacer.starts.length,
        failedScenario: scenario.id,
        checkpointPath,
        report: paths
      }, null, 2));
      process.exitCode = 1;
      return;
    }
  }

  report.progress.status = "complete";
  report.progress.activeScenario = null;
  report.progress.activeRequest = null;
  report.completedAt = new Date().toISOString();
  finalizeClassifications(report, previous);
  await writeCheckpoint(report, options.outputDir);
  const paths = await writeReport(report, options.outputDir);
  console.log(JSON.stringify({
    runId,
    overall: report.overall,
    requests: pacer.starts.length,
    featured: report.preflight.fixtureDiscovery.featured,
    report: paths
  }, null, 2));
}

main().catch((error) => {
  console.error(`chat battle test failed: ${error.message}`);
  process.exitCode = 1;
});
