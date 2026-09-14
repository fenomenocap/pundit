#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  finalizeClassifications,
  writeFailureReport,
  writeReport,
} from "./chat-battle-test-lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIN_BROWSER_REQUEST_INTERVAL_MS = 13_025;
const MIN_WALL_CLOCK_REQUEST_INTERVAL_MS = 13_000;
const MIN_API_TO_BROWSER_COOLDOWN_MS = 60_000;
export const CRITIC_DIMENSIONS = Object.freeze([
  "correctness",
  "usefulness",
  "clarity",
  "calibration",
  "groundingFidelity",
  "unsupportedCertainty",
]);

export function criticEvidencePasses(criticReview) {
  return criticReview?.materialIssue === false
    && criticReview?.overallVerdict === "PASS"
    && CRITIC_DIMENSIONS.every((dimension) => criticReview?.dimensionScores?.[dimension] >= 3);
}

export const REQUIRED_BROWSER_CHECKS = Object.freeze({
  "fixture-capability-label": ["recognized-friendly-outside-coverage"],
  "fixture-context-retention": [
    "table-route-preserves-match",
    "unsupported-followup-and-matchup-replacement",
  ],
  "new-chat-clears-context": [],
  "candidate-no-fixture-badge": ["candidate-never-becomes-fixture"],
  "analyst-multi-turn-flow": ["analyst-conversation-golden-path"],
  "cross-surface-fixture-parity": ["analyst-conversation-golden-path", "market-comparison-coverage"],
  "evaluation-calibration-presentation": [],
  "responsive-no-horizontal-overflow": [],
  "visible-analyst-loading-state": ["analyst-conversation-golden-path"],
  "oversized-prompt-client-error": [],
  "frozen-backtest-nonempty": [],
});

function browserViewportClass(candidate) {
  if (!Number.isInteger(candidate?.width) || !Number.isInteger(candidate?.height)) return null;
  if (candidate.width < 768 && candidate.width >= 320 && candidate.height >= 568) return "mobile";
  if (candidate.width >= 1024 && candidate.height >= 568) return "desktop";
  return null;
}

function browserPacingOutcome(pacing) {
  const starts = Array.isArray(pacing?.requestStarts) ? pacing.requestStarts : [];
  const offsets = Array.isArray(pacing?.requestStartOffsetsMs) ? pacing.requestStartOffsetsMs : [];
  const reportedGaps = Array.isArray(pacing?.observedGapsMs) ? pacing.observedGapsMs : [];
  const derivedGaps = offsets.slice(1).map((offset, index) => offset - offsets[index]);
  const wallGaps = starts.slice(1).map((start, index) => Date.parse(start) - Date.parse(starts[index]));
  const cooldown = starts.length > 0 && typeof pacing?.cooldownAnchor === "string"
    ? Date.parse(starts[0]) - Date.parse(pacing.cooldownAnchor)
    : NaN;
  return {
    derivedGaps,
    wallGaps,
    cooldown,
    passed: starts.length > 0
      && pacing?.requestStartCount === starts.length
      && pacing?.apiAskRequestCount === starts.length
      && offsets.length === starts.length
      && offsets[0] === 0
      && reportedGaps.length === Math.max(0, starts.length - 1)
      && reportedGaps.every((gap, index) => Number.isFinite(gap)
        && Math.abs(gap - derivedGaps[index]) < 0.001
        && gap >= MIN_BROWSER_REQUEST_INTERVAL_MS)
      && wallGaps.every((gap) => Number.isFinite(gap) && gap >= MIN_WALL_CLOCK_REQUEST_INTERVAL_MS)
      && Number.isFinite(cooldown)
      && cooldown >= MIN_API_TO_BROWSER_COOLDOWN_MS,
  };
}

function probabilityTriplet(candidate) {
  return Array.isArray(candidate) && candidate.length === 3
    && candidate.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    ? candidate
    : null;
}

