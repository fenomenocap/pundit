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
const BROWSER_PACING_SAFETY_MS = 25;
const MIN_BROWSER_REQUEST_INTERVAL_MS = MIN_REQUEST_INTERVAL_MS + BROWSER_PACING_SAFETY_MS;
const BROWSER_COOLDOWN_MS = 60_000;
const CANDIDATE_QUESTION =
  "What are Pundit's probabilities for Northbridge Athletic vs Southbank Rovers tomorrow?";
const TABLE_QUESTION = "What does the current Premier League table show?";
const OVERSIZED_QUESTION = "Give me a concise betting read. ".padEnd(501, "x");
const ANALYST_FOLLOW_UPS = Object.freeze([
  "What is your fair decimal price for an exact 2-1 score?",
  "Who is most likely to score in this match?",
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
    intervalMs: MIN_BROWSER_REQUEST_INTERVAL_MS,
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
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < MIN_BROWSER_REQUEST_INTERVAL_MS) {
    throw new Error(`--interval-ms must be at least ${MIN_BROWSER_REQUEST_INTERVAL_MS}.`);
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

function createRequestStartPacer({
  intervalMs = MIN_BROWSER_REQUEST_INTERVAL_MS,
  now = () => performance.now(),
  wallNow = () => Date.now(),
  wait = sleep,
  firstRequestNotBeforeEpochMs = null,
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_BROWSER_REQUEST_INTERVAL_MS) {
    throw new Error(`request pacer interval must be at least ${MIN_BROWSER_REQUEST_INTERVAL_MS} ms`);
  }
  const starts = [];
  const wallStarts = [];
  let lastStart = null;
  return {
    starts,
    wallStarts,
    intervalMs,
    async beforeRequest() {
      while (starts.length === 0 && Number.isFinite(firstRequestNotBeforeEpochMs)) {
        const remaining = firstRequestNotBeforeEpochMs - wallNow();
        if (remaining <= 0) break;
        await wait(remaining);
      }
      while (lastStart != null) {
        const remaining = intervalMs - (now() - lastStart);
        if (remaining <= 0) break;
        await wait(remaining);
      }
      const startedAt = now();
      starts.push(startedAt);
      wallStarts.push(new Date(wallNow()).toISOString());
      lastStart = startedAt;
      return startedAt;
    },
  };
}

function finalApiRequestStart(report) {
  const starts = report?.pacing?.requestStarts;
  if (!Array.isArray(starts) || starts.length === 0) {
    throw new Error("latest run has no authoritative API request starts");
  }
  const value = starts.at(-1);
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) throw new Error("latest run has an invalid final API request start");
  return { value, epochMs };
}

function apiCooldownAnchor(report, finalStart = finalApiRequestStart(report)) {
  const completedAt = report?.completedAt;
  const completedEpochMs = Date.parse(completedAt ?? "");
  if (!Number.isNaN(completedEpochMs) && completedEpochMs > finalStart.epochMs) {
    return { value: completedAt, epochMs: completedEpochMs };
  }
  return finalStart;
}

function percentageTriplet(text) {
  const values = [...String(text ?? "").matchAll(/(\d+(?:\.\d+)?)%/g)]
    .slice(0, 3)
    .map((match) => Number(match[1]) / 100);
  return values.length === 3 && values.every(Number.isFinite) ? values : null;
}

function tripletsAgree(left, right, tolerance = 0.00051) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 3 && right.length === 3
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function reportExpectsMarketRows(report) {
  const scenario = (report?.scenarios ?? []).find(({ id }) => id === "market-comparison-coverage");
  return Number(scenario?.observations?.turn1?.oddsSourceCount ?? 0) > 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function canonicalFixtureSnapshot(report) {
  const fixtureId = report?.preflight?.fixtureDiscovery?.featured?.recognizedFixtureId;
  if (!fixtureId || !report?.apiUrl) return null;
  const reportGrounding = (report?.scenarios ?? [])
    .flatMap((scenario) => [scenario?.grounding, ...(scenario?.turnResults ?? []).map((turn) => turn?.grounding)])
    .find((grounding) => grounding?.kind === "match" && grounding.fixtureId === fixtureId);
  const payload = await fetchJson(`${report.apiUrl}/api/model/active`);
  const fixture = (payload?.fixtures ?? []).find((row) =>
    `espn:${row.competitionId}:${row.fixtureId}` === fixtureId
  );
  if (!fixture) return null;
  const probabilities = [fixture.pHome, fixture.pDraw, fixture.pAway];
  const reportProbabilities = reportGrounding
    ? [reportGrounding.pHome, reportGrounding.pDraw, reportGrounding.pAway]
    : null;
  const ratingArtifactId = fixture.forecastProvenance?.ratingArtifactId ?? null;
  const reportPricingVersion = reportGrounding?.pricing?.modelVersion ?? null;
  return {
    fixtureId,
    capability: "priced",
    competitionId: fixture.competitionId,
    numericFixtureId: fixture.fixtureId,
    home: fixture.home,
    away: fixture.away,
    probabilities,
    reportProbabilities,
    reportPricingVersion,
    ratingArtifactId,
    reportMatches: Boolean(reportGrounding)
      && tripletsAgree(reportProbabilities, probabilities)
      && reportPricingVersion === ratingArtifactId,
    modelVersion: fixture.forecastProvenance?.modelVersion ?? null,
    forecastAt: fixture.forecastProvenance?.forecastAt ?? null,
  };
}

async function captureWebVersion(webUrl) {
  const capturedAt = new Date().toISOString();
  const body = await fetchJson(`${webUrl}/api/version`);
  return { capturedAt, sha: typeof body?.sha === "string" ? body.sha : null };
}

async function captureApiVersion(apiUrl) {
  const capturedAt = new Date().toISOString();
  const body = await fetchJson(`${apiUrl}/version`);
  return {
    capturedAt,
    sha: typeof body?.sha === "string" ? body.sha : null,
    deploymentId: typeof body?.deploymentId === "string" ? body.deploymentId : null,
  };
}

function requiredCheckIds() {
  return Object.keys(REQUIRED_BROWSER_CHECKS);
}

function parseBacktestCounts(text) {
  const match = /(\d+)\s+finished fixtures\s+·\s+(\d+)\s+calibration forecasts/i.exec(text ?? "");
  if (!match) return null;
  return { fixtureCount: Number(match[1]), forecastCount: Number(match[2]) };
}

function oversizedPromptCheckPasses({
  inputLength,
  errorVisible,
  askRequestsBefore,
  askRequestsAfter,
  pacedStartsBefore,
  pacedStartsAfter,
}) {
  return inputLength > 500
    && errorVisible
    && askRequestsAfter === askRequestsBefore
    && pacedStartsAfter === pacedStartsBefore;
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

async function waitForAnswer(page, previousBubbleCount) {
  const result = await page.waitForFunction(({ previousBubbleCount }) => {
    const bubbles = document.querySelectorAll('[data-testid="desk-pundit-bubble"]');
    const alert = document.querySelector('[role="alert"]');
    const send = document.querySelector('button[aria-label="Send"]');
    const finished = bubbles.length > previousBubbleCount || Boolean(alert?.textContent?.trim());
    return finished && send instanceof HTMLButtonElement && !send.disabled
      ? { answered: bubbles.length > previousBubbleCount, error: alert?.textContent?.trim() ?? "" }
      : null;
  }, { previousBubbleCount }, { timeout: ASK_TIMEOUT_MS });
  return result.jsonValue();
}

async function ask(page, question, pacer) {
  const input = page.getByRole("textbox", { name: "Ask a question" });
  const previousBubbleCount = await page.getByTestId("desk-pundit-bubble").count();
  await input.fill(question);
  await pacer.beforeRequest();
  const loadingObservation = page.getByText("Writing the take…", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  await page.getByRole("button", { name: "Send" }).click();
  const loadingObserved = await loadingObservation;
  return { ...(await waitForAnswer(page, previousBubbleCount)), loadingObserved };
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function fixtureLocator(page, testId, fixtureId, visibleOnly = false) {
  if (!fixtureId) throw new Error("Canonical fixture ID is missing");
  return page.locator(`[data-testid=${JSON.stringify(testId)}][data-fixture-id=${JSON.stringify(fixtureId)}]${visibleOnly ? ":visible" : ""}`);
}

async function structuredProbabilities(locator) {
  const values = await Promise.all(["home", "draw", "away"].map((side) => locator.getAttribute(`data-p-${side}`)));
  return values.every((value) => value !== null && value !== "" && Number.isFinite(Number(value)))
    ? values.map(Number) : null;
}

async function collectFeaturedFixture(page, canonical) {
  const locator = fixtureLocator(page, "desk-featured-fixture", canonical?.fixtureId);
  if (!await locator.isVisible()) {
    // The opening chips show only three ranked fixtures. The full slate still
    // owns the report fixture; selecting it changes context without a request.
    const slate = fixtureLocator(page, "desk-slate-fixture", canonical?.fixtureId, true);
    await slate.waitFor({ state: "visible", timeout: 30_000 });
    return { locator: slate, fixtureId: canonical.fixtureId, home: canonical.home, away: canonical.away, source: "slate" };
  }
  const [fixtureId, home, away] = await Promise.all([
    locator.getAttribute("data-fixture-id"),
    locator.getAttribute("data-home"),
    locator.getAttribute("data-away"),
  ]);
  if (!fixtureId || !home || !away) return null;
  return { locator, fixtureId, home, away, source: "featured" };
}

async function clickFeaturedFixture(page, fixture, pacer) {
  if (fixture.source === "slate") {
    await fixture.locator.click();
    return ask(page, `Give me your take on ${fixture.home} vs ${fixture.away}.`, pacer);
  }
  const previousBubbleCount = await page.getByTestId("desk-pundit-bubble").count();
  await pacer.beforeRequest();
  const loadingObservation = page.getByText("Writing the take…", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true, () => false);
  await fixture.locator.click();
  const loadingObserved = await loadingObservation;
  return { ...(await waitForAnswer(page, previousBubbleCount)), loadingObserved };
}

async function latestBoardIdentity(page, fixtureId) {
  const bubble = page.getByTestId("desk-pundit-bubble").last();
  const board = bubble.getByTestId("desk-match-board");
  return {
    boardVisible: await board.isVisible().catch(() => false),
    identityMatches: await board.getAttribute("data-fixture-id").catch(() => null) === fixtureId,
    oddsRows: await board.locator('[data-testid="desk-board-markets"] li').count().catch(() => 0),
  };
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

async function runViewportChecks(page, webUrl, viewport, pacer, report, canonical, traffic, progress) {
  const checks = Object.fromEntries(requiredCheckIds().map((id) => [id, emptyCheck(id)]));
  progress.checks = checks;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/api/ask")) {
      traffic.apiAskRequestCount += 1;
      traffic.lastFixtureId = request.postDataJSON()?.fixtureId ?? null;
    }
  });
  const reproduction = {
    capability: ["Open /fixtures", "Read the fixture capability label"],
    retention: ["Ask about a featured fixture", "Ask for the Premier League table", "Return to the fixture"],
    newChat: ["Establish fixture context", "Choose New Chat", "Inspect cleared state"],
    candidate: ["Submit the candidate matchup", "Inspect the assistant badge area"],
    analyst: ["Run the six-turn analyst conversation", "Inspect every follow-up"],
    parity: ["Open the fixture in Chat", "Compare Predictions and Fixtures"],
    evaluation: ["Open both evaluation pages", "Inspect headers and calibration tables"],
    loading: ["Start the realistic analyst conversation", "Observe the visible writing state before the answer"],
    oversized: ["Paste a 501-character question", "Inspect the client error", "Verify no /api/ask request started"],
    frozen: ["Open the frozen World Cup evaluation", "Read the finished-fixture and calibration-forecast counts"],
  };

  progress.phase = "frozen-evaluation";
  await page.goto(`${webUrl}/evaluation/wc-2026`, { waitUntil: "domcontentloaded" });
  const wcHeading = await page.getByRole("heading", { name: "World Cup 2026 backtest" }).isVisible();
  const wcFrozen = await page.getByText("Frozen evaluation", { exact: true }).isVisible();
  await page.getByText(/^Updated /).first().waitFor({ timeout: 15_000 }).catch(() => null);
  const wcUpdated = await page.getByText(/^Updated /).first().isVisible().catch(() => false);
  const backtestCountText = (await page.getByText(/finished fixtures\s+·\s+\d+ calibration forecasts/i)
    .first().textContent().catch(() => "")) ?? "";
  const backtestCounts = parseBacktestCounts(backtestCountText);
  const backtestNonempty = Boolean(backtestCounts
    && backtestCounts.fixtureCount > 0
    && backtestCounts.forecastCount > 0);
  checks["frozen-backtest-nonempty"] = recordViewport(
    checks["frozen-backtest-nonempty"],
    viewport,
    {
      passed: backtestNonempty,
      evidence: backtestCounts
        ? `Frozen backtest has ${backtestCounts.fixtureCount} finished fixtures and ${backtestCounts.forecastCount} calibration forecasts.`
        : "Frozen backtest counts were missing or malformed.",
      reproduction: reproduction.frozen,
    }
  );
  progress.phase = "club-season-evaluation";
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

  progress.phase = "fixture-capability";
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

  progress.phase = "desk-selection";
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Ask a question" }).waitFor({ timeout: 30_000 });
  await page.getByTestId("desk-featured-fixture").first().waitFor({ timeout: 30_000 }).catch(() => null);
  const featuredFixture = await collectFeaturedFixture(page, canonical);
  const chatMatch = Boolean(featuredFixture);
  let fixtureSurface = null;
  let modelSurface = null;
  if (featuredFixture) {
    const { home, away } = featuredFixture;
    progress.phase = "fixtures-parity";
    await page.goto(`${webUrl}/fixtures`, { waitUntil: "domcontentloaded" });
    const fixtureRow = fixtureLocator(page, "fixture-row", canonical.fixtureId);
    await fixtureRow.waitFor({ timeout: 15_000 }).catch(() => null);
    const fixturesVisible = await fixtureRow.isVisible().catch(() => false);
    const fixtureForecast = fixtureRow.getByTestId("fixture-forecast");
    const fixtureDomId = await fixtureRow.getAttribute("data-fixture-id");
    fixtureSurface = {
      visible: fixturesVisible && await fixtureForecast.isVisible().catch(() => false),
      fixtureId: fixtureDomId,
      capability: await fixtureRow.getAttribute("data-capability"),
      probabilities: await structuredProbabilities(fixtureRow),
    };
    progress.collected.fixtures = fixtureSurface;
    progress.phase = "model-parity";
    await page.goto(`${webUrl}/model`, { waitUntil: "domcontentloaded" });
    const modelRow = fixtureLocator(page, "model-fixture-row", canonical.fixtureId);
    await modelRow.waitFor({ timeout: 15_000 }).catch(() => null);
    const [modelFixtureId, modelVersion, forecastAt] = await Promise.all([
      modelRow.getAttribute("data-fixture-id"),
      modelRow.getAttribute("data-model-version"),
      modelRow.getAttribute("data-forecast-at"),
    ]);
    modelSurface = {
      visible: await modelRow.isVisible().catch(() => false),
      fixtureId: modelFixtureId,
      capability: await modelRow.getAttribute("data-capability"),
      probabilities: await structuredProbabilities(modelRow),
      modelVersion,
      forecastAt,
    };
    progress.collected.model = modelSurface;
  }

  progress.phase = "desk-selection";
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByTestId("desk-featured-fixture").first().waitFor({ timeout: 30_000 }).catch(() => null);
  progress.phase = "desk-parity";
  const opener = await collectFeaturedFixture(page, canonical);
  if (opener && featuredFixture) {
    const { home, away } = featuredFixture;
    const openingResult = await clickFeaturedFixture(page, opener, pacer);
    if (traffic.lastFixtureId !== canonical.fixtureId) throw new Error("Desk opener sent a different fixture ID");
    const pinnedAfterOpen = await page.getByText(/^Pinned ·/).first()
      .isVisible()
      .catch(() => false);
    const openingGrounding = await latestBoardIdentity(page, canonical.fixtureId);
    const openingBoard = page.getByTestId("desk-pundit-bubble").last().getByTestId("desk-match-board");
    const [deskFixtureId, deskRatingArtifactId, deskPricedAt] = await Promise.all([
      openingBoard.getAttribute("data-fixture-id"),
      openingBoard.getAttribute("data-rating-artifact-id"),
      openingBoard.getAttribute("data-priced-at"),
    ]);
    const deskSurface = {
      visible: openingGrounding.boardVisible,
      fixtureId: deskFixtureId,
      capability: await openingBoard.getAttribute("data-capability"),
      probabilities: await structuredProbabilities(openingBoard),
      ratingArtifactId: deskRatingArtifactId,
      pricedAt: deskPricedAt,
    };
    progress.collected.desk = deskSurface;
    const parityPassed = Boolean(canonical?.reportMatches)
      && chatMatch
      && [deskSurface, fixtureSurface, modelSurface].every((surface) =>
        surface?.visible
        && surface.fixtureId === canonical.fixtureId
        && surface.capability === canonical.capability
        && tripletsAgree(surface.probabilities, canonical.probabilities)
      )
      && deskSurface.ratingArtifactId === canonical.ratingArtifactId
      && modelSurface.modelVersion === canonical.modelVersion
      && modelSurface.forecastAt === canonical.forecastAt;
    checks["cross-surface-fixture-parity"] = recordViewport(
      checks["cross-surface-fixture-parity"],
      viewport,
      {
        passed: parityPassed,
        evidence: `Canonical ${canonical?.fixtureId ?? "missing"} ${canonical?.modelVersion ?? "unknown-version"} @ ${canonical?.forecastAt ?? "unknown-time"}; Desk=${JSON.stringify(deskSurface)}; Fixtures=${JSON.stringify(fixtureSurface)}; Predictions=${JSON.stringify(modelSurface)}.`,
        reproduction: reproduction.parity,
        extras: {
          surfaces: ["chat", "fixtures", "predictions"],
          parityEvidence: [{
            canonicalFixture: canonical,
            surfaceSnapshots: { chat: deskSurface, fixtures: fixtureSurface, predictions: modelSurface },
          }],
        },
      }
    );
    progress.phase = "fixture-retention";
    const tableResult = await ask(page, TABLE_QUESTION, pacer);
    const pinnedAfterTable = await page.getByText(/^Pinned ·/).first()
      .isVisible()
      .catch(() => false);
    const returnResult = await ask(page, "Back to that match: what will the 1X2 be?", pacer);
    const pinnedAfterReturn = await page.getByText(/^Pinned ·/).first()
      .isVisible()
      .catch(() => false);
    const returnGrounding = await latestBoardIdentity(page, canonical.fixtureId);
    checks["fixture-context-retention"] = recordViewport(
      checks["fixture-context-retention"],
      viewport,
      {
        passed: openingResult.answered && tableResult.answered && returnResult.answered
          && pinnedAfterOpen && pinnedAfterTable && pinnedAfterReturn
          && openingGrounding.boardVisible && openingGrounding.identityMatches
          && returnGrounding.boardVisible && returnGrounding.identityMatches,
        evidence: `Pinned after open=${pinnedAfterOpen}, table=${pinnedAfterTable}, return=${pinnedAfterReturn}; opening board=${openingGrounding.boardVisible}/${openingGrounding.identityMatches}, return board=${returnGrounding.boardVisible}/${returnGrounding.identityMatches}.`,
        reproduction: reproduction.retention,
      }
    );

    await page.getByRole("button", { name: "New Chat" }).click();
    const pinnedAfterReset = await page.getByText(/^Pinned ·/).first().isVisible().catch(() => false);
    const transcriptGone = await page.getByTestId("desk-user-bubble").count() === 0
      && await page.getByTestId("desk-pundit-bubble").count() === 0;
    checks["new-chat-clears-context"] = recordViewport(
      checks["new-chat-clears-context"],
      viewport,
      {
        passed: !pinnedAfterReset && transcriptGone,
        evidence: pinnedAfterReset
          ? "New Chat left pinned fixture context visible."
          : "New Chat removed the retained fixture and visible transcript.",
        reproduction: reproduction.newChat,
      }
    );

    await page.getByTestId("desk-featured-fixture").first().waitFor({ timeout: 30_000 }).catch(() => null);
    progress.phase = "analyst-conversation";
    const analystOpener = await collectFeaturedFixture(page, canonical);
    const analystResults = [];
    if (analystOpener) {
      analystResults.push(await clickFeaturedFixture(page, analystOpener, pacer));
      if (traffic.lastFixtureId !== canonical.fixtureId) throw new Error("Analyst opener sent a different fixture ID");
    }
    for (const followUp of ANALYST_FOLLOW_UPS) {
      analystResults.push(await ask(page, followUp, pacer));
    }
    const turnCount = analystResults.filter(({ answered, error }) => answered || error).length;
    const analystOpeningBubble = page.getByTestId("desk-pundit-bubble").first();
    const analystBoard = analystOpeningBubble.getByTestId("desk-match-board");
    const analystBoardIdentity = await analystBoard.getAttribute("data-fixture-id").catch(() => null) === canonical.fixtureId;
    const oddsRows = await analystBoard.locator('[data-testid="desk-board-markets"] li').count().catch(() => 0);
    const explicitNoMarket = await analystBoard.getByText(/No comparison market|No comparable market price is available/i)
      .isVisible().catch(() => false);
    const marketRowsExpected = reportExpectsMarketRows(report);
    const marketStateValid = marketRowsExpected ? oddsRows > 0 : explicitNoMarket;
    const loadingObserved = analystResults.some((result) => result.loadingObserved);
    checks["analyst-multi-turn-flow"] = recordViewport(
      checks["analyst-multi-turn-flow"],
      viewport,
      {
        passed: turnCount >= 6
          && analystResults.every(({ answered, error }) => answered && !error)
          && await analystBoard.isVisible().catch(() => false)
          && analystBoardIdentity
          && marketStateValid
          && loadingObserved,
        evidence: `Observed ${turnCount} analyst turns; opening board identity=${analystBoardIdentity}; report expects market rows=${marketRowsExpected}; market rows=${oddsRows}; explicit no-market=${explicitNoMarket}; visible writing state=${loadingObserved}.`,
        reproduction: reproduction.analyst,
        extras: {
          turnCount,
          marketEvidence: [{ expectedRows: marketRowsExpected, oddsRows, explicitNoMarket }],
        },
      }
    );
    checks["visible-analyst-loading-state"] = recordViewport(
      checks["visible-analyst-loading-state"],
      viewport,
      {
        passed: loadingObserved,
        evidence: `Visible "Writing the take…" state observed=${loadingObserved} during the realistic analyst flow.`,
        reproduction: reproduction.loading,
      }
    );
  } else {
    const skipped = "No attributed Desk featured fixture was available.";
    for (const id of [
      "fixture-context-retention",
      "new-chat-clears-context",
      "analyst-multi-turn-flow",
      "visible-analyst-loading-state",
    ]) {
      checks[id] = recordViewport(checks[id], viewport, {
        passed: false,
        evidence: skipped,
        reproduction: id === "visible-analyst-loading-state"
          ? reproduction.loading
          : id === "analyst-multi-turn-flow"
            ? reproduction.analyst
          : id === "new-chat-clears-context"
            ? reproduction.newChat
            : reproduction.retention,
        extras: id === "analyst-multi-turn-flow" ? { turnCount: 0 } : {},
      });
    }
    checks["cross-surface-fixture-parity"] = recordViewport(
      checks["cross-surface-fixture-parity"],
      viewport,
      {
        passed: false,
        evidence: "No attributed Desk featured fixture was available to compare across surfaces.",
        reproduction: reproduction.parity,
        extras: { surfaces: ["chat", "fixtures", "predictions"], parityEvidence: [] },
      }
    );
  }

  progress.phase = "desk-selection";
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Ask a question" }).waitFor({ timeout: 30_000 });
  const newChat = page.getByRole("button", { name: "New Chat" });
  if (await newChat.isEnabled().catch(() => false)) await newChat.click();
  const candidateResult = await ask(page, CANDIDATE_QUESTION, pacer);
  const candidateBubble = page.getByTestId("desk-pundit-bubble").last();
  const fixtureBoard = await candidateBubble.getByTestId("desk-match-board").isVisible().catch(() => false);
  const unpricedNotice = await candidateBubble.getByTestId("desk-unpriced-notice").isVisible().catch(() => false);
  const pinnedCandidate = await page.getByText(/^Pinned ·/).first().isVisible().catch(() => false);
  checks["candidate-no-fixture-badge"] = recordViewport(
    checks["candidate-no-fixture-badge"],
    viewport,
    {
      passed: candidateResult.answered && !candidateResult.error
        && !fixtureBoard && !unpricedNotice && !pinnedCandidate,
      evidence: `Candidate answered=${candidateResult.answered}; match board=${fixtureBoard}; unpriced notice=${unpricedNotice}; pinned context=${pinnedCandidate}.`,
      reproduction: reproduction.candidate,
    }
  );

  const askRequestsBeforeOversized = traffic.apiAskRequestCount;
  const pacedStartsBeforeOversized = pacer.starts.length;
  const oversizedInput = page.getByRole("textbox", { name: "Ask a question" });
  const oversizedInputLength = await oversizedInput.evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return element.value.length;
  }, OVERSIZED_QUESTION);
  const oversizedError = page.getByRole("alert")
    .filter({ hasText: "Questions must be 500 characters or fewer." });
  await oversizedError.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
  await page.waitForTimeout(100);
  const oversizedErrorVisible = await oversizedError.isVisible().catch(() => false);
  const oversizedPassed = oversizedPromptCheckPasses({
    inputLength: oversizedInputLength,
    errorVisible: oversizedErrorVisible,
    askRequestsBefore: askRequestsBeforeOversized,
    askRequestsAfter: traffic.apiAskRequestCount,
    pacedStartsBefore: pacedStartsBeforeOversized,
    pacedStartsAfter: pacer.starts.length,
  });
  checks["oversized-prompt-client-error"] = recordViewport(
    checks["oversized-prompt-client-error"],
    viewport,
    {
      passed: oversizedPassed,
      evidence: `Input length=${oversizedInputLength}; error visible=${oversizedErrorVisible}; /api/ask count ${askRequestsBeforeOversized}->${traffic.apiAskRequestCount}; paced starts ${pacedStartsBeforeOversized}->${pacer.starts.length}.`,
      reproduction: reproduction.oversized,
    }
  );

  const overflow = await hasHorizontalOverflow(page);
  checks["responsive-no-horizontal-overflow"] = recordViewport(
    checks["responsive-no-horizontal-overflow"],
    viewport,
    {
      passed: !overflow,
      evidence: `document width overflow=${overflow}.`,
      reproduction: ["Open the Desk", "Complete the adversarial chat flow", "Compare scrollWidth with clientWidth"],
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
      ...(check.parityEvidence
        ? { parityEvidence: [...(existing.parityEvidence ?? []), ...check.parityEvidence] }
        : {}),
      ...(check.marketEvidence
        ? { marketEvidence: [...(existing.marketEvidence ?? []), ...check.marketEvidence] }
        : {}),
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

function buildEvidence({
  identity,
  url,
  viewport,
  viewports,
  console: consoleEvidence,
  checks,
  pacing = null,
  webVersion = null,
  apiVersion = null,
}) {
  const passed = checks.every((check) => check.passed)
    && consoleEvidence.errors.length === 0
    && pacing?.passed !== false
    && webVersion?.passed !== false
    && apiVersion?.passed !== false;
  const failedMeta = [
    ...(consoleEvidence.errors.length > 0 ? ["console-errors"] : []),
    ...(pacing?.passed === false ? ["request-pacing"] : []),
    ...(webVersion?.passed === false ? ["web-version"] : []),
    ...(apiVersion?.passed === false ? ["api-version"] : []),
  ];
  const checkSummary = summarizeChecks(checks);
  return {
    ...identity,
    capturedAt: new Date().toISOString(),
    url: `${url}/`,
    viewport,
    viewports,
    console: consoleEvidence,
    passed,
    summary: failedMeta.length === 0
      ? checkSummary
      : `${checkSummary} Evidence gates failed: ${failedMeta.join(", ")}.`,
    checks,
    ...(pacing ? { pacing } : {}),
    ...(webVersion ? { webVersion } : {}),
    ...(apiVersion ? { apiVersion } : {}),
  };
}

async function captureLive(options, report, dependencies = {}) {
  const captureWeb = dependencies.captureWebVersion ?? captureWebVersion;
  const captureApi = dependencies.captureApiVersion ?? captureApiVersion;
  const captureCanonical = dependencies.canonicalFixtureSnapshot ?? canonicalFixtureSnapshot;
  const playwright = dependencies.loadPlaywright ?? loadPlaywright;
  const runChecks = dependencies.runViewportChecks ?? runViewportChecks;
  if (options.intervalMs < MIN_BROWSER_REQUEST_INTERVAL_MS) {
    throw new Error(`Browser capture request spacing must be at least ${MIN_BROWSER_REQUEST_INTERVAL_MS} ms.`);
  }
  const identity = identityFromReport(report);
  const finalApiStart = finalApiRequestStart(report);
  const cooldownAnchor = apiCooldownAnchor(report, finalApiStart);
  const progress = { phase: "preflight", checks: {}, collected: {} };
  const consoleEvidence = { errors: [], warnings: [] };
  let checks = [];
  try {
    const webVersionBefore = await captureWeb(options.webUrl);
    progress.collected.webVersionBefore = webVersionBefore;
    const apiVersionBefore = await captureApi(report.apiUrl);
    progress.collected.apiVersionBefore = apiVersionBefore;
    const canonical = await captureCanonical(report);
    progress.collected.canonical = canonical;
    if (!canonical?.reportMatches) throw new Error("Canonical report fixture is unavailable or has changed");
    progress.phase = "browser-launch";
    const { chromium } = playwright();
    const browser = await chromium.launch();
    const viewports = [MOBILE_VIEWPORT, DESKTOP_VIEWPORT];
    const traffic = { apiAskRequestCount: 0 };
    progress.collected.traffic = traffic;
    const pacer = createRequestStartPacer({
      intervalMs: options.intervalMs,
      firstRequestNotBeforeEpochMs: cooldownAnchor.epochMs + BROWSER_COOLDOWN_MS,
    });
    progress.collected.requestStarts = pacer.wallStarts;
    progress.collected.monotonicStarts = pacer.starts;
    try {
      for (const viewport of viewports) {
        progress.phase = `viewport-${viewport.width}x${viewport.height}`;
        progress.checks = {};
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        attachConsole(page, consoleEvidence);
        const observed = await runChecks(
          page,
          options.webUrl,
          viewport,
          pacer,
          report,
          canonical,
          traffic,
          progress
        );
        checks = checks.length === 0 ? observed : mergeChecks(checks, observed);
        await context.close();
      }
    } finally {
      await browser.close();
    }
    progress.phase = "postflight";
    progress.checks = {};
    const webVersionAfter = await captureWeb(options.webUrl);
    const apiVersionAfter = await captureApi(report.apiUrl);
    const requestStartOffsetsMs = pacer.starts.map((start) => start - pacer.starts[0]);
    const observedGapsMs = pacer.starts.slice(1).map((start, index) => start - pacer.starts[index]);
    const firstBrowserRequestStart = pacer.wallStarts[0] ?? null;
    const cooldownObservedMs = firstBrowserRequestStart
      ? Date.parse(firstBrowserRequestStart) - cooldownAnchor.epochMs
      : null;
    const pacing = {
      minimumIntervalMs: pacer.intervalMs,
      requestStarts: pacer.wallStarts,
      requestStartOffsetsMs,
      observedGapsMs,
      requestStartCount: pacer.starts.length,
      apiAskRequestCount: traffic.apiAskRequestCount,
      finalApiRequestStart: finalApiStart.value,
      harnessCompletedAt: report.completedAt ?? null,
      cooldownAnchor: cooldownAnchor.value,
      firstBrowserRequestStart,
      cooldownMinimumMs: BROWSER_COOLDOWN_MS,
      cooldownObservedMs,
      passed: pacer.starts.length > 0
        && traffic.apiAskRequestCount === pacer.starts.length
        && observedGapsMs.length === Math.max(0, pacer.starts.length - 1)
        && observedGapsMs.every((gap) => gap >= MIN_BROWSER_REQUEST_INTERVAL_MS)
        && Number.isFinite(cooldownObservedMs)
        && cooldownObservedMs >= BROWSER_COOLDOWN_MS,
    };
    const gradedWeb = report.deployment?.shaGrading?.web ?? {};
    const webVersion = {
      expectedServedSha: gradedWeb.servedSha ?? null,
      floorSha: gradedWeb.floorSha ?? null,
      gradedState: gradedWeb.state ?? null,
      before: webVersionBefore,
      after: webVersionAfter,
      passed: Boolean(gradedWeb.servedSha)
        && webVersionBefore.sha === gradedWeb.servedSha
        && webVersionAfter.sha === gradedWeb.servedSha,
    };
    const expectedApiSha = report.deployment?.apiSha
      ?? report.deployment?.shaGrading?.api?.servedSha
      ?? null;
    const apiVersion = {
      expectedSha: expectedApiSha,
      expectedDeploymentId: report.deployment?.id ?? null,
      before: apiVersionBefore,
      after: apiVersionAfter,
      passed: Boolean(expectedApiSha && report.deployment?.id)
        && apiVersionBefore.sha === expectedApiSha
        && apiVersionAfter.sha === expectedApiSha
        && apiVersionBefore.deploymentId === report.deployment.id
        && apiVersionAfter.deploymentId === report.deployment.id,
    };
    return buildEvidence({
      identity,
      url: options.webUrl,
      viewport: MOBILE_VIEWPORT,
      viewports,
      console: consoleEvidence,
      checks,
      pacing,
      webVersion,
      apiVersion,
    });
  } catch (error) {
    const partialChecks = mergeChecks(checks, Object.values(progress.checks));
    error.browserEvidence = {
      ...buildEvidence({ identity, url: options.webUrl, viewport: MOBILE_VIEWPORT,
        viewports: [MOBILE_VIEWPORT, DESKTOP_VIEWPORT], console: consoleEvidence,
        checks: mergeChecks(requiredCheckIds().filter((id) => !partialChecks.some((check) => check.id === id)).map(emptyCheck), partialChecks),
      }),
      passed: false,
      failure: { phase: progress.phase, message: error.message },
      collected: progress.collected,
      summary: `Browser capture failed during ${progress.phase}: ${error.message}`,
    };
    throw error;
  }
}

async function captureAndPersist(options, report, capture = captureLive) {
  let evidence;
  try {
    evidence = await capture(options, report);
    return evidence;
  } catch (error) {
    evidence = error.browserEvidence ?? {
      ...buildEvidence({ identity: identityFromReport(report), url: options.webUrl,
        viewport: MOBILE_VIEWPORT, viewports: [MOBILE_VIEWPORT, DESKTOP_VIEWPORT],
        console: { errors: [], warnings: [] }, checks: requiredCheckIds().map(emptyCheck) }),
      passed: false, failure: { phase: "initialization", message: error.message },
    };
    throw error;
  } finally {
    if (evidence) {
      const outputPath = options.output ?? browserOutputPath(options.outputDir, evidence.runId);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    }
  }
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
      apiToBrowserCooldownMs: BROWSER_COOLDOWN_MS,
      webVersionPath: "/api/version",
      apiVersionPath: "/version",
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
  const evidence = await captureAndPersist(options, report);
  const outputPath = options.output ?? browserOutputPath(options.outputDir, evidence.runId);
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
  captureAndPersist,
  captureLive,
  collectFeaturedFixture,
  fixtureLocator,
  structuredProbabilities,
  ANALYST_FOLLOW_UPS,
  BROWSER_PACING_SAFETY_MS,
  BROWSER_COOLDOWN_MS,
  CANDIDATE_QUESTION,
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
  reportExpectsMarketRows,
  tripletsAgree,
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
