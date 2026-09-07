#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { EVAL_SCHEMA_VERSION, MIN_REQUEST_INTERVAL_MS } from "./chat-battle-test-lib.mjs";
import { REQUIRED_BROWSER_CHECKS } from "./finalize-chat-report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_WEB_URL = "https://thepundit.vercel.app";
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });
const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const ASK_TIMEOUT_MS = 180_000;
const CANDIDATE_QUESTION =
  "What are Pundit's probabilities for Northbridge Athletic vs Southbank Rovers tomorrow?";
const TABLE_QUESTION = "What does the current Premier League table show?";
const ANALYST_FOLLOW_UPS = Object.freeze([
  "What is your fair decimal price for an exact 2-1 score?",
  "Who will most likely score for Liverpool?",
  "If the home striker is ruled out, exactly how many percentage points would you take off the home win?",
  "Quick detour: what does the current Premier League table show?",
  "Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?",
]);

function parseArgs(argv) {
  const options = {
    webUrl: DEFAULT_WEB_URL,
    outputDir: path.join(ROOT, "artifacts/chat-evals"),
    output: null,
    latestRunPath: null,
    dryRun: false,
    intervalMs: MIN_REQUEST_INTERVAL_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--web-url") options.webUrl = argv[++index];
    else if (argument === "--output-dir") options.outputDir = path.resolve(argv[++index]);
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--latest-run") options.latestRunPath = path.resolve(argv[++index]);
    else if (argument === "--interval-ms") options.intervalMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) {
    throw new Error("--interval-ms must be a non-negative number.");
  }
  try {
    const parsed = new URL(options.webUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("web URL must be http(s)");
    }
    options.webUrl = parsed.origin;
  } catch (error) {
    throw new Error(`--web-url is invalid: ${error.message}`);
  }
  return options;
}

function latestRunPath(outputDir, explicitPath = null) {
  return explicitPath ?? path.join(outputDir, "latest-run.json");
}

function browserOutputPath(outputDir, runId) {
  return path.join(outputDir, `${runId}.browser.json`);
}

function identityFromReport(report) {
  if (!report?.runId) throw new Error("latest run is missing runId");
  if (report.schemaVersion !== EVAL_SCHEMA_VERSION) {
    throw new Error(`latest run schema ${report.schemaVersion} is not Schema-${EVAL_SCHEMA_VERSION}`);
  }
  if (!report.deployment?.sourceSha || !report.deployment?.id) {
    throw new Error("latest run is missing deployment.sourceSha or deployment.id");
  }
  return {
    runId: report.runId,
    schemaVersion: report.schemaVersion,
    sourceSha: report.deployment.sourceSha,
    deploymentId: report.deployment.id,
  };
}

function isFixtureChipText(text) {
  if (typeof text !== "string" || !text.includes(" vs ")) return false;
  if (/^Pass or play ·|^Price this ·/i.test(text)) return false;
  return /\s·\s(?:PL|UCL)\s·\s\w+/.test(text)
    && !/\b(?:preview|analyse|analyze|thoughts)\b/i.test(text);
}

function fixtureNamesFromChip(text) {
  const match = /^(.+?) vs (.+?) ·/.exec(text ?? "");
  return match ? { home: match[1], away: match[2] } : null;
}

function requiredCheckIds() {
  return Object.keys(REQUIRED_BROWSER_CHECKS);
}

function emptyCheck(id) {
  return {
    id,
    passed: false,
    evidence: "",
    reproduction: [],
    scenarioIds: [...(REQUIRED_BROWSER_CHECKS[id] ?? [])],
    viewports: [],
  };
}

function recordViewport(check, viewport, { passed, evidence, reproduction, extras = {} }) {
  const next = {
    ...check,
    ...extras,
    passed: check.viewports.length === 0 ? passed : check.passed && passed,
    evidence: check.evidence
      ? `${check.evidence} ${viewport.width}x${viewport.height}: ${evidence}`
      : `${viewport.width}x${viewport.height}: ${evidence}`,
    reproduction: reproduction.length > 0 ? reproduction : check.reproduction,
    viewports: [...check.viewports, { width: viewport.width, height: viewport.height }],
  };
  return next;
}

function summarizeChecks(checks) {
  const failed = checks.filter((check) => !check.passed).map((check) => check.id);
  return failed.length === 0
    ? "Required production browser contracts passed."
    : `Browser contracts failed: ${failed.join(", ")}.`;
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const webRoot = path.join(ROOT, "packages/web");
  for (const spec of ["playwright", "@playwright/test"]) {
    try {
      return require(require.resolve(spec, { paths: [webRoot] }));
    } catch {
      // Try the next spec. Web ships @playwright/test for smoke tests.
    }
  }
  throw new Error("Playwright is not installed. From packages/web run: pnpm exec playwright install chromium");
}

