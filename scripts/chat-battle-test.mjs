#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  loadApiRuntimeCorrectnessHelpers,
  loadApiRuntimeFixtureHelpers,
  parseSse,
  qualitativeScores,
  recordScenarioFailure,
  sanitizeEvidence,
  selectFeaturedMatch,
  readinessFailures,
  validateGrounding,
  validateSse,
  validateAnswerCopy,
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

const DEFAULT_API_URL = "https://thepundit.up.railway.app";
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
    deploymentId: process.env.PUNDIT_DEPLOYMENT_ID ?? null,
    sourceSha: process.env.PUNDIT_SOURCE_SHA ?? null,
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
    else if (argument === "--source-sha") options.sourceSha = argv[++index];
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
  const [apiVersion, webVersion] = await Promise.all([
    fetchJson(`${options.apiUrl}/version`, {}, options.timeoutMs),
    fetchJson(`${options.webUrl}/api/version`, {}, options.timeoutMs),
  ]);
  if (!apiVersion.ok || !/^[0-9a-f]{7,40}$/i.test(apiVersion.body?.sha ?? "")) {
    throw new Error(`API version unavailable: HTTP ${apiVersion.status}`);
  }
  if (!webVersion.ok || !/^[0-9a-f]{7,40}$/i.test(webVersion.body?.sha ?? "")) {
    throw new Error(`web version unavailable: HTTP ${webVersion.status}`);
  }
  return { health, ready, apiVersion, webVersion };
}

async function discoverFeatured(options) {
  const result = await fetchJson(`${options.apiUrl}/api/model/active`, {}, options.timeoutMs);
  if (!result.ok || !Array.isArray(result.body?.fixtures)) {
    throw new Error(`active model discovery failed: HTTP ${result.status}`);
  }
  return { featured: selectFeaturedMatch(result.body.fixtures), result };
}

async function discoverRecognized(options) {
  const result = await fetchJson(`${options.apiUrl}/api/fixtures/recognized`, {}, options.timeoutMs);
  if (!result.ok || !Array.isArray(result.body?.fixtures)) {
    throw new Error(`recognized fixture discovery failed: HTTP ${result.status}`);
  }
  for (const [index, entry] of result.body.fixtures.entries()) {
    const validation = validateFixtureGrounding({ kind: "fixture", ...entry });
    if (!validation.passed) {
      throw new Error(`recognized fixture ${index} violated contract: ${validation.failures.join(", ")}`);
    }
  }
  return { entries: result.body.fixtures, result };
}