function probabilityTripletsAgree(left, right, tolerance = 0.00051) {
  return Boolean(probabilityTriplet(left) && probabilityTriplet(right))
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function reportExpectsMarketRows(report) {
  const scenario = (report?.scenarios ?? []).find(({ id }) => id === "market-comparison-coverage");
  return Number(scenario?.observations?.turn1?.oddsSourceCount ?? 0) > 0;
}

function parseArgs(argv) {
  const options = {
    outputDir: path.join(ROOT, "artifacts/chat-evals"),
    browserPath: null,
    criticPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else if (argument === "--browser-json") options.browserPath = path.resolve(argv[++index]);
    else if (argument === "--critic-json") options.criticPath = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.browserPath || !options.criticPath) {
    throw new Error("--browser-json and --critic-json are required.");
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readLatestRun(outputDir) {
  try {
    return await readJson(path.join(outputDir, "latest-run.json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readJson(path.join(outputDir, "latest.json"));
  }
}

export function evidenceCompatibilityFailures(report, evidence, label) {
  const failures = [];
  if (evidence?.runId !== report.runId) failures.push(`${label}.runId mismatch`);
  if (evidence?.schemaVersion !== report.schemaVersion) failures.push(`${label}.schemaVersion mismatch`);
  if (evidence?.sourceSha !== report.deployment?.sourceSha) failures.push(`${label}.sourceSha mismatch`);
  if (evidence?.deploymentId !== report.deployment?.id) failures.push(`${label}.deploymentId mismatch`);
  const capturedAt = Date.parse(evidence?.capturedAt ?? "");
  const startedAt = Date.parse(report.startedAt ?? "");
  if (Number.isNaN(capturedAt) || Number.isNaN(startedAt) || capturedAt < startedAt) {
    failures.push(`${label}.capturedAt invalid or predates run`);
  }
  return failures;
}

export function evidenceSchemaFailures(report, browserEvidence, criticReview) {
  const failures = [];
  const browserChecks = browserEvidence?.checks;
  const productionUrl = (() => {
    try {
      const parsed = new URL(browserEvidence?.url ?? "");
      return parsed.protocol === "https:" && parsed.origin === new URL(report.webUrl ?? "").origin;
    } catch {
      return false;
    }
  })();
  if (!productionUrl) failures.push("browser evidence URL must match the evaluated production web origin");
  const viewport = browserEvidence?.viewport;
  if (!Number.isInteger(viewport?.width) || viewport.width < 320
    || !Number.isInteger(viewport?.height) || viewport.height < 568) {
    failures.push("browser evidence requires a valid viewport of at least 320x568");
  }
  const viewports = Array.isArray(browserEvidence?.viewports) ? browserEvidence.viewports : [];
  const validViewports = viewports.every((candidate) =>
    Number.isInteger(candidate?.width) && candidate.width >= 320
    && Number.isInteger(candidate?.height) && candidate.height >= 568
  );
  const hasMobile = viewports.some((candidate) => candidate.width < 768);
  const hasDesktop = viewports.some((candidate) => candidate.width >= 1024);
  if (!validViewports || !hasMobile || !hasDesktop) {
    failures.push("browser evidence requires mobile and desktop viewports");
  }
  const consoleEvidence = browserEvidence?.console;
  if (!Array.isArray(consoleEvidence?.errors) || !Array.isArray(consoleEvidence?.warnings)) {
    failures.push("browser evidence requires captured console errors and warnings arrays");
  }
  const pacing = browserEvidence?.pacing;
  const pacingStarts = Array.isArray(pacing?.requestStarts) ? pacing.requestStarts : [];
  const finalApiRequestStart = report?.pacing?.requestStarts?.at(-1);
  const reportCompletedEpochMs = Date.parse(report?.completedAt ?? "");
  const finalApiEpochMs = Date.parse(finalApiRequestStart ?? "");
  const expectedCooldownAnchor = !Number.isNaN(reportCompletedEpochMs)
    && reportCompletedEpochMs > finalApiEpochMs
    ? report.completedAt
    : finalApiRequestStart;
  const pacingShapeValid = Number.isFinite(pacing?.minimumIntervalMs)
    && pacing.minimumIntervalMs >= MIN_BROWSER_REQUEST_INTERVAL_MS
    && pacingStarts.length > 0
    && pacingStarts.every((value) => !Number.isNaN(Date.parse(value)))
    && Array.isArray(pacing?.requestStartOffsetsMs)
    && pacing.requestStartOffsetsMs.every(Number.isFinite)
    && Array.isArray(pacing?.observedGapsMs)
    && pacing.observedGapsMs.every(Number.isFinite)
    && Number.isInteger(pacing?.requestStartCount)
    && Number.isInteger(pacing?.apiAskRequestCount)
    && typeof pacing?.finalApiRequestStart === "string"
    && pacing.finalApiRequestStart === finalApiRequestStart
    && pacing.harnessCompletedAt === (report.completedAt ?? null)
    && pacing.cooldownAnchor === expectedCooldownAnchor
    && pacing.firstBrowserRequestStart === pacingStarts[0]
    && pacing.cooldownMinimumMs >= MIN_API_TO_BROWSER_COOLDOWN_MS
    && Number.isFinite(pacing?.cooldownObservedMs)
    && typeof pacing?.passed === "boolean";
  if (!pacingShapeValid) {
    failures.push("browser evidence requires complete request pacing and API cooldown fields");
  } else {
    const pacingOutcome = browserPacingOutcome(pacing);
    if (Math.abs(pacing.cooldownObservedMs - pacingOutcome.cooldown) >= 1) {
      failures.push("browser cooldown evidence is internally inconsistent");
    }
    if (pacing.passed !== pacingOutcome.passed) {
      failures.push("browser pacing passed flag is inconsistent with recorded request starts");
    }
  }
  const gradedWeb = report?.deployment?.shaGrading?.web;
  const webVersion = browserEvidence?.webVersion;
  const versionShapeValid = gradedWeb
    && typeof webVersion?.expectedServedSha === "string"
    && webVersion.expectedServedSha === gradedWeb.servedSha
    && typeof webVersion?.floorSha === "string"
    && webVersion.floorSha === gradedWeb.floorSha
    && webVersion.gradedState === gradedWeb.state
    && [webVersion.before, webVersion.after].every((sample) =>
      typeof sample?.sha === "string"
      && /^[0-9a-f]{7,40}$/i.test(sample.sha)
      && !Number.isNaN(Date.parse(sample?.capturedAt ?? ""))
    )
    && Date.parse(webVersion.before.capturedAt) <= Date.parse(pacingStarts[0] ?? "")
    && Date.parse(webVersion.after.capturedAt) >= Date.parse(pacingStarts.at(-1) ?? "")
    && typeof webVersion?.passed === "boolean";
  if (!versionShapeValid) {
    failures.push("browser evidence requires before/after web version samples bound to the graded SHA and floor");
  } else {
    const versionPassed = webVersion.before.sha === gradedWeb.servedSha
      && webVersion.after.sha === gradedWeb.servedSha;
    if (webVersion.passed !== versionPassed) {
      failures.push("browser web-version passed flag is inconsistent with captured SHAs");
    }
  }
  const expectedApiSha = report?.deployment?.apiSha
    ?? report?.deployment?.shaGrading?.api?.servedSha;
  const gradedApiSha = report?.deployment?.shaGrading?.api?.servedSha;
  const apiVersion = browserEvidence?.apiVersion;
  const apiVersionShapeValid = typeof expectedApiSha === "string"
    && (typeof gradedApiSha !== "string" || gradedApiSha === expectedApiSha)
    && typeof report?.deployment?.id === "string"
    && apiVersion?.expectedSha === expectedApiSha
    && apiVersion?.expectedDeploymentId === report.deployment.id
    && [apiVersion?.before, apiVersion?.after].every((sample) =>
      typeof sample?.sha === "string"
      && /^[0-9a-f]{7,40}$/i.test(sample.sha)
      && typeof sample?.deploymentId === "string"
      && !Number.isNaN(Date.parse(sample?.capturedAt ?? ""))
    )
    && Date.parse(apiVersion.before.capturedAt) <= Date.parse(pacingStarts[0] ?? "")
    && Date.parse(apiVersion.after.capturedAt) >= Date.parse(pacingStarts.at(-1) ?? "")
    && typeof apiVersion?.passed === "boolean";
  if (!apiVersionShapeValid) {
    failures.push("browser evidence requires before/after API version samples bound to the graded API SHA and deployment ID");
  } else {
    const apiVersionPassed = apiVersion.before.sha === expectedApiSha
      && apiVersion.after.sha === expectedApiSha
      && apiVersion.before.deploymentId === report.deployment.id
      && apiVersion.after.deploymentId === report.deployment.id;
    if (apiVersion.passed !== apiVersionPassed) {
      failures.push("browser API-version passed flag is inconsistent with captured runtime identity");
    }
  }
  if (typeof browserEvidence?.passed !== "boolean" || typeof browserEvidence?.summary !== "string" || !browserEvidence.summary.trim()
    || !Array.isArray(browserChecks) || browserChecks.length === 0
    || browserChecks.some((check) => typeof check?.id !== "string"
      || typeof check?.passed !== "boolean"
      || typeof check?.evidence !== "string" || !check.evidence.trim()
      || !Array.isArray(check?.reproduction) || check.reproduction.length === 0
      || check.reproduction.some((step) => typeof step !== "string" || !step.trim())
      || !Array.isArray(check?.scenarioIds))) {
    failures.push("browser evidence requires typed checks with id, evidence, reproduction steps, and scenario IDs");
  } else {
    const byId = new Map(browserChecks.map((check) => [check.id, check]));
    if (byId.size !== browserChecks.length) failures.push("browser evidence contains duplicate check IDs");
    const scenarioById = new Map((report.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
    for (const [checkId, requiredScenarioIds] of Object.entries(REQUIRED_BROWSER_CHECKS)) {
      const check = byId.get(checkId);
      if (!check) {
        failures.push(`browser evidence missing required check: ${checkId}`);
        continue;
      }
      const checkViewportClasses = new Set(
        (Array.isArray(check.viewports) ? check.viewports : []).map(browserViewportClass).filter(Boolean)
      );
      if (!checkViewportClasses.has("mobile") || !checkViewportClasses.has("desktop")) {
        failures.push(`browser check ${checkId} requires mobile and desktop evidence`);
      }
      if (check.passed && checkId === "analyst-multi-turn-flow"
        && (!Number.isInteger(check.turnCount) || check.turnCount < 6)) {
        failures.push("browser analyst-multi-turn-flow requires at least six observed turns");
      }
      if (checkId === "cross-surface-fixture-parity") {
        const surfaces = new Set(Array.isArray(check.surfaces) ? check.surfaces : []);
        for (const surface of ["chat", "fixtures", "predictions"]) {
          if (!surfaces.has(surface)) failures.push(`browser cross-surface-fixture-parity missing surface: ${surface}`);
        }
        const parityEvidence = Array.isArray(check.parityEvidence) ? check.parityEvidence : [];
        if (check.passed && parityEvidence.length < 2) {
          failures.push("browser cross-surface-fixture-parity requires structured mobile and desktop snapshots");
        }
        for (const observation of parityEvidence) {
          const canonical = observation?.canonicalFixture;
          const snapshots = observation?.surfaceSnapshots;
          const canonicalValid = typeof canonical?.fixtureId === "string"
            && canonical.capability === "priced"
            && typeof canonical?.home === "string"
            && typeof canonical?.away === "string"
            && typeof canonical?.modelVersion === "string"
            && typeof canonical?.ratingArtifactId === "string"
            && canonical.reportPricingVersion === canonical.ratingArtifactId
            && typeof canonical?.forecastAt === "string"
            && !Number.isNaN(Date.parse(canonical.forecastAt))
            && probabilityTriplet(canonical.probabilities)
            && probabilityTriplet(canonical.reportProbabilities)
            && canonical.reportMatches === true
            && probabilityTripletsAgree(canonical.reportProbabilities, canonical.probabilities);
          const snapshotsValid = canonicalValid && ["chat", "fixtures", "predictions"].every((surface) => {
            const snapshot = snapshots?.[surface];
            const commonValid = snapshot?.visible === true
              && snapshot.fixtureId === canonical.fixtureId
              && snapshot.capability === canonical.capability
              && probabilityTripletsAgree(snapshot.probabilities, canonical.probabilities);
            if (!commonValid || surface === "fixtures") return commonValid;
            if (surface === "chat" && snapshot.ratingArtifactId !== canonical.ratingArtifactId) {
              return false;
            }
            if (surface === "predictions" && snapshot.modelVersion !== canonical.modelVersion) {
              return false;
            }
            if (surface === "predictions") return snapshot.forecastAt === canonical.forecastAt;
            return typeof snapshot.pricedAt === "string"
              && !Number.isNaN(Date.parse(snapshot.pricedAt));
          });
          if (!snapshotsValid) {
            failures.push("browser cross-surface-fixture-parity has invalid identity, capability, forecast, or probability evidence");
          }
        }
      }
      if (checkId === "analyst-multi-turn-flow") {
        const expectedRows = reportExpectsMarketRows(report);
        const marketEvidence = Array.isArray(check.marketEvidence) ? check.marketEvidence : [];
        if (check.passed && marketEvidence.length < 2) {
          failures.push("browser analyst-multi-turn-flow requires structured mobile and desktop market evidence");
        }
        for (const observation of marketEvidence) {
          const valid = observation?.expectedRows === expectedRows
            && Number.isInteger(observation?.oddsRows)
            && observation.oddsRows >= 0
            && typeof observation?.explicitNoMarket === "boolean"
            && (expectedRows ? observation.oddsRows > 0 : observation.explicitNoMarket);
          if (!valid) failures.push("browser market evidence does not match report odds coverage");
        }
      }
      for (const scenarioId of requiredScenarioIds) {
        if (!check.scenarioIds.includes(scenarioId)) {
          failures.push(`browser check ${checkId} missing scenario coverage: ${scenarioId}`);
        }
        const scenario = scenarioById.get(scenarioId);
        if (!scenario && report.progress?.status !== "failed") {
          failures.push(`browser check ${checkId} references an unknown scenario: ${scenarioId}`);
        }
      }
    }
  }
  if (typeof criticReview?.materialIssue !== "boolean" || !["PASS", "ISSUES FOUND"].includes(criticReview?.overallVerdict)) {
    failures.push("critic evidence requires materialIssue:boolean and overallVerdict");
  }
  const dimensionScores = criticReview?.dimensionScores;
  const dimensionReasons = criticReview?.dimensionReasons;
  for (const dimension of CRITIC_DIMENSIONS) {
    const score = dimensionScores?.[dimension];
    const reason = dimensionReasons?.[dimension];
    if (!Number.isFinite(score) || score < 1 || score > 4
      || typeof reason !== "string" || !reason.trim()) {
      failures.push(`critic dimension missing or invalid: ${dimension}`);
    }
  }
  const verdicts = Array.isArray(criticReview?.scenarioVerdicts) ? criticReview.scenarioVerdicts : [];
  const byId = new Map(verdicts.map((item) => [item?.scenarioId, item]));
  for (const scenario of report.scenarios ?? []) {
    if (!scenario.answer || scenario.outcome !== "PASS") continue;
    const verdict = byId.get(scenario.id);
    if (!verdict || !["PASS", "ISSUES FOUND"].includes(verdict.verdict)
      || !Number.isFinite(verdict.correctness) || verdict.correctness < 1 || verdict.correctness > 4
      || (verdict.verdict === "PASS" && verdict.correctness < 3)
      || typeof verdict.reason !== "string" || !verdict.reason.trim()) {
      failures.push(`critic scenario verdict missing or invalid: ${scenario.id}`);
    }
  }
  const turnVerdicts = Array.isArray(criticReview?.turnVerdicts) ? criticReview.turnVerdicts : [];
  const byTurn = new Map(turnVerdicts.map((item) => [`${item?.scenarioId}:${item?.turn}`, item]));
  if (byTurn.size !== turnVerdicts.length) failures.push("critic evidence contains duplicate turn verdicts");
  for (const scenario of report.scenarios ?? []) {
    for (const turn of scenario.turnResults ?? []) {
      if (turn.status !== 200 || typeof turn.answer !== "string" || !turn.answer.trim()) continue;
      const verdict = byTurn.get(`${scenario.id}:${turn.turn}`);
      if (!verdict || !["PASS", "ISSUES FOUND"].includes(verdict.verdict)
        || !Number.isFinite(verdict.correctness) || verdict.correctness < 1 || verdict.correctness > 4
        || (verdict.verdict === "PASS" && verdict.correctness < 3)
        || typeof verdict.reason !== "string" || !verdict.reason.trim()) {
        failures.push(`critic turn verdict missing or invalid: ${scenario.id}#${turn.turn}`);
      }
    }
  }
  return failures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [report, browserEvidence, criticReview] = await Promise.all([
    readLatestRun(options.outputDir),
    readJson(options.browserPath),
    readJson(options.criticPath)
  ]);
  if (report.runtimeRegrade) {
    throw new Error("assertion-only runtime regrades are comparison baselines and cannot be finalized");
  }
  const compatibilityFailures = [
    ...evidenceCompatibilityFailures(report, browserEvidence, "browser"),
    ...evidenceCompatibilityFailures(report, criticReview, "critic"),
  ];
  compatibilityFailures.push(...evidenceSchemaFailures(report, browserEvidence, criticReview));
  if (compatibilityFailures.length > 0) {
    throw new Error(`evidence compatibility failed: ${compatibilityFailures.join("; ")}`);
  }
  report.browserEvidence = browserEvidence;
  report.criticReview = criticReview;
  const criticById = new Map(criticReview.scenarioVerdicts.map((item) => [item.scenarioId, item]));
  const criticByTurn = new Map((criticReview.turnVerdicts ?? []).map((item) => [
    `${item.scenarioId}:${item.turn}`,
    item,
  ]));
  for (const scenario of report.scenarios) {
    const verdict = criticById.get(scenario.id);
    const successfulTurns = (scenario.turnResults ?? []).filter((turn) =>
      turn.status === 200 && typeof turn.answer === "string" && turn.answer.trim()
    );
    const turnReviews = successfulTurns.map((turn) => criticByTurn.get(`${scenario.id}:${turn.turn}`));
    const failedTurn = turnReviews.find((item) => item?.verdict !== "PASS" || item?.correctness < 3);
    if (verdict) {
      scenario.qualitativeScores = { ...(scenario.qualitativeScores ?? {}), correctness: verdict.correctness };
    }
    if (verdict || successfulTurns.length > 0) {
      scenario.correctnessCertified = Boolean(verdict)
        && verdict.verdict === "PASS"
        && verdict.correctness >= 3
        && turnReviews.length === successfulTurns.length
        && !failedTurn;
    }
    if ((verdict && verdict.verdict !== "PASS") || failedTurn) {
      scenario.passed = false;
      scenario.outcome = "FAIL";
      scenario.evidence = `${scenario.evidence}; critic: ${failedTurn?.reason ?? verdict?.reason ?? "correctness issue"}`;
    }
  }
  finalizeClassifications(report, report.comparisonBaseline ?? null);
  report.recommendations = (criticReview.recommendations ?? []).slice(0, 3);
  const browserPassed = browserEvidence.passed
    && browserEvidence.console.errors.length === 0
    && browserEvidence.checks.every((check) => check.passed)
    && browserEvidence.pacing.passed === true
    && browserEvidence.webVersion.passed === true
    && browserEvidence.apiVersion.passed === true;
  const criticPassed = criticEvidencePasses(criticReview);
  report.qualitativeScores = { ...criticReview.dimensionScores };
  report.certificationGate.browserPassed = browserPassed;
  report.certificationGate.criticPassed = criticPassed;
  report.certificationGate.passed = report.certificationGate.passed && browserPassed && criticPassed;
  if (!report.certificationGate.passed) {
    report.overall = "ISSUES FOUND";
  }
  report.completedAt = new Date().toISOString();
  const paths = report.progress?.status === "failed"
    ? await writeFailureReport(report, options.outputDir)
    : await writeReport(report, options.outputDir);
  console.log(JSON.stringify({ runId: report.runId, overall: report.overall, report: paths }, null, 2));
}

const executedDirectly = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("finalize-chat-report.mjs");
if (executedDirectly) {
  main().catch((error) => {
    console.error(`chat report finalization failed: ${error.message}`);
    process.exitCode = 1;
  });
}