async function readLatestRun(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`latest run not found at ${filePath}; run pnpm chat-eval:production first`);
    }
    throw error;
  }
}

async function waitForAnswer(page) {
  await page.getByRole("button", { name: "Send" }).waitFor({ state: "visible", timeout: ASK_TIMEOUT_MS });
}

async function ask(page, question) {
  const input = page.getByRole("textbox", { name: "Ask a question" });
  await input.fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  await waitForAnswer(page);
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectFixtureChip(page) {
  const chips = page.getByTestId("suggestion-chip");
  const count = await chips.count();
  for (let index = 0; index < count; index += 1) {
    const text = (await chips.nth(index).innerText()).trim();
    if (isFixtureChipText(text)) return { locator: chips.nth(index), text };
  }
  return null;
}

async function runViewportChecks(page, webUrl, viewport, intervalMs) {
  const checks = Object.fromEntries(requiredCheckIds().map((id) => [id, emptyCheck(id)]));
  const reproduction = {
    capability: ["Open /fixtures", "Read the fixture capability label"],
    retention: ["Ask about a featured fixture", "Ask for the Premier League table", "Return to the fixture"],
    newChat: ["Establish fixture context", "Choose New Chat", "Inspect cleared state"],
    candidate: ["Submit the candidate matchup", "Inspect the assistant badge area"],
    analyst: ["Run the six-turn analyst conversation", "Inspect every follow-up"],
    parity: ["Open the fixture in Chat", "Compare Predictions and Fixtures"],
    evaluation: ["Open both evaluation pages", "Inspect headers and calibration tables"],
  };

  await page.goto(`${webUrl}/evaluation/wc-2026`, { waitUntil: "domcontentloaded" });
  const wcHeading = await page.getByRole("heading", { name: "World Cup 2026 backtest" }).isVisible();
  const wcFrozen = await page.getByText("Frozen evaluation", { exact: true }).isVisible();
  await page.getByText(/^Updated /).first().waitFor({ timeout: 15_000 }).catch(() => null);
  const wcUpdated = await page.getByText(/^Updated /).first().isVisible().catch(() => false);
  await page.goto(`${webUrl}/evaluation/club-season`, { waitUntil: "domcontentloaded" });
  const clubHeading = await page.getByRole("heading", { name: "Club season calibration" }).isVisible();
  const clubRolling = await page.getByText("Rolling snapshots", { exact: true }).isVisible();
  await page.getByText(/^Updated /).first().waitFor({ timeout: 15_000 }).catch(() => null);
  const clubUpdated = await page.getByText(/^Updated /).first().isVisible().catch(() => false);
  checks["evaluation-calibration-presentation"] = recordViewport(
    checks["evaluation-calibration-presentation"],
    viewport,
    {
      passed: wcHeading && wcFrozen && clubHeading && clubRolling && (wcUpdated || clubUpdated),
      evidence: `WC heading=${wcHeading} frozen=${wcFrozen}; club heading=${clubHeading} rolling=${clubRolling}.`,
      reproduction: reproduction.evaluation,
    }
  );

  await page.goto(`${webUrl}/fixtures`, { waitUntil: "domcontentloaded" });
  const capabilityText = (
    await page.getByText(/Forecast ready|Outside forecast coverage|Forecast loading|Team ratings unavailable/i).first()
      .textContent()
      .catch(() => "")
  )?.trim() ?? "";
  checks["fixture-capability-label"] = recordViewport(
    checks["fixture-capability-label"],
    viewport,
    {
      passed: capabilityText.length > 0,
      evidence: capabilityText
        ? `Observed capability label "${capabilityText}".`
        : "No recognized-fixture capability label was visible.",
      reproduction: reproduction.capability,
    }
  );

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Ask a question" }).waitFor({ timeout: 30_000 });
  await page.getByTestId("suggestion-chip").first().waitFor({ timeout: 30_000 });
  const fixtureChip = await collectFixtureChip(page);
  const names = fixtureNamesFromChip(fixtureChip?.text);
  let chatMatch = Boolean(names);
  if (names) {
    await page.goto(`${webUrl}/fixtures`, { waitUntil: "domcontentloaded" });
    const fixturesVisible = await page.getByText(names.home, { exact: true }).first().isVisible().catch(() => false);
    await page.goto(`${webUrl}/model`, { waitUntil: "domcontentloaded" });
    const modelVisible = await page.getByText(`${names.home} · ${names.away}`).first().isVisible().catch(() => false);
    checks["cross-surface-fixture-parity"] = recordViewport(
      checks["cross-surface-fixture-parity"],
      viewport,
      {
        passed: chatMatch && fixturesVisible && modelVisible,
        evidence: `${names.home} vs ${names.away}: chat chip=${chatMatch}, fixtures=${fixturesVisible}, predictions=${modelVisible}.`,
        reproduction: reproduction.parity,
        extras: { surfaces: ["chat", "fixtures", "predictions"] },
      }
    );
  } else {
    checks["cross-surface-fixture-parity"] = recordViewport(
      checks["cross-surface-fixture-parity"],
      viewport,
      {
        passed: false,
        evidence: "No upcoming fixture chip was available to compare across surfaces.",
        reproduction: reproduction.parity,
        extras: { surfaces: ["chat", "fixtures", "predictions"] },
      }
    );
  }

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("suggestion-chip").first().waitFor({ timeout: 30_000 });
  if (fixtureChip && names) {
    const chip = await collectFixtureChip(page);
    if (chip) await chip.locator.click();
    await waitForAnswer(page);
    const followingAfterChip = await page.getByText(`Following: ${names.home} vs ${names.away}`).first()
      .isVisible()
      .catch(() => false);
    await sleep(intervalMs);
    await ask(page, TABLE_QUESTION);
    const followingAfterTable = await page.getByText(`Following: ${names.home} vs ${names.away}`).first()
      .isVisible()
      .catch(() => false);
    await sleep(intervalMs);
    await ask(page, "Back to that match: what will the 1X2 be?");
    const followingAfterReturn = await page.getByText(`Following: ${names.home} vs ${names.away}`).first()
      .isVisible()
      .catch(() => false);
    checks["fixture-context-retention"] = recordViewport(
      checks["fixture-context-retention"],
      viewport,
      {
        passed: followingAfterChip && followingAfterTable && followingAfterReturn,
        evidence: `Following retained after chip=${followingAfterChip}, table=${followingAfterTable}, return=${followingAfterReturn}.`,
        reproduction: reproduction.retention,
      }
    );

    await page.getByRole("button", { name: "New Chat" }).click();
    const followingAfterReset = await page.getByText(/^Following:/).first().isVisible().catch(() => false);
    const transcriptGone = await page.getByTestId("match-fixture-card").count() === 0;
    checks["new-chat-clears-context"] = recordViewport(
      checks["new-chat-clears-context"],
      viewport,
      {
        passed: !followingAfterReset && transcriptGone,
        evidence: followingAfterReset
          ? "New Chat left fixture context visible."
          : "New Chat removed the retained fixture and visible transcript.",
        reproduction: reproduction.newChat,
      }
    );

    await sleep(intervalMs);
    await ask(page, `Give me your full preview of ${names.home} vs ${names.away}, including the 1X2, likely scorelines and any comparable market disagreement.`);
    let turnCount = 1;
    for (const followUp of ANALYST_FOLLOW_UPS) {
      await sleep(intervalMs);
      await ask(page, followUp);
      turnCount += 1;
    }
    const stillFollowing = await page.getByText(`Following: ${names.home} vs ${names.away}`).first()
      .isVisible()
      .catch(() => false);
    checks["analyst-multi-turn-flow"] = recordViewport(
      checks["analyst-multi-turn-flow"],
      viewport,
      {
        passed: turnCount >= 6 && stillFollowing,
        evidence: `Observed ${turnCount} analyst turns; following retained=${stillFollowing}.`,
        reproduction: reproduction.analyst,
        extras: { turnCount },
      }
    );
  } else {
    const skipped = "No upcoming fixture chip was available.";
    for (const id of ["fixture-context-retention", "new-chat-clears-context", "analyst-multi-turn-flow"]) {
      checks[id] = recordViewport(checks[id], viewport, {
        passed: false,
        evidence: skipped,
        reproduction: id === "analyst-multi-turn-flow"
          ? reproduction.analyst
          : id === "new-chat-clears-context"
            ? reproduction.newChat
            : reproduction.retention,
        extras: id === "analyst-multi-turn-flow" ? { turnCount: 0 } : {},
      });
    }
  }

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await sleep(intervalMs);
  await ask(page, CANDIDATE_QUESTION);
  const fixtureBadge = await page.getByText(/Match forecast|Outside forecast coverage|Forecast ready/i).first()
    .isVisible()
    .catch(() => false);
  const followingCandidate = await page.getByText(/^Following:/).first().isVisible().catch(() => false);
  const generalBadge = await page.getByText("General football analysis").first().isVisible().catch(() => false);
  checks["candidate-no-fixture-badge"] = recordViewport(
    checks["candidate-no-fixture-badge"],
    viewport,
    {
      passed: !fixtureBadge && !followingCandidate && generalBadge,
      evidence: generalBadge && !fixtureBadge
        ? "An unrecognized candidate displayed no fixture badge."
        : "Candidate turn showed a fixture badge or retained fixture context.",
      reproduction: reproduction.candidate,
    }
  );

  return Object.values(checks);
}

function mergeChecks(left, right) {
  const byId = new Map(left.map((check) => [check.id, check]));
  for (const check of right) {
    const existing = byId.get(check.id);
    if (!existing) {
      byId.set(check.id, check);
      continue;
    }
    byId.set(check.id, {
      ...existing,
      passed: existing.passed && check.passed,
      evidence: `${existing.evidence} ${check.evidence}`,
      reproduction: existing.reproduction.length > 0 ? existing.reproduction : check.reproduction,
      viewports: [...existing.viewports, ...check.viewports],
      ...(check.turnCount != null ? { turnCount: Math.max(existing.turnCount ?? 0, check.turnCount) } : {}),
      ...(check.surfaces ? { surfaces: check.surfaces } : {}),
    });
  }
  return [...byId.values()];
}

function attachConsole(page, bucket) {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") bucket.errors.push(text);
    if (message.type() === "warning") bucket.warnings.push(text);
  });
  page.on("pageerror", (error) => {
    bucket.errors.push(error.message);
  });
}