function exactRecognizedEntry(entries, featured) {
  if (!featured) return null;
  return entries.find(({ fixture, capability }) =>
    capability?.status === "priced"
    && fixture?.competition?.id === featured.competitionId
    && fixture?.primarySourceFixtureId === String(featured.fixtureId)
  ) ?? null;
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
    verification: null,
    qualitativeScores: null,
    correctnessCertified: false,
    requiredForCertification: scenario.requiredForCertification !== false,
    turnResults: [],
    reproduction: { requests: [] },
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
  fixtureContext,
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
  const requestBody = {
    question: turn.question,
    history,
    teamContext,
    fixtureContext,
  };
  const response = await fetchJson(`${options.apiUrl}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  }, options.timeoutMs);
  return { ...response, start, requestBody };
}

async function runJsonScenario(scenario, options, pacer, onRequestStart) {
  const result = baseResult(scenario);
  const history = [];
  const assertionFailures = [];
  let semanticCheckCount = 0;
  let teamContext = scenario.teamContext;
  let fixtureContext = scenario.fixtureContext;
  for (const [turnIndex, turn] of scenario.turns.entries()) {
    const response = await jsonTurn(
      scenario,
      turnIndex,
      options,
      pacer,
      turn,
      history,
      teamContext,
      fixtureContext,
      onRequestStart
    );
    result.requestStarts.push(response.start);
    result.reproduction.requests.push({
      method: "POST",
      path: "/api/ask",
      body: response.requestBody,
    });
    result.requestLatencies = [...(result.requestLatencies ?? []), response.latencyMs];
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
    // Non-blocking payload facts (market-source coverage) so a thin grounding is
    // visible in the report rather than only in whoever happens to read the answer.
    if (Object.keys(groundingValidation.observations ?? {}).length > 0) {
      result.observations = {
        ...result.observations,
        [`turn${turnNumber}`]: groundingValidation.observations,
      };
    }
    result.answer = response.body?.answer ?? "";
    result.citations = response.body?.citations ?? [];
    result.verification = response.body?.verification ?? null;
    result.grounding = grounding;
    if (grounding?.kind === "match") {
      teamContext = [grounding.home, grounding.away];
      fixtureContext = grounding.fixtureId ? { fixtureId: grounding.fixtureId } : fixtureContext;
    } else if (grounding?.kind === "fixture") {
      teamContext = [grounding.fixture.homeTeam.name, grounding.fixture.awayTeam.name];
      fixtureContext = { fixtureId: grounding.fixture.fixtureId };
    }
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
    const citationRequired = Boolean(turn.requireCitation || scenario.requireCitation)
      && result.verification?.status !== "abstain";
    const citationValidation = validateCitationContract(
      result.answer,
      result.citations,
      citationRequired
    );
    const verificationValidation = validateVerification(result.verification, {
      ...turn,
      requireCitation: Boolean(turn.requireCitation || scenario.requireCitation),
      allowAbstention: Boolean(turn.allowAbstention || scenario.allowAbstention),
    });
    for (const [name, passed] of Object.entries(verificationValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...verificationValidation.failures.map((failure) => `turn ${turnNumber}: ${failure}`));
    for (const [name, passed] of Object.entries(citationValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    const draftValidation = validateNoDraftLeak(result.answer);
    result.assertions.noDraftLeak = draftValidation.passed;
    assertionFailures.push(...copyValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    assertionFailures.push(...citationValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    assertionFailures.push(...draftValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    assertionFailures.push(...groundingValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    const correctnessValidation = validateResponseCorrectness(
      result.answer,
      result.citations,
      grounding,
      turn
    );
    semanticCheckCount += Object.keys(correctnessValidation.assertions).length;
    for (const [name, passed] of Object.entries(correctnessValidation.assertions)) {
      result.assertions[`turn${turnNumber}${name[0].toUpperCase()}${name.slice(1)}`] = passed;
    }
    assertionFailures.push(...correctnessValidation.failures.map((failure) =>
      `turn ${history.length / 2}: ${failure}`
    ));
    result.turnResults.push({
      turn: turnNumber,
      request: response.requestBody,
      status: response.status,
      latencyMs: response.latencyMs,
      grounding,
      capability: grounding?.capability ?? (grounding?.kind === "match" ? { status: "priced", modelFixtureId: grounding.fixtureId } : null),
      citations: result.citations,
      verification: result.verification,
      answer: result.answer,
      assertions: Object.fromEntries(Object.entries(result.assertions).filter(([name]) => name.startsWith(`turn${turnNumber}`))),
    });
  }
  if (scenario.requireSourcedTeamNews) {
    const newsValidation = validateTeamNewsDiscipline(result.answer);
    result.assertions.teamNewsSourced = newsValidation.passed;
    semanticCheckCount += 1;
    assertionFailures.push(...newsValidation.failures.map((failure) =>
      `final answer: ${failure} — ${sanitizeEvidence(result.answer)}`
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
  result.correctnessCertified = result.passed && semanticCheckCount > 0;
  result.outcome = result.passed ? "PASS" : "FAIL";
  result.evidence = result.passed
    ? `${scenario.turns.length} turn(s), grounding=${result.grounding?.kind ?? "null"}, fixture=${result.grounding?.fixtureId ?? result.grounding?.fixture?.fixtureId ?? "none"}, capability=${result.grounding?.capability?.status ?? "priced-or-n/a"}, verification=${result.verification?.status ?? "missing"}, citations=${result.citations.length}, answer=${result.answer.length} chars.`
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
  result.reproduction.requests.push({ method: "POST", path: "/api/ask", body: scenario.body });
  result.latencyMs = response.latencyMs;
  result.requestLatencies = [response.latencyMs];
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
  result.requestLatencies = [result.latencyMs];
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    result.evidence = `Expected SSE, received HTTP ${response.status}: ${sanitizeEvidence(text)}`;
    return result;
  }
  const events = parseSse(text);
  result.reproduction.requests.push({
    method: "POST",
    path: "/api/ask",
    body: { question: scenario.question, stream: true },
  });
  result.sse = { eventOrder: events.map(({ event }) => event) };
  const validation = validateSse(events, scenario);
  Object.assign(result, validation);
  result.outcome = result.passed ? "PASS" : "FAIL";
  const done = events.findLast(({ event }) => event === "done");
  result.answer = done?.payload?.answer ?? "";
  result.citations = done?.payload?.citations ?? [];
  result.verification = done?.payload?.verification ?? null;
  const verificationValidation = validateVerification(result.verification, scenario);
  Object.assign(result.assertions, verificationValidation.assertions);
  if (!verificationValidation.passed) {
    result.passed = false;
    result.failures = [...(result.failures ?? []), ...verificationValidation.failures];
  }
  const copyValidation = validateAnswerCopy(result.answer);
  result.assertions.plainLanguageCopy = copyValidation.passed;
  if (!copyValidation.passed) {
    result.passed = false;
    result.failures = [...(result.failures ?? []), ...copyValidation.failures];
  }
  const citationValidation = validateCitationContract(
    result.answer,
    result.citations,
    Boolean(scenario.requireCitation)
  );
  const draftValidation = validateNoDraftLeak(result.answer);
  Object.assign(result.assertions, citationValidation.assertions, { noDraftLeak: draftValidation.passed });
  if (!citationValidation.passed || !draftValidation.passed) {
    result.passed = false;
    result.failures = [
      ...(result.failures ?? []),
      ...citationValidation.failures,
      ...draftValidation.failures,
    ];
  }
  result.evidence = result.passed
    ? `SSE order: ${events.map(({ event }) => event).join(" → ")}.`
    : [...(result.failures ?? []), `SSE order: ${events.map(({ event }) => event).join(" → ")}.`].join("; ");
  result.correctnessCertified = false;
  result.turnResults.push({
    turn: 1,
    request: { question: scenario.question, stream: true },
    status: result.status,
    latencyMs: result.latencyMs,
    grounding: result.grounding,
    capability: result.grounding?.capability ?? null,
    citations: result.citations,
    verification: result.verification,
    answer: result.answer,
    assertions: result.assertions,
    sse: result.sse,
  });
  result.qualitativeScores = qualitativeScores(result);
  return result;
}

async function runCancellationScenario(scenario, options, pacer, onRequestStart) {
  const result = baseResult(scenario);
  await pacer.beforeRequest();
  const start = pacer.starts.at(-1);
  result.requestStarts.push(start);
  await onRequestStart({
    scenarioId: scenario.id,
    category: scenario.category ?? "fixed",
    requestKind: "cancellation",
    turn: 1,
    question: scenario.question,
    startedAt: start,
  });
  const controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), 250);
  const started = Date.now();
  try {
    result.reproduction.requests.push({
      method: "POST",
      path: "/api/ask",
      body: { question: scenario.question, stream: true },
      abortAfterMs: 250,
    });
    await fetch(`${options.apiUrl}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: scenario.question, stream: true }),
      signal: controller.signal,
    });
    result.evidence = "Request completed before the evaluator could exercise cancellation.";
  } catch (error) {
    result.latencyMs = Date.now() - started;
    result.requestLatencies = [result.latencyMs];
    result.assertions.clientAbortObserved = error?.name === "AbortError";
    result.assertions.cancelledPromptly = result.latencyMs < 5_000;
    result.passed = Object.values(result.assertions).every(Boolean);
    result.outcome = result.passed ? "PASS" : "FAIL";
    result.evidence = `Client abort observed after ${result.latencyMs}ms.`;
  } finally {
    clearTimeout(cancel);
  }
  return result;
}