function buildEvidence({ identity, url, viewport, viewports, console: consoleEvidence, checks }) {
  const passed = checks.every((check) => check.passed) && consoleEvidence.errors.length === 0;
  return {
    ...identity,
    capturedAt: new Date().toISOString(),
    url: `${url}/`,
    viewport,
    viewports,
    console: consoleEvidence,
    passed,
    summary: summarizeChecks(checks),
    checks,
  };
}

async function captureLive(options, report) {
  if (options.intervalMs < MIN_REQUEST_INTERVAL_MS) {
    throw new Error(`Browser capture request spacing must be at least ${MIN_REQUEST_INTERVAL_MS} ms.`);
  }
  const identity = identityFromReport(report);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const consoleEvidence = { errors: [], warnings: [] };
  const viewports = [MOBILE_VIEWPORT, DESKTOP_VIEWPORT];
  let checks = [];
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      attachConsole(page, consoleEvidence);
      const observed = await runViewportChecks(page, options.webUrl, viewport, options.intervalMs);
      checks = checks.length === 0 ? observed : mergeChecks(checks, observed);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return buildEvidence({
    identity,
    url: options.webUrl,
    viewport: MOBILE_VIEWPORT,
    viewports,
    console: consoleEvidence,
    checks,
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runPath = latestRunPath(options.outputDir, options.latestRunPath);
  if (options.dryRun) {
    console.log(JSON.stringify({
      mode: "dry-run",
      productionTraffic: false,
      webUrl: options.webUrl,
      latestRunPath: runPath,
      requiredChecks: requiredCheckIds(),
      viewports: [MOBILE_VIEWPORT, DESKTOP_VIEWPORT],
      minimumRequestIntervalMs: options.intervalMs,
      outputDir: options.outputDir,
    }, null, 2));
    return { dryRun: true };
  }

  const report = await readLatestRun(runPath);
  if (report.webUrl) {
    const reportOrigin = new URL(report.webUrl).origin;
    if (reportOrigin !== options.webUrl) {
      throw new Error(`--web-url ${options.webUrl} does not match the evaluated origin ${reportOrigin}`);
    }
  }
  const evidence = await captureLive(options, report);
  const outputPath = options.output ?? browserOutputPath(options.outputDir, evidence.runId);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({
    runId: evidence.runId,
    passed: evidence.passed,
    output: outputPath,
    summary: evidence.summary,
  }, null, 2));
  if (!evidence.passed) process.exitCode = 1;
  return evidence;
}

export {
  ANALYST_FOLLOW_UPS,
  CANDIDATE_QUESTION,
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
};

const executedDirectly = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith("capture-chat-eval-browser.mjs");
if (executedDirectly) {
  main().catch((error) => {
    console.error(`chat eval browser capture failed: ${error.message}`);
    process.exitCode = 1;
  });
}