async function runScenario(scenario, options, pacer, featured, recognized, onRequestStart) {
  if (scenario.kind === "runtime-helper") {
    const result = baseResult(scenario);
    const helpers = loadApiRuntimeCorrectnessHelpers(ROOT);
    let actual;
    if (scenario.helper === "evaluateFixtureCapability") {
      const fixtureHelpers = loadApiRuntimeFixtureHelpers(ROOT);
      actual = fixtureHelpers.evaluateFixtureCapability(scenario.args[0], scenario.args[1]);
    } else if (scenario.helper === "validateCompleteOneXTwoMarket") {
      actual = helpers.validateCompleteOneXTwoMarket(scenario.args[0]);
    } else if (scenario.helper === "probabilityAttribution") {
      const label = helpers.probabilityAttributionLabel(scenario.args[0]);
      actual = { label, valid: helpers.hasValidProbabilityAttribution(label, scenario.args[0]) };
    } else if (scenario.helper === "attributeManagerEra") {
      actual = helpers.attributeManagerEra(...scenario.args);
    } else if (scenario.helper === "containsCorrectionCue") {
      actual = helpers.containsCorrectionCue(scenario.args[0]);
    } else if (scenario.helper === "settleScorelineTotal") {
      actual = helpers.settleScorelineTotal(...scenario.args);
    } else if (scenario.helper === "applyClaimDecisions") {
      actual = helpers.applyClaimDecisions(...scenario.args);
    } else {
      throw new Error(`Unknown runtime correctness helper: ${scenario.helper}`);
    }
    const serialized = JSON.stringify(actual);
    const assertions = {
      exactRuntimeResult: Object.entries(scenario.expect ?? {}).every(([key, value]) =>
        JSON.stringify(actual?.[key]) === JSON.stringify(value)
      ),
      requiredText: !scenario.expectText || scenario.expectText.every((text) => serialized.includes(text)),
      forbiddenText: !scenario.forbidText || scenario.forbidText.every((text) => !serialized.includes(text)),
    };
    result.assertions = assertions;
    result.passed = Object.values(assertions).every(Boolean);
    result.correctnessCertified = result.passed;
    result.outcome = result.passed ? "PASS" : "FAIL";
    result.runtimeHelper = {
      module: scenario.helper === "evaluateFixtureCapability"
        ? "packages/api/src/services/fixture-registry.ts"
        : "packages/api/src/services/response-correctness.ts",
      name: scenario.helper,
      actual,
    };
    result.evidence = result.passed
      ? `Built API runtime helper ${scenario.helper} returned the exact expected contract.`
      : `Built API runtime helper ${scenario.helper} mismatch: ${sanitizeEvidence(actual)}.`;
    return result;
  }
  if (scenario.kind === "deterministic") {
    const result = baseResult(scenario);
    let validation;
    if (scenario.validator === "one-x-two-market") {
      validation = validateOneXTwoMarket(scenario.input);
    } else if (scenario.validator === "fixture-grounding") {
      validation = validateFixtureGrounding(scenario.input, scenario.expectation);
    } else if (scenario.validator === "response-correctness") {
      validation = validateResponseCorrectness(
        scenario.input?.answer,
        scenario.input?.citations,
        scenario.input?.grounding,
        scenario.expectation
      );
    } else {
      throw new Error(`Unknown deterministic validator: ${scenario.validator}`);
    }
    result.assertions = validation.assertions ?? { contractPassed: validation.passed };
    result.passed = validation.passed;
    result.correctnessCertified = validation.passed;
    result.outcome = result.passed ? "PASS" : "FAIL";
    result.answer = scenario.input?.answer ?? null;
    result.citations = scenario.input?.citations ?? [];
    result.grounding = scenario.input?.grounding;
    result.evidence = result.passed
      ? `Deterministic ${scenario.validator} contract passed.`
      : `Deterministic ${scenario.validator} contract failed: ${validation.reason ?? validation.failures?.join("; ") ?? "unknown"}.`;
    result.qualitativeScores = qualitativeScores(result);
    return result;
  }
  if (scenario.kind === "inconclusive") {
    return {
      ...baseResult(scenario),
      outcome: "INCONCLUSIVE",
      evidence: scenario.reason
    };
  }
  if (scenario.kind === "recognized") {
    const entry = recognized.find(({ fixture, capability }) =>
      (!scenario.capabilityStatus || capability?.status === scenario.capabilityStatus)
      && (!scenario.capabilityReason || capability?.reason === scenario.capabilityReason)
      && (!scenario.competitionCategory || fixture?.competition?.category === scenario.competitionCategory)
    );
    if (!entry) return { ...baseResult(scenario), outcome: "INCONCLUSIVE", evidence: `No exact recognized fixture matched ${scenario.capabilityStatus ?? "any"}/${scenario.capabilityReason ?? "any"}.` };
    return runJsonScenario({
      ...scenario,
      kind: "json",
      fixtureContext: { fixtureId: entry.fixture.fixtureId },
      teamContext: [entry.fixture.homeTeam.name, entry.fixture.awayTeam.name],
      turns: scenario.turns.map((turn) => ({
        ...turn,
        question: turn.questionTemplate.replaceAll("{home}", entry.fixture.homeTeam.name).replaceAll("{away}", entry.fixture.awayTeam.name),
        expectGrounding: "fixture",
        expectFixtureId: entry.fixture.fixtureId,
        expectTeams: [entry.fixture.homeTeam.name, entry.fixture.awayTeam.name],
        expectCapability: { status: entry.capability.status, reason: entry.capability.reason },
        expectCompetitionCategory: entry.fixture.competition.category,
        expectNoPunditProbabilities: true,
        expectNoScorelines: true,
      })),
    }, options, pacer, onRequestStart);
  }
  if (scenario.kind === "recognized-replacement") {
    const entries = recognized.filter(({ capability }) => capability?.status !== "priced").slice(0, 2);
    if (entries.length < 2) return { ...baseResult(scenario), outcome: "INCONCLUSIVE", evidence: "Fewer than two exact recognized non-priced fixtures; substitution is forbidden." };
    const expected = (entry, question) => ({
      question,
      expectGrounding: "fixture",
      expectFixtureId: entry.fixture.fixtureId,
      expectTeams: [entry.fixture.homeTeam.name, entry.fixture.awayTeam.name],
      expectCapability: { status: entry.capability.status, reason: entry.capability.reason },
      expectNoPunditProbabilities: true,
      expectNoScorelines: true,
    });
    return runJsonScenario({
      ...scenario,
      kind: "json",
      fixtureContext: { fixtureId: entries[0].fixture.fixtureId },
      turns: [
        expected(entries[0], `${entries[0].fixture.homeTeam.name} vs ${entries[0].fixture.awayTeam.name}`),
        expected(entries[0], "What about that fixture's 1X2?"),
        expected(entries[1], `${entries[1].fixture.homeTeam.name} vs ${entries[1].fixture.awayTeam.name}`),
      ],
    }, options, pacer, onRequestStart);
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
      fixtureContext: { fixtureId: featured.recognizedFixtureId },
      teamContext: [featured.home, featured.away],
      turns: [{
        question: `What does Pundit's model say about ${featured.home} vs ${featured.away}?`,
        expectGrounding: "match",
        expectTeams: [featured.home, featured.away],
        expectFixtureId: featured.recognizedFixtureId,
        expectCompetitionId: featured.competitionId
      }]
    }, options, pacer, onRequestStart);
  }
  // Like "featured", but the scenario supplies the question. Team-news and
  // market-comparison checks need to ask something specific of whichever fixture
  // happens to be active, which the fixed "featured" wording cannot express.
  if (scenario.kind === "featured-question") {
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
      fixtureContext: { fixtureId: featured.recognizedFixtureId },
      teamContext: [featured.home, featured.away],
      turns: [{
        question: scenario.questionTemplate
          .replaceAll("{home}", featured.home)
          .replaceAll("{away}", featured.away),
        expectGrounding: "match",
        expectTeams: [featured.home, featured.away],
        expectFixtureId: featured.recognizedFixtureId,
        expectCompetitionId: featured.competitionId,
        expectOddsSources: scenario.expectOddsSources ?? false
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
      fixtureContext: { fixtureId: featured.recognizedFixtureId },
      teamContext: [featured.home, featured.away],
      turns: [
        {
          question: `Compare ${featured.home} and ${featured.away}.`,
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectFixtureId: featured.recognizedFixtureId,
          expectCompetitionId: featured.competitionId
        },
        {
          question: "Which side has the stronger model case, and why?",
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectFixtureId: featured.recognizedFixtureId,
          expectCompetitionId: featured.competitionId
        }
      ]
    }, options, pacer, onRequestStart);
  }
  if (scenario.kind === "featured-turns") {
    if (!featured) {
      return {
        ...baseResult(scenario),
        outcome: "INCONCLUSIVE",
        requiredForCertification: true,
        evidence: "No exact model-backed fixture was available; fixture substitution is forbidden."
      };
    }
    const recognizedFixtureId = featured.recognizedFixtureId;
    return runJsonScenario({
      ...scenario,
      kind: "json",
      fixtureContext: { fixtureId: recognizedFixtureId },
      teamContext: [featured.home, featured.away],
      turns: scenario.turns.map((turn) => ({
        ...turn,
        question: turn.questionTemplate
          ? turn.questionTemplate.replaceAll("{home}", featured.home).replaceAll("{away}", featured.away)
          : turn.question,
        expectTeams: turn.expectGrounding === "match" ? [featured.home, featured.away] : turn.expectTeams,
        expectFixtureId: turn.expectGrounding === "match" ? recognizedFixtureId : turn.expectFixtureId,
        expectCompetitionId: turn.expectGrounding === "match" ? featured.competitionId : turn.expectCompetitionId,
      })),
    }, options, pacer, onRequestStart);
  }
  if (scenario.kind === "invalid") {
    return runInvalidScenario(scenario, options, pacer, onRequestStart);
  }
  if (scenario.kind === "sse") {
    return runSseScenario(scenario, options, pacer, onRequestStart);
  }
  if (scenario.kind === "cancellation") {
    return runCancellationScenario(scenario, options, pacer, onRequestStart);
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
  const [{ featured, result: fixtureDiscovery }, recognizedDiscovery] = await Promise.all([
    discoverFeatured(options), discoverRecognized(options),
  ]);
  const pricedRecognized = exactRecognizedEntry(recognizedDiscovery.entries, featured);
  if (featured && !pricedRecognized) throw new Error("featured model fixture has no exact recognized identity");
  const exactFeatured = featured ? { ...featured, recognizedFixtureId: pricedRecognized.fixture.fixtureId } : null;
  const sourceSha = options.sourceSha ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sourceSha)) throw new Error("--source-sha must be a real Git commit SHA");
  const seed = runId.slice(0, 10);
  const adversarial = generateAdversarialScenarios(seed, exactFeatured)
    .map((scenario) => ({ ...scenario, requiredForCertification: false }));
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
      sourceSha,
      apiSha: preflightResult.apiVersion.body.sha,
      webSha: preflightResult.webVersion.body.sha,
      shaConverged: sourceSha === preflightResult.apiVersion.body.sha && sourceSha === preflightResult.webVersion.body.sha,
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
      versions: {
        api: preflightResult.apiVersion.body,
        web: preflightResult.webVersion.body,
      },
      fixtureDiscovery: {
        status: fixtureDiscovery.status,
        recognized: recognizedDiscovery.result.body,
        featured: featured ? {
          homeTeam: featured.home,
          awayTeam: featured.away,
          competitionId: featured.competitionId,
          competition: featured.competition,
          utcDate: featured.utcDate,
          stage: featured.stage,
          recognizedFixtureId: exactFeatured.recognizedFixtureId,
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
        exactFeatured,
        recognizedDiscovery.entries,
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
