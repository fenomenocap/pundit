import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyServedSha, isAcceptableServedSha, resolveDeployedSha } from "./resolve-deployed-sha.mjs";

const require = createRequire(import.meta.url);

const REPO_ROOT = () => path.resolve(import.meta.dirname, "..");

export const DEPLOY_TARGETS = ["api", "web"];

/**
 * Grade what production serves against the commit each target was *required*
 * to reach, using the one shared rule in deploy-build-paths.mjs.
 *
 * This check used to demand `source === api === web`. That is wrong for this
 * repo: vercel-ignore-build.mjs deliberately skips a web rebuild for a commit
 * that touches only API paths, so a perfectly healthy frontend legitimately
 * serves an older SHA than main. Every API-only push turned the certification
 * gate red for no reason -- the identical false alarm already fixed in
 * scripts/verify-prod.sh, which grades against a floor via this same module.
 *
 * The floor is resolved *as of the source commit*, so the run grades the
 * deployment it actually tested rather than whatever has landed on main since.
 */
function resolveFloorSha(target, ref, cwd) {
  try {
    return resolveDeployedSha(target, { ref, cwd });
  } catch {
    // No usable git history (a clone without the commit, or no repo at all).
    // That makes the requirement unknowable, not violated.
    return null;
  }
}

export function gradeDeploymentShas({ sourceSha = null, apiSha = null, webSha = null, cwd = REPO_ROOT() } = {}) {
  const served = { api: apiSha, web: webSha };
  const targets = {};
  for (const target of DEPLOY_TARGETS) {
    const servedSha = served[target] ?? null;
    const floorSha = sourceSha ? resolveFloorSha(target, sourceSha, cwd) : null;
    targets[target] = {
      floorSha,
      servedSha,
      // Without a floor there is nothing to grade against; a target that
      // reported no SHA at all is still a fault regardless.
      state: floorSha ? classifyServedSha(floorSha, servedSha, { cwd })
        : servedSha ? "unknown"
        : "missing",
    };
  }
  const states = DEPLOY_TARGETS.map((target) => targets[target].state);
  const shaConverged = states.every((state) => isAcceptableServedSha(state)) ? true
    // A stale target never reached the commit it had to; a missing one never
    // said which commit it is. Both are real deployment faults.
    : states.some((state) => state === "stale" || state === "missing") ? false
    // Anything left is a commit this clone has never seen: report it rather
    // than convict the deployment on evidence the checkout does not have.
    : null;
  return { targets, shaConverged };
}

export function describeDeploymentShas(deployment) {
  return DEPLOY_TARGETS
    .map((target) => {
      const graded = deployment?.shaGrading?.[target];
      if (!graded) return `${target}=${deployment?.[`${target}Sha`] ?? "unknown"}`;
      return `${target}=${graded.servedSha ?? "unknown"} (${graded.state} vs floor ${graded.floorSha ?? "unresolved"})`;
    })
    .join(", ");
}

export function loadApiRuntimeCorrectnessHelpers(repoRoot = path.resolve(import.meta.dirname, "..")) {
  const previousProject = process.env.TS_NODE_PROJECT;
  try {
    process.env.TS_NODE_PROJECT = path.join(repoRoot, "packages/api/tsconfig.json");
    require(path.join(repoRoot, "packages/api/node_modules/ts-node/register/transpile-only"));
    return require(path.join(repoRoot, "packages/api/src/services/response-correctness.ts"));
  } catch (error) {
    throw new Error("runtime-helper scenarios require installed API development dependencies", { cause: error });
  } finally {
    if (previousProject === undefined) delete process.env.TS_NODE_PROJECT;
    else process.env.TS_NODE_PROJECT = previousProject;
  }
}

export function loadApiRuntimeFixtureHelpers(repoRoot = path.resolve(import.meta.dirname, "..")) {
  const previousProject = process.env.TS_NODE_PROJECT;
  try {
    process.env.TS_NODE_PROJECT = path.join(repoRoot, "packages/api/tsconfig.json");
    require(path.join(repoRoot, "packages/api/node_modules/ts-node/register/transpile-only"));
    return require(path.join(repoRoot, "packages/api/src/services/fixture-registry.ts"));
  } catch (error) {
    throw new Error("fixture runtime-helper scenarios require installed API development dependencies", { cause: error });
  } finally {
    if (previousProject === undefined) delete process.env.TS_NODE_PROJECT;
    else process.env.TS_NODE_PROJECT = previousProject;
  }
}

export function loadApiRuntimeRoutingHelpers(repoRoot = path.resolve(import.meta.dirname, "..")) {
  const previousProject = process.env.TS_NODE_PROJECT;
  try {
    process.env.TS_NODE_PROJECT = path.join(repoRoot, "packages/api/tsconfig.json");
    require(path.join(repoRoot, "packages/api/node_modules/ts-node/register/transpile-only"));
    return require(path.join(repoRoot, "packages/api/src/services/ask.ts"));
  } catch (error) {
    throw new Error("routing runtime-helper scenarios require installed API development dependencies", { cause: error });
  } finally {
    if (previousProject === undefined) delete process.env.TS_NODE_PROJECT;
    else process.env.TS_NODE_PROJECT = previousProject;
  }
}

export const EVAL_SCHEMA_VERSION = 14;
export const MIN_REQUEST_INTERVAL_MS = 13_000;
export const PACING_SAFETY_MARGIN_MS = 25;

export function executeRuntimeHelperScenario(scenario, repoRoot = path.resolve(import.meta.dirname, "..")) {
  const correctnessHelpers = loadApiRuntimeCorrectnessHelpers(repoRoot);
  if (scenario.helper === "resolveFixtureRoutingSequence") {
    const routingHelpers = loadApiRuntimeRoutingHelpers(repoRoot);
    return scenario.args.steps.map((step) => {
      const resolved = routingHelpers.resolveAskContext(
        step.question,
        step.history ?? [],
        step.teamContext,
        scenario.args.modelFixtures ?? [],
        scenario.args.standings ?? [],
        scenario.args.activeFixtures ?? [],
        {
          recognizedFixtures: scenario.args.recognizedFixtures ?? [],
          fixtureContext: step.fixtureContext,
          ...(scenario.args.routingState ?? {}),
        }
      );
      return {
        tier: resolved.tier,
        fixtureId: resolved.tier === "fixture"
          ? resolved.fixture.fixtureId
          : resolved.tier === "match"
            ? `${resolved.fixture.competitionId}:${resolved.fixture.fixtureId}`
            : null,
        capability: resolved.tier === "fixture" ? resolved.capability : null,
      };
    });
  }
  if (scenario.helper === "evaluateFixtureCapability") {
    const fixtureHelpers = loadApiRuntimeFixtureHelpers(repoRoot);
    return fixtureHelpers.evaluateFixtureCapability(scenario.args[0], scenario.args[1]);
  }
  if (scenario.helper === "sanitizeFinalMatchAnswer") {
    // The settled match-tier guard chain, in the order a delivered answer sees
    // it. Runs the built module, so a guard that eats the model's own numbers
    // fails here instead of only in production.
    //
    // This used to run `dropOrphanedSectionLabels(sanitizeMatchAnswer(...))`
    // while claiming to be the whole chain. That skipped the six MiniMax-shape
    // guards that run ahead of the tier guard and the entire post-tier stage,
    // which is how four answer-deleting bugs shipped past a harness that was
    // pointed at them. `sanitizeDeliveredAnswer` is the production tail itself,
    // so there is no second copy left to drift.
    const routingHelpers = loadApiRuntimeRoutingHelpers(repoRoot);
    const grounding = scenario.args[1]
      ? { kind: "match", ...scenario.args[1] }
      : undefined;
    return routingHelpers.sanitizeDeliveredAnswer(scenario.args[0], "match", grounding);
  }
  if (scenario.helper === "deliverMatchAnswerOffline") {
    // The delivery tail as far as it runs without a network round trip: the
    // settled guard chain, then the citation renderer. The verifier is the only
    // step left out, because it calls the model. This exists so a citation
    // marker that never becomes a link -- the `[[1]]` a user was actually served
    // -- is measured against the function that owns it rather than against the
    // guard chain, which cannot see markers at all.
    const routingHelpers = loadApiRuntimeRoutingHelpers(repoRoot);
    const [answer, groundingArgs, bundle, evidenceRequired] = scenario.args;
    const grounding = groundingArgs ? { kind: "match", ...groundingArgs } : undefined;
    const settled = routingHelpers.sanitizeDeliveredAnswer(answer, "match", grounding);
    return routingHelpers.renderEvidenceCitations(
      settled,
      bundle ?? { queries: [], results: [], providerCalls: 0 },
      Boolean(evidenceRequired)
    ).answer;
  }
  if (scenario.helper === "validateCompleteOneXTwoMarket") {
    return correctnessHelpers.validateCompleteOneXTwoMarket(scenario.args[0]);
  }
  if (scenario.helper === "probabilityAttribution") {
    const label = correctnessHelpers.probabilityAttributionLabel(scenario.args[0]);
    return { label, valid: correctnessHelpers.hasValidProbabilityAttribution(label, scenario.args[0]) };
  }
  if (scenario.helper === "attributeManagerEra") return correctnessHelpers.attributeManagerEra(...scenario.args);
  if (scenario.helper === "containsCorrectionCue") return correctnessHelpers.containsCorrectionCue(scenario.args[0]);
  if (scenario.helper === "settleScorelineTotal") return correctnessHelpers.settleScorelineTotal(...scenario.args);
  if (scenario.helper === "applyClaimDecisions") return correctnessHelpers.applyClaimDecisions(...scenario.args);
  throw new Error(`Unknown runtime correctness helper: ${scenario.helper}`);
}

/** Capture request evidence by value so later conversation turns cannot mutate it. */
export function snapshotAskRequest({ question, history, teamContext, fixtureContext }) {
  return {
    question,
    history: Array.isArray(history) ? history.map((turn) => ({ ...turn })) : history,
    teamContext: Array.isArray(teamContext) ? [...teamContext] : teamContext,
    fixtureContext: fixtureContext && typeof fixtureContext === "object"
      ? { ...fixtureContext }
      : fixtureContext,
  };
}

export function snapshotSseReproduction(question) {
  const body = snapshotAskRequest({
    question,
    history: [],
    teamContext: undefined,
    fixtureContext: undefined,
  });
  body.stream = true;
  return { method: "POST", path: "/api/ask", body };
}

export function recordOptionalScenarioFailure(report, failedResult) {
  const activeRequest = report.progress?.activeRequest ?? null;
  const failed = {
    ...failedResult,
    outcome: "INCONCLUSIVE",
    requiredForCertification: false,
    observationalInconclusiveSafe: true,
    reproduction: activeRequest?.reproduction
      ? { requests: [activeRequest.reproduction] }
      : failedResult.reproduction,
    evidence: `${failedResult.evidence} Observational scenario; certification continued without retry.`,
  };
  report.scenarios.push(failed);
  report.progress.completedScenarioIds.push(failed.id);
  report.progress.activeScenario = null;
  report.progress.activeRequest = null;
  report.completedAt = new Date().toISOString();
  return failed;
}

export async function fetchWithTimeout(
  url,
  init,
  timeoutMs,
  fetchImpl = globalThis.fetch
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(`request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isKnownTeam(team) {
  return typeof team === "string"
    && team.trim().toLowerCase() !== "tbd"
    && !/\b(?:winner|loser)\b/i.test(team);
}

export function selectFeaturedMatch(matches = []) {
  return matches.find((match) =>
    isKnownTeam(match.home)
    && isKnownTeam(match.away)
  ) ?? null;
}

function clubPairKey(match) {
  return [match?.home, match?.away]
    .map((team) => String(team ?? "").trim().toLowerCase())
    .sort()
    .join("|");
}

/**
 * The earliest active fixture whose two clubs meet twice -- a two-legged tie.
 *
 * This is the shape the evaluator could not see before: every fixture-backed
 * scenario supplies `fixtureContext`, so none of them ever asked a bare
 * "X vs Y" of a pair that forms two fixtures, which is exactly the question
 * that used to fail. Roughly a quarter of the live active pairs are two-legged
 * and the date-sorted qualifiers lead the list, so this normally resolves.
 */
export function selectTwoLeggedTie(matches = []) {
  const byPair = new Map();
  for (const match of matches) {
    if (!isKnownTeam(match?.home) || !isKnownTeam(match?.away)) continue;
    const key = clubPairKey(match);
    byPair.set(key, [...(byPair.get(key) ?? []), match]);
  }
  const ties = [...byPair.values()]
    .filter((legs) => legs.length > 1)
    .map((legs) => [...legs].sort((a, b) => String(a.utcDate).localeCompare(String(b.utcDate))))
    .sort((a, b) => String(a[0].utcDate).localeCompare(String(b[0].utcDate)));
  return ties[0] ?? null;
}

function competitionAbbr(competitionId, competition) {
  if (competitionId === "eng.1") return "PL";
  if (String(competitionId).includes("champions")) return "UCL";
  return String(competition).split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

/**
 * The homepage's suggestion chips, reproduced from the same source the page
 * uses: the first `limit` fixtures of `/api/model/active`, labelled the same
 * way, each carrying the identity of the fixture it was rendered from.
 */
export function selectSuggestionChips(matches = [], limit = 3) {
  return matches.slice(0, limit)
    .filter((match) => isKnownTeam(match?.home) && isKnownTeam(match?.away))
    .map((match) => ({
      fixture: match,
      fixtureId: `espn:${match.competitionId}:${match.fixtureId}`,
      text: `${match.home} vs ${match.away} · ${competitionAbbr(match.competitionId, match.competition)}`
        + ` · ${new Date(match.utcDate).toLocaleDateString("en-US", { weekday: "short" })}`,
    }));
}

export function parseSse(text) {
  const events = [];
  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    if (!block.trim() || block.trimStart().startsWith(":")) continue;
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    const raw = data.join("\n");
    let payload = raw;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Preserve invalid payloads so the assertion can report useful evidence.
    }
    events.push({ event, payload });
  }
  return events;
}

/**
 * Read a streaming response until its grounding event is complete, then abort
 * the client and prove that the next body read observes AbortError. Merely
 * aborting fetch before response headers arrive does not exercise disconnect
 * handling on an SSE route; nor does resolving fetch at the headers prove the
 * body stopped. This helper measures the actual post-grounding body read.
 */
export async function abortSseAfterGrounding(
  response,
  controller,
  { timeoutMs = 5_000, now = Date.now } = {}
) {
  if (!response?.body?.getReader) throw new Error("SSE response has no readable body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const startedAt = now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("SSE completed before grounding could be cancelled");
    buffered += decoder.decode(value, { stream: true });
    const normalized = buffered.replace(/\r\n/g, "\n");
    const completedBoundary = normalized.lastIndexOf("\n\n");
    if (completedBoundary < 0) continue;
    const completedEvents = normalized.slice(0, completedBoundary + 2);
    if (!parseSse(completedEvents).some(({ event }) => event === "grounding")) continue;
    controller.abort();
    const abortStartedAt = now();
    let timeout;
    try {
      await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`abort was not observed within ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]);
      throw new Error("SSE body read completed after client abort");
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
      return {
        groundingObserved: true,
        abortErrorObserved: true,
        abortLatencyMs: now() - abortStartedAt,
        totalLatencyMs: now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function finiteProbability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function statedPercentageTolerance(percentageText) {
  const decimals = String(percentageText).split(".")[1]?.length ?? 0;
  return 0.5 / 10 ** decimals + Number.EPSILON;
}

const MODEL_PROBABILITY_FIELDS = [
  "pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo",
  "topScores", "scorelines",
];

const FIXTURE_CAPABILITIES = {
  "temporarily-unpriced": new Set(["model-initializing", "ratings-refreshing"]),
  "outside-coverage": new Set([
    "unsupported-competition", "friendly-policy-disabled", "model-policy-disabled",
  ]),
  "insufficient-model-input": new Set([
    "ratings-unavailable", "neutral-venue-unknown", "required-context-missing",
  ]),
};
const FIXTURE_SOURCES = new Set(["espn", "official-competition", "official-federation", "official-club"]);
const FIXTURE_CATEGORIES = new Set([
  "domestic-league", "domestic-cup", "club-continental", "club-friendly",
  "international-tournament", "international-qualifier", "international-friendly",
]);

function validIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * Narrow discovered recognized identities to the ones `/api/ask` will actually
 * route to on this deployment.
 *
 * `/api/fixtures/recognized` publishes every approved identity the registry has
 * *observed*, which is not the same set the chat tier *routes*. With
 * FIXTURE_REGISTRY_ENABLED unset -- the production default, reported as
 * `registry.mode: "shadow"` -- ask.ts deliberately routes against the
 * authoritative ESPN fixtures of the enabled competition windows instead of the
 * registry. An observed identity outside those windows (a club friendly, say)
 * is therefore correctly unrecognized by chat, and asking it for fixture
 * grounding can only ever produce an abstention.
 *
 * Selecting such an entry and then asserting the routed contract is not a
 * product failure, it is a scenario that the deployment's configuration cannot
 * exercise -- the same situation the other observational scenarios already
 * report as INCONCLUSIVE.
 */
export function routableRecognizedEntries(entries, { registryEnabled = false, enabledCompetitionIds = [] } = {}) {
  // A completed fixture is outside the active window for the same reason a
  // friendly is outside the routed competitions: chat routes against the
  // forward-looking active ESPN set, so asking about a match already played can
  // only ever produce an abstention. Verified live -- a recognized, routed,
  // completed fixture returns grounding: null and the discovery-candidate
  // notice, never fixture-tier grounding. This narrowing applies whether or not
  // the registry is enabled, since the active window bounds both modes.
  const current = (entries ?? []).filter((entry) => entry?.fixture?.status !== "completed");
  // Expanded routing serves the registry itself, so every approved identity in
  // the active window is routable and nothing further needs narrowing.
  if (registryEnabled) return current;
  const enabled = new Set(enabledCompetitionIds);
  return current.filter((entry) => enabled.has(entry?.fixture?.competition?.id));
}

/** Competitions whose ESPN windows the deployment is actually refreshing. */
export function enabledCompetitionIds(readiness) {
  return Object.keys(readiness?.activeFixtures?.byCompetition ?? {});
}

export function describeRecognizedRoutability({ registryEnabled, enabledCompetitionIds: ids = [], observed = 0, routable = 0 }) {
  return registryEnabled
    ? `registry routing enabled; ${routable} of ${observed} observed identities routable`
    : `registry in shadow mode, so chat routes only ${ids.join(", ") || "no"} competition windows; `
      + `${routable} of ${observed} observed identities routable`;
}

/** Validate the non-priced fixture contract without accepting model-shaped data. */
export function validateFixtureGrounding(grounding, expectation = {}) {
  const fixture = grounding?.fixture;
  const capability = grounding?.capability;
  const validCapability = capability?.status === "priced"
    ? typeof capability.modelFixtureId === "string" && capability.modelFixtureId.length > 0
    : capability
      && Object.hasOwn(FIXTURE_CAPABILITIES, capability.status)
      && FIXTURE_CAPABILITIES[capability.status].has(capability.reason);
  const assertions = {
    fixtureShape: grounding?.kind === "fixture"
      && typeof fixture?.fixtureId === "string"
      && fixture.fixtureId.length > 0
      && FIXTURE_SOURCES.has(fixture?.primarySource)
      && typeof fixture?.primarySourceFixtureId === "string"
      && typeof fixture?.homeTeam?.id === "string"
      && typeof fixture?.homeTeam?.name === "string"
      && typeof fixture?.awayTeam?.id === "string"
      && typeof fixture?.awayTeam?.name === "string"
      && validIsoDate(fixture?.kickoff)
      && [true, false, null].includes(fixture?.neutralVenue)
      && typeof fixture?.competition?.id === "string"
      && typeof fixture?.competition?.name === "string"
      && FIXTURE_CATEGORIES.has(fixture?.competition?.category)
      && ["scheduled", "in-play", "completed", "postponed", "cancelled"].includes(fixture?.status)
      && ["authoritative", "corroborated"].includes(fixture?.recognition)
      && Array.isArray(fixture?.observedSources)
      && fixture.observedSources.length > 0
      && fixture.observedSources.every((source) => FIXTURE_SOURCES.has(source?.source)
        && typeof source?.sourceFixtureId === "string"
        && ["authoritative", "corroborating"].includes(source?.authority)
        && validIsoDate(source?.observedAt))
      && Array.isArray(fixture?.observationHistory)
      && fixture.observationHistory.every((item) => FIXTURE_SOURCES.has(item?.source)
        && typeof item?.sourceFixtureId === "string"
        && validIsoDate(item?.observedAt)
        && validIsoDate(item?.kickoff)
        && [true, false, null].includes(item?.neutralVenue)
        && ["scheduled", "in-play", "completed", "postponed", "cancelled"].includes(item?.status)),
    capabilityShape: Boolean(validCapability),
    exactFixture: !expectation.expectFixtureId || fixture?.fixtureId === expectation.expectFixtureId,
    exactTeams: !expectation.expectTeams || new Set([
      fixture?.homeTeam?.name, fixture?.awayTeam?.name,
    ]).size === 2 && expectation.expectTeams.every((team) =>
      team === fixture?.homeTeam?.name || team === fixture?.awayTeam?.name
    ),
    exactCapability: !expectation.expectCapability
      || capability?.status === expectation.expectCapability.status
        && (!expectation.expectCapability.reason
          || capability?.reason === expectation.expectCapability.reason),
    exactCompetitionCategory: !expectation.expectCompetitionCategory
      || fixture?.competition?.category === expectation.expectCompetitionCategory,
    exactNeutralVenue: !Object.hasOwn(expectation, "expectNeutralVenue")
      || fixture?.neutralVenue === expectation.expectNeutralVenue,
    noModelProbabilities: MODEL_PROBABILITY_FIELDS.every((field) => !Object.hasOwn(grounding ?? {}, field)),
  };
  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => `fixture grounding failed ${name}`);
  return { passed: failures.length === 0, assertions, failures };
}

/** Independently certify complete same-source/time decimal-odds arithmetic. */
export function validateOneXTwoMarket(legs) {
  const outcomes = ["home", "draw", "away"];
  if (!Array.isArray(legs) || legs.length !== outcomes.length) {
    return { passed: false, reason: "missing-or-duplicate-leg" };
  }
  const byOutcome = new Map(legs.map((leg) => [leg?.outcome, leg]));
  if (byOutcome.size !== outcomes.length || outcomes.some((outcome) => !byOutcome.has(outcome))) {
    return { passed: false, reason: "missing-or-duplicate-leg" };
  }
  const sources = new Set(legs.map((leg) => leg?.source).filter(Boolean));
  if (sources.size !== 1) return { passed: false, reason: "mixed-source" };
  const observedTimes = new Set(legs.map((leg) => leg?.observedAt).filter(validIsoDate));
  if (observedTimes.size !== 1) return { passed: false, reason: "mixed-observation-time" };
  const implied = Object.fromEntries(outcomes.map((outcome) => {
    const odds = byOutcome.get(outcome)?.decimalOdds;
    return [outcome, Number.isFinite(odds) && odds > 1 ? 1 / odds : null];
  }));
  if (Object.values(implied).some((value) => value === null)) {
    return { passed: false, reason: "invalid-odds" };
  }
  const overround = Object.values(implied).reduce((sum, value) => sum + value, 0);
  const noVig = Object.fromEntries(outcomes.map((outcome) => [outcome, implied[outcome] / overround]));
  const noVigTotal = Object.values(noVig).reduce((sum, value) => sum + value, 0);
  if (Math.abs(noVigTotal - 1) > 0.002 + Number.EPSILON) {
    return { passed: false, reason: "invalid-no-vig-total" };
  }
  return {
    passed: true,
    market: {
      source: [...sources][0],
      observedAt: [...observedTimes][0],
      impliedProbabilities: implied,
      noVigProbabilities: noVig,
      overround,
    },
  };
}

export function validateResponseCorrectness(answer, citations, grounding, expectation = {}) {
  const text = typeof answer === "string" ? answer : "";
  const citationList = Array.isArray(citations) ? citations : [];
  const punditProbabilityClaim = /\bpundit(?:'s)?\b[^.!?\n]{0,80}\b(?:\d{1,3}(?:\.\d+)?%|(?:probabilit|forecast|prediction)[^.!?\n]{0,30}\d)/i;
  const scoreline = /(?<![\d-])\d{1,2}\s*[-:–—]\s*\d{1,2}(?![\d-])/;
  const assertions = {};
  if (expectation.expectNoPunditProbabilities) {
    assertions.noPunditProbabilities = !punditProbabilityClaim.test(text)
      && MODEL_PROBABILITY_FIELDS.every((field) => !Object.hasOwn(grounding ?? {}, field));
  }
  if (expectation.expectNoScorelines) assertions.noInventedScoreline = !scoreline.test(text);
  if (expectation.expectThirdPartyLabel) {
    assertions.thirdPartyLabel = /\b(?:bookmaker|market|third[- ]party)\b/i.test(text)
      && /\bnot\s+(?:a\s+)?pundit(?:'s)?\b/i.test(text);
  }
  if (expectation.expectOneOneNotOver25) {
    assertions.scorelineTotalCorrect = !/\b1\s*[-:–—]\s*1\b[^.!?\n]*\bover\s*2\.5\b/i.test(text)
      && !/\bover\s*2\.5\b[^.!?\n]*\b1\s*[-:–—]\s*1\b/i.test(text);
  }
  if (expectation.expectModelEvidenceOnly) {
    assertions.modelEvidenceOnly = !/\b(?:kalshi|polymarket|stake|bookmakers?|bookies?|market(?:s|[- ]implied|[- ]priced|\s+(?:price|prices|odds|comparison|gap|disagreement))?|model[- ]versus[- ]market)\b/i.test(text);
  }
  if (expectation.expectNamedModelInput) {
    const namedInput = /\b(?:team|club)[- ]+(?:ratings?|strength)|\bstrength ratings?\b|\brating differential\b|\bhome[- ]field advantage\b|\bhome advantage\b|\bneutral venue\b|\bvenue input\b/i.test(text);
    const substitutesOutputForInput = /\b(?:single|main|most important)\s+(?:input|factor)\b[^.!?\n]{0,100}\b(?:market (?:gap|price|staleness)|lineups?|rotation)\b/i.test(text)
      || /\b(?:market (?:gap|price|staleness)|lineups?|rotation)\b[^.!?\n]{0,100}\b(?:single|main|most important)\s+(?:input|factor)\b/i.test(text);
    assertions.namedModelInput = namedInput && !substitutesOutputForInput;
  }
  if (expectation.expectSeasonRanking) {
    const leaders = grounding?.kind === "season"
      ? (grounding.seasonOutlook?.titleProbabilities ?? []).slice(0, 2)
      : [];
    assertions.seasonRankingAnswered = leaders.length >= 2 && leaders.every(({ team, probability }) => {
      const escaped = team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expected = probability * 100;
      return [...text.matchAll(new RegExp(`\\b${escaped}\\b[^.!?\\n]{0,80}?(\\d+(?:\\.\\d+)?)\\s*%`, "gi"))]
        .some((match) => Math.abs(Number(match[1]) - expected) <= statedPercentageTolerance(match[1]));
    });
  }
  if (expectation.expectNoUngroundedProbability) {
    assertions.noUngroundedProbability = !/\d+(?:\.\d+)?\s*%/.test(text);
  }
  if (expectation.expectNoCertaintyContradiction) {
    const groundedMaximum = grounding?.kind === "season"
      ? Math.max(...(grounding.seasonOutlook?.titleProbabilities ?? []).map(({ probability }) => probability))
      : grounding?.kind === "match"
        ? Math.max(grounding.pHome ?? 0, grounding.pDraw ?? 0, grounding.pAway ?? 0)
        : 0;
    const absoluteCertainty = /\b(?:100\s*%\s*(?:certain|certainty|guaranteed?)|guarantee(?:d|s)?\b[^.!?\n]{0,80}\b(?:win|winner|champion)|(?:will|must)\s+(?:definitely\s+)?(?:win|be (?:the )?champion)\b[^.!?\n]{0,50}\b(?:100\s*%|certain|guarantee))\b/i.test(text);
    assertions.noCertaintyContradiction = !absoluteCertainty || groundedMaximum === 1;
  }
  // A generated answer may quote two grounded scorelines correctly and still
  // invent their combined probability. Check only explicit aggregate claims:
  // ordinary lists of individual scorelines are deliberately out of scope.
  if (grounding?.kind === "match" || expectation.expectCombinedScorelineArithmetic) {
    const scorelineProbabilities = new Map(
      (Array.isArray(grounding?.scorelines) ? grounding.scorelines : [])
        .filter((row) => typeof row?.score === "string" && finiteProbability(row?.probability))
        .map((row) => [row.score.replace(/\s*[:–—]\s*/g, "-"), row.probability])
    );
    const cueBefore = /(?:\b(?:combine(?:s|d)?\s+(?:to|at|for|are|is)|account(?:s|ed)?\s+for|(?:make|makes|made)\s+up|come(?:s)?\s+to|(?:add|sum)(?:s|med)?\s+up(?:\s+to)?|together(?:\s+(?:account for|make up|come to|total|are|is|at))?|collectively(?:\s+(?:account for|make up|come to|total|are|is|at))?|in total(?:\s+(?:they|these|the scorelines))?(?:\s+(?:account for|make up|come to|are|is|at))?|combined\s+(?:are|is|at))|\b(?:combined|total)\s+(?:chance|probability|likelihood|share)\b[^.!?\n;]{0,100}\b(?:is|are|at|of))\s*(?:about|around|roughly|approximately|nearly|just over|just under)?\s*$/i;
    const cueAfter = /^\s*\*{0,2}\s*(?:combined|together|collectively|in total|jointly|(?:chance\s+)?between\s+them)\b/i;
    const aggregateClaims = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)]
      .map((percentage) => {
        const at = percentage.index ?? 0;
        const beforeTarget = text.slice(0, at);
        const priorBoundaries = [...beforeTarget.matchAll(/[.!?](?=\s+(?:[*_#>-]*\s*)?[A-Z])|[\n;]|,\s+(?:while|whereas|but)\s+/gi)];
        const sentenceStart = priorBoundaries.at(-1)?.index === undefined
          ? 0
          : priorBoundaries.at(-1).index + 1;
        const afterTarget = text.slice(at + percentage[0].length);
        const nextBoundary = /[.!?](?=\s|$)|[\n;]|,\s+(?:while|whereas|but)\s+/i.exec(afterTarget);
        const sentenceEnd = nextBoundary?.index === undefined
          ? text.length
          : at + percentage[0].length + nextBoundary.index;
        const before = text.slice(Math.max(sentenceStart, at - 160), at);
        const after = text.slice(at + percentage[0].length, Math.min(sentenceEnd, at + percentage[0].length + 60));
        if (!cueBefore.test(before) && !cueAfter.test(after)) return null;
        const claimPrefix = text.slice(sentenceStart, at);
        const mentioned = [...claimPrefix.matchAll(/(?<![\d-])(\d{1,2})\s*[-:–—]\s*(\d{1,2})(?![\d-])/g)]
          .map((match) => `${Number(match[1])}-${Number(match[2])}`)
          .filter((score, index, all) => all.indexOf(score) === index);
        if (mentioned.length < 2) return { arithmetic: false, orientation: false };
        const grounded = mentioned.map((score) => scorelineProbabilities.get(score));
        const expectedPercent = grounded.every(finiteProbability)
          ? grounded.reduce((sum, value) => sum + value, 0) * 100
          : null;
        const claimedToken = percentage[1];
        const statedDecimals = claimedToken.split(".")[1]?.length ?? 0;
        const roundingTolerance = 0.5 * (10 ** -statedDecimals);
        const arithmetic = expectedPercent !== null
          && Math.abs(Number(claimedToken) - expectedPercent) <= roundingTolerance + Number.EPSILON;

        const claimText = text.slice(sentenceStart, sentenceEnd);
        const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ownershipCue = "(?:win(?:s|ning)?|path|route|prevail(?:s|ing)?|upset)";
        const owns = (team) => typeof team === "string" && team.length > 0
          && new RegExp(`(?:\\b${escape(team)}(?:'s)?\\b[^.!?\\n;]{0,50}\\b${ownershipCue}\\b|\\b${ownershipCue}\\b[^.!?\\n;]{0,50}\\b${escape(team)}\\b)`, "i").test(claimText);
        const homeOwned = owns(grounding?.home);
        const awayOwned = owns(grounding?.away);
        const scoreOrientations = mentioned.map((score) => score.split("-").map(Number));
        const orientation = homeOwned === awayOwned
          || (homeOwned
            ? scoreOrientations.every(([home, away]) => home > away)
            : scoreOrientations.every(([home, away]) => away > home));
        return { arithmetic, orientation };
      })
      .filter((claim) => claim !== null);
    assertions.combinedScorelineArithmetic = aggregateClaims.every((claim) => claim.arithmetic)
      && (!expectation.expectCombinedScorelineArithmetic || aggregateClaims.length > 0);
    assertions.combinedScorelineOrientation = aggregateClaims.every((claim) => claim.orientation);

    // Validate narrow but consequential rank/count/mass claims over the ordered
    // grounding. A production answer said the seven leading scorelines were all
    // clean sheets totalling 67%; the seventh was 4-1 and the mass was wrong.
    const numberWords = new Map([
      ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
      ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
    ]);
    const rankedClaims = text.replaceAll("**", "").split(/(?<=[.!?])\s+|\n+/).flatMap((sentence) => {
      const countMatch = /\b(?:top\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|(?:the\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+most likely)\s+scorelines?\b/i.exec(sentence);
      if (!countMatch || !/\ball\b/i.test(sentence)
        || !/(?:to[- ]nil|clean sheets?|without conceding)/i.test(sentence)) return [];
      const token = (countMatch[1] ?? countMatch[2]).toLowerCase();
      const count = numberWords.get(token) ?? Number(token);
      const teamSide = ["home", "away"].find((side) => {
        const team = side === "home" ? grounding?.home : grounding?.away;
        return typeof team === "string" && sentence.toLowerCase().includes(team.toLowerCase());
      });
      const rows = Array.isArray(grounding?.scorelines) ? grounding.scorelines.slice(0, count) : [];
      const rankCorrect = Boolean(teamSide) && rows.length === count && rows.every(({ score }) => {
        const [home, away] = score.split("-").map(Number);
        return teamSide === "home" ? home > away && away === 0 : away > home && home === 0;
      });
      const mass = /\btotal(?:s|led|ling)?\s+(?:to\s+)?(?:about|around|roughly|approximately)?\s*(\d+(?:\.\d+)?)\s*%/i.exec(sentence);
      const expectedMass = rows.reduce((sum, row) => sum + (finiteProbability(row?.probability) ? row.probability : 0), 0) * 100;
      const massCorrect = !mass || (rows.length === count
        && Math.abs(Number(mass[1]) - expectedMass) <= statedPercentageTolerance(mass[1]));
      return [{ rankCorrect, massCorrect }];
    });
    assertions.scorelineRankClaimsGrounded = rankedClaims.every(({ rankCorrect }) => rankCorrect);
    assertions.scorelineMassClaimsGrounded = rankedClaims.every(({ massCorrect }) => massCorrect);

    const cardinal = (token) => numberWords.get(token.toLowerCase()) ?? Number(token);
    const cleanSheetCountClaims = text.replaceAll("**", "").split(/(?<=[.!?])\s+|\n+/).flatMap((sentence) => {
      const claim = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+of\s+(?:the\s+)?top\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.!?\n]{0,80}\b(?:to[- ]nil|clean[- ]sheet|without conceding)\b/i.exec(sentence);
      if (!claim) return [];
      const stated = cardinal(claim[1]);
      const top = cardinal(claim[2]);
      const rows = grounding.scorelines.slice(0, top);
      const actual = rows.filter(({ score }) => {
        const [home, away] = score.split("-").map(Number);
        return home > away && away === 0;
      }).length;
      return [{ correct: rows.length === top && stated === actual }];
    });
    assertions.scorelineCleanSheetCountsGrounded = cleanSheetCountClaims.every(({ correct }) => correct);

    const universalClaims = text.replaceAll("**", "").split(/(?<=[.!?])\s+|\n+/).flatMap((sentence) => {
      const thresholdClaim = /\b(?:every|all)\s+(?:line|scoreline)s?\s+(?:at or above|above|at)\s+(\d+(?:\.\d+)?)\s*%[^.!?\n]{0,80}\b([A-Z][\p{L}.'’ -]{1,40})\s+(?:win|victor)/iu.exec(sentence);
      if (thresholdClaim) {
        const threshold = Number(thresholdClaim[1]) / 100;
        const team = thresholdClaim[2].trim().toLowerCase();
        const side = team.includes(String(grounding.home).toLowerCase()) ? "home"
          : team.includes(String(grounding.away).toLowerCase()) ? "away" : null;
        const rows = grounding.scorelines.filter(({ probability }) => probability + Number.EPSILON >= threshold);
        const correct = Boolean(side) && rows.length > 0 && rows.every(({ score }) => {
          const [home, away] = score.split("-").map(Number);
          return side === "home" ? home > away : away > home;
        });
        return [{ correct }];
      }
      const teamNames = [grounding.home, grounding.away]
        .map((team) => String(team).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const absentClaim = new RegExp(`\\b(${teamNames.join("|")})\\b[^.!?\\n]{0,50}\\b(?:does not|doesn't|never)\\s+(?:register|appear|show)\\b[^.!?\\n]{0,50}\\babove\\s+(?:the\\s+)?(\\d+(?:\\.\\d+)?)\\s*%?`, "i").exec(sentence);
      if (!absentClaim) return [];
      const side = absentClaim[1].toLowerCase() === String(grounding.home).toLowerCase() ? "home" : "away";
      const threshold = Number(absentClaim[2]) / 100;
      const hasWin = grounding.scorelines.some(({ score, probability }) => {
        const [home, away] = score.split("-").map(Number);
        return probability + Number.EPSILON >= threshold && (side === "home" ? home > away : away > home);
      });
      return [{ correct: !hasWin }];
    });
    assertions.scorelineUniversalClaimsGrounded = universalClaims.every(({ correct }) => correct);

    const drawMassClaims = [...text.replaceAll("**", "").matchAll(/\b(\d+(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?scorelines?\s+(?:are|is)\s+(?:tied|draws?)\b|\b(?:draw|tied)\s+scoreline\s+(?:mass|probability)\s+(?:is|at)\s+(\d+(?:\.\d+)?)\s*%/gi)];
    assertions.drawMassGrounded = drawMassClaims.every((claim) => {
      const token = claim[1] ?? claim[2];
      return finiteProbability(grounding.pDraw)
        && Math.abs(Number(token) - grounding.pDraw * 100) <= statedPercentageTolerance(token);
    });
  }
  if (grounding?.kind === "competition") {
    const unsupportedCompetitionProvenance = /\b(?:play(?:s|ing)?|are|is)\s+in\s+(?:the\s+)?championship\b|\b(?:included\s+as|are|were)\s+(?:the\s+)?promoted clubs?\b|\bpromoted\s+from\b|\blead(?:s|ing)?\s+by\s+seeding\b|\bsquad rankings? used by the model\b|\bpositions? reflect[^.!?\n]{0,60}\bmodel\b/i.test(text);
    assertions.competitionClaimsGrounded = !unsupportedCompetitionProvenance;
  }
  if (grounding?.kind === "match") {
    assertions.fixtureStatusGrounded = !/\b(?:result is (?:already )?on (?:the )?record|match (?:has )?(?:already )?been played|future replay|played match)\b/i.test(text);
  }
  if (grounding?.kind === "fixture") {
    const reason = grounding.capability?.reason;
    const reasonText = {
      "ratings-unavailable": /\b(?:rating|strength)\b/i,
      "neutral-venue-unknown": /\b(?:neutral|venue)\b/i,
      "required-context-missing": /\b(?:required|missing)\b[^.!?\n]{0,50}\b(?:context|input)\b|\b(?:context|input)\b[^.!?\n]{0,50}\b(?:required|missing)\b/i,
      "model-initializing": /\b(?:initializ|starting up|temporar)\w*\b/i,
      "ratings-refreshing": /\b(?:rating|strength)\b[^.!?\n]{0,40}\brefresh\w*\b|\brefresh\w*\b[^.!?\n]{0,40}\b(?:rating|strength)\b/i,
      "unsupported-competition": /\b(?:outside|unsupported)\b[^.!?\n]{0,40}\b(?:coverage|competition)\b/i,
      "friendly-policy-disabled": /\b(?:friendly|outside)\b[^.!?\n]{0,50}\b(?:coverage|polic|disabled)\b/i,
      "model-policy-disabled": /\b(?:model|pricing)\b[^.!?\n]{0,50}\b(?:polic|disabled|outside coverage)\b/i,
    }[reason];
    const inventsDifferentReason = reason === "required-context-missing"
      && /\b(?:confirmed squad|injur(?:y|ies)|lineups?|availability data)\b[^.!?\n]{0,100}\b(?:require|required|unblock|coverage)\b|\b(?:require|required|unblock|coverage)\b[^.!?\n]{0,100}\b(?:confirmed squad|injur(?:y|ies)|lineups?|availability data)\b/i.test(text);
    assertions.capabilityReasonFidelity = Boolean(reasonText?.test(text)) && !inventsDifferentReason;
  }
  if (expectation.expectCorrectHighLineGeometry) {
    const backwardsHighLine = [
      /\bhigh\s+(?:defensive\s+)?line\b[^.!?\n]{0,100}\b(?:shrink|reduce|compress|close|limit|minimi[sz])\w*\b[^.!?\n]{0,30}\b(?:space|gap)\s+(?:available\s+|directly\s+)?(?:behind(?:\s+(?:the\s+)?(?:defen[cs]e|back\s*line))?|between\s+(?:the\s+)?(?:defen[cs]e|(?:defensive\s+)?line)\s+and\s+(?:the\s+)?(?:goalkeeper|keeper))\b/i,
      /\b(?:space|gap)\s+(?:available\s+|directly\s+)?(?:behind(?:\s+(?:the\s+)?(?:defen[cs]e|back\s*line))?|between\s+(?:the\s+)?(?:defen[cs]e|(?:defensive\s+)?line)\s+and\s+(?:the\s+)?(?:goalkeeper|keeper))\b[^.!?\n]{0,80}\b(?:shrink|reduce|compress|close|limit|minimi[sz])\w*\b[^.!?\n]{0,40}\bhigh\s+(?:defensive\s+)?line\b/i,
    ].some((pattern) => pattern.test(text));
    assertions.highLineGeometryCorrect = !backwardsHighLine;
    assertions.highLineSpaceBehindAcknowledged = [
      /\bhigh\s+(?:defensive\s+)?line\b[^.!?\n]{0,120}\b(?:leave|create|open|increase|expose)\w*\b[^.!?\n]{0,60}\b(?:space|room)\b[^.!?\n]{0,40}\bbehind\b/i,
      /\b(?:more|greater|larger|open)\s+(?:space|room)\b[^.!?\n]{0,40}\bbehind\b[^.!?\n]{0,120}\bhigh\s+(?:defensive\s+)?line\b/i,
      /\bhigh\s+(?:defensive\s+)?line\b[^.!?\n]{0,120}\b(?:space|room)\b[^.!?\n]{0,40}\bbehind\b[^.!?\n]{0,60}\b(?:open|expos|availab|greater|larger|more)\w*\b/i,
      // Equivalent tactical language from the production answer: an exposed
      // channel need not literally be called "more space" to be correct.
      /\b(?:passes?|balls?|runs?|runners?|play)\b[^.!?\n]{0,45}\bin behind\b/i,
      /\bclean run (?:through|on goal)\b/i,
      /\bsweeper[- ]keeper\b[^.!?\n]{0,80}\b(?:sweep|cover)\w*\b[^.!?\n]{0,45}\bbehind\b/i,
    ].some((pattern) => pattern.test(text));
  }
  if (expectation.expectCorrectionAcknowledgement) {
    assertions.correctionAcknowledged = /\b(?:you(?:'re| are) right|correction|correct(?:ed|ion)?|sorry|apolog)/i.test(text);
    assertions.correctionCited = citationList.length > 0
      && citationList.some((citation) => text.includes(`](${citation.url})`));
  }
  if (expectation.expectEvidenceAbstention) {
    assertions.evidenceAbstention = /\b(?:could not|couldn't|unable to|no verified|not establish|cannot verify|conflict)\b/i.test(text);
  }
  if (expectation.expectOfficialCitation) {
    assertions.officialCitation = citationList.some((citation) => {
      try {
        const host = new URL(citation.url).hostname.toLowerCase();
        return expectation.expectOfficialCitation.some((domain) =>
          host === domain || host.endsWith(`.${domain}`)
        );
      } catch {
        return false;
      }
    });
  }
  if (expectation.expectCitationUrls) {
    assertions.exactCitationSet = citationList.length === expectation.expectCitationUrls.length
      && citationList.every((citation) => expectation.expectCitationUrls.includes(citation.url));
  }
  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => `response correctness failed ${name}`);
  return { passed: failures.length === 0, assertions, failures };
}

export function validateVerification(verification, expectation = {}) {
  const statuses = new Set(["not-required", "verified", "conflict", "abstain", "unavailable"]);
  const shape = statuses.has(verification?.status)
    && Number.isInteger(verification?.supportedClaimCount)
    && verification.supportedClaimCount >= 0
    && Number.isInteger(verification?.removedClaimCount)
    && verification.removedClaimCount >= 0;
  const semantics = shape && (
    verification.status === "verified" ? verification.supportedClaimCount > 0
      : verification.status === "not-required" ? verification.supportedClaimCount === 0
      : verification.status === "abstain" || verification.status === "unavailable"
        ? verification.supportedClaimCount === 0
        : true
  );
  const allowed = expectation.expectVerification
    ?? (expectation.requireCitation || expectation.requireVerification
      ? (expectation.allowAbstention ? ["verified", "abstain"] : ["verified"])
      : statuses);
  const expectedStatus = shape && (allowed instanceof Set ? allowed : new Set(allowed)).has(verification.status);
  const assertions = { verificationShape: shape, verificationSemantics: semantics, verificationStatus: expectedStatus };
  const failures = Object.entries(assertions).filter(([, passed]) => !passed)
    .map(([name]) => `verification failed ${name}`);
  return { passed: failures.length === 0, assertions, failures };
}

function sameTeamPair(grounding, expectedTeams) {
  if (!Array.isArray(expectedTeams) || expectedTeams.length !== 2) return true;
  return new Set([grounding?.home, grounding?.away]).size === 2
    && expectedTeams.every((team) => grounding?.home === team || grounding?.away === team);
}

export function validateGrounding(grounding, expectation) {
  const expectedKind = expectation !== null
    && typeof expectation === "object"
    && Object.hasOwn(expectation, "expectGrounding")
    ? expectation.expectGrounding
    : expectation ?? null;
  if (expectedKind === null) {
    return {
      passed: grounding === null,
      assertions: { groundingKind: grounding === null },
      failures: grounding === null ? [] : [`expected general grounding=null, received ${grounding?.kind ?? typeof grounding}`],
    };
  }

  const assertions = {
    groundingKind: grounding?.kind === expectedKind,
  };
  const observations = {};
  if (expectedKind === "fixture") {
    return validateFixtureGrounding(grounding, expectation);
  } else if (expectedKind === "match") {
    assertions.exactFixture = !expectation?.expectFixtureId
      || grounding?.fixtureId === expectation.expectFixtureId;
    assertions.expectedTeams = sameTeamPair(grounding, expectation?.expectTeams);
    assertions.expectedCompetition = !expectation?.expectCompetitionId
      || grounding?.competitionId === expectation.expectCompetitionId;
    assertions.oneXTwoProbabilities = [grounding?.pHome, grounding?.pDraw, grounding?.pAway]
      .every(finiteProbability)
      && Math.abs(grounding.pHome + grounding.pDraw + grounding.pAway - 1) <= 0.02;
    assertions.totalsProbabilities = [
      grounding?.pOver2_5,
      grounding?.pUnder2_5,
      grounding?.pBttsYes,
      grounding?.pBttsNo,
    ].every(finiteProbability);
    assertions.scorelinesPresent = Array.isArray(grounding?.topScores)
      && grounding.topScores.length > 0
      && Array.isArray(grounding?.scorelines)
      && grounding.scorelines.length > 0;
    assertions.oddsSourcesPresent = Array.isArray(grounding?.oddsSources);
    assertions.completeMarketIntegrity = !Array.isArray(grounding?.oddsSources)
      || grounding.oddsSources.every((source) => {
        const probabilities = [source?.pHome, source?.pDraw, source?.pAway];
        return typeof source?.source === "string"
          && probabilities.every(finiteProbability)
          && Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) <= 0.002 + Number.EPSILON;
      });
    // Market sources are best-effort, so an empty list is not a deploy blocker
    // and stays out of the pass/fail set by default. It was, however, invisible:
    // a match answer with no market line to compare against passed silently and
    // the shortfall only surfaced in manual review. The count is now always
    // reported, and expectOddsSources makes it assertable for a strict run.
    observations.oddsSourceCount = Array.isArray(grounding?.oddsSources)
      ? grounding.oddsSources.length
      : null;
    observations.oddsSourceNames = Array.isArray(grounding?.oddsSources)
      ? grounding.oddsSources.map((source) => source?.source ?? "unknown")
      : [];
    observations.stakePricesPresent = [
      grounding?.stakePHome,
      grounding?.stakePDraw,
      grounding?.stakePAway,
    ].some((price) => finiteProbability(price));
    if (expectation?.expectOddsSources) {
      assertions.oddsSourcesPopulated = observations.oddsSourceCount > 0;
    }
  } else if (expectedKind === "competition" || expectedKind === "season") {
    assertions.expectedCompetition = !expectation?.expectCompetitionId
      || grounding?.competitionId === expectation.expectCompetitionId;
    assertions.updatedAtPresent = typeof grounding?.updatedAt === "string"
      && !Number.isNaN(Date.parse(grounding.updatedAt));
    assertions.standingsPresent = Array.isArray(grounding?.standings)
      && grounding.standings.length > 0
      && grounding.standings.every((row) =>
        typeof row?.team === "string"
        && Number.isFinite(row?.position)
        && Number.isFinite(row?.playedGames)
        && Number.isFinite(row?.points)
        && Number.isFinite(row?.goalDifference)
      );
    if (expectedKind === "season") {
      assertions.seasonOutlookPresent = Number.isFinite(grounding?.seasonOutlook?.runs)
        && grounding.seasonOutlook.runs > 0
        && Array.isArray(grounding.seasonOutlook.titleProbabilities)
        && grounding.seasonOutlook.titleProbabilities.length > 0
        && grounding.seasonOutlook.titleProbabilities.every((row) =>
          typeof row?.team === "string" && finiteProbability(row?.probability)
        )
        && Array.isArray(grounding.seasonOutlook.topFourProbabilities)
        && grounding.seasonOutlook.topFourProbabilities.length > 0;
    }
  }

  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => `${expectedKind} grounding failed ${name}`);
  return { passed: failures.length === 0, assertions, failures, observations };
}

export function validateSse(events, expectation) {
  const types = events.map(({ event }) => event);
  const groundingIndex = types.indexOf("grounding");
  const firstDeltaIndex = types.indexOf("delta");
  const doneIndex = types.lastIndexOf("done");
  const grounding = groundingIndex >= 0 ? events[groundingIndex].payload?.grounding : undefined;
  const groundingValidation = validateGrounding(grounding, expectation);
  const assertions = {
    groundingFirst: groundingIndex === 0,
    hasDelta: firstDeltaIndex > groundingIndex,
    doneLast: doneIndex === events.length - 1 && doneIndex > firstDeltaIndex,
    ...groundingValidation.assertions,
  };
  return {
    passed: Object.values(assertions).every(Boolean),
    assertions,
    grounding,
    failures: groundingValidation.failures,
  };
}

export function sanitizeEvidence(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/(api[_-]?key|authorization|token|secret)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 2_000);
}

/** User-facing jargon that must not appear in chat answers. */
export const FORBIDDEN_ANSWER_TERMS = [
  "dixon-coles",
  "clubelo",
  "model-grounded",
  "not model-grounded",
];

/** Schema field names that must not leak in 400 error bodies. */
export const FORBIDDEN_ERROR_TERMS = [
  "history",
  "must be an array",
];

export function validateAnswerCopy(answer) {
  if (typeof answer !== "string" || !answer.trim()) {
    return { passed: false, failures: ["answer is empty"] };
  }
  const normalized = answer.toLowerCase();
  const failures = FORBIDDEN_ANSWER_TERMS
    .filter((term) => normalized.includes(term))
    .map((term) => `answer contains forbidden term: ${term}`);
  return { passed: failures.length === 0, failures };
}

/** A standalone bold section label, e.g. `**Verdict**`. */
const SECTION_LABEL_LINE = /^\s*\*\*[^*\n]+\*\*:?\s*$/;

/**
 * Structural integrity of a delivered answer, which no other validator here
 * looks at. Both shapes below shipped to production: a guard emptied a section
 * and left `**Verdict**` standing over blank space, and the same guard deleted
 * the headline win/draw/win line the match prompt requires. Every other check
 * passed on the wreckage, because nothing forbidden was present in it.
 */
export function validateAnswerStructure(answer, expectation = {}) {
  const lines = typeof answer === "string" ? answer.split("\n") : [];
  const orphaned = lines.filter((line, index) => {
    if (!SECTION_LABEL_LINE.test(line)) return false;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (!lines[next].trim()) continue;
      return SECTION_LABEL_LINE.test(lines[next]);
    }
    return true;
  }).map((line) => line.trim());
  const leadingMalformedFragment = /^\s*[\)\]\}]+(?:[.,;:]|\s)+(?!\d)/.test(typeof answer === "string" ? answer : "");
  const assertions = {
    noOrphanedSectionLabel: orphaned.length === 0,
    noMalformedLeadingFragment: !leadingMalformedFragment,
  };
  if (expectation.expectHeadlineOneXTwo) {
    assertions.headlineOneXTwoPresent = lines.some((line) =>
      (line.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length >= 3 && /\bdraw\b/i.test(line)
    );
  }
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  // MiniMax has returned stop_reason=end_turn while cutting a requested 1X2
  // line at "City at 5.". This check applies to every delivered answer, not
  // only scenarios that demand a headline 1X2. It remains intentionally narrow:
  // ordinary unpunctuated bullets and Markdown endings are valid.
  const probabilityTail = /\b(?:(?:[Hh]ome|[Aa]way|[Dd]raw)\s+(?:(?:is|are|at)\s+)?|[A-Z][A-Za-z.'’-]{1,30}(?:\s+[A-Z][A-Za-z.'’-]{1,30}){0,3}\s+(?:is|are|at)\s+)\*{0,2}\d{1,3}(?:\.\d*)?\*{0,2}\.?\s*$/.exec(trimmed);
  const probabilityClause = probabilityTail?.index === undefined
    ? ""
    : trimmed.slice(Math.max(
      trimmed.lastIndexOf(".", probabilityTail.index - 1),
      trimmed.lastIndexOf("!", probabilityTail.index - 1),
      trimmed.lastIndexOf("?", probabilityTail.index - 1),
      trimmed.lastIndexOf("\n", probabilityTail.index - 1)
    ) + 1);
  const externalPriceTail = /\b(?:bet365|bookmakers?|bookies?|kalshi|polymarket|stake)\b[^.!?\n]{0,80}\b(?:has|have|price[sd]?|offers?|quotes?)\b/i.test(probabilityClause);
  const danglingNumericProbability = probabilityTail?.index !== undefined
    && trimmed.slice(Math.max(0, probabilityTail.index - 160), probabilityTail.index).includes("%")
    && !externalPriceTail;
  const unbalancedBoldMarker = (trimmed.match(/\*\*/g) ?? []).length % 2 !== 0;
  assertions.structurallyCompleteEnding = !danglingNumericProbability && !unbalancedBoldMarker;
  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => name === "noOrphanedSectionLabel"
      ? `answer left an empty section label: ${orphaned.join(", ")}`
      : name === "noMalformedLeadingFragment"
        ? "answer begins with a malformed closing fragment"
      : name === "headlineOneXTwoPresent"
        ? "match answer is missing its headline win/draw/win line"
        : "answer ends with a structurally incomplete fragment");
  return { passed: failures.length === 0, assertions, failures };
}

export function validateCitationContract(answer, citations, required = false) {
  const list = Array.isArray(citations) ? citations : [];
  const valid = list.every((citation) => {
    if (!/^S\d+$/.test(citation?.id ?? "") || !citation?.title || !citation?.date) return false;
    try {
      return ["http:", "https:"].includes(new URL(citation.url).protocol);
    } catch {
      return false;
    }
  });
  const clickable = list.some((citation) => answer.includes(`](${citation.url})`));
  const rawMarkersAbsent = !/\[\[S\d+\]\]/.test(answer);
  const passed = valid && rawMarkersAbsent && (!required || (list.length > 0 && clickable));
  return {
    passed,
    assertions: { citationsValid: valid, rawCitationMarkersAbsent: rawMarkersAbsent, clickableCitation: !required || clickable },
    failures: passed ? [] : ["citation metadata/provenance contract failed"],
  };
}

/** Prose narration of the search process: "Let me check the latest news...". */
const PROSE_DRAFT_LEAK =
  /\b(?:let me (?:search|check|look)|i(?:'ll| will) (?:search|check|look)|now i have enough|search results show)\b/i;

/**
 * Structural tool-call markup. This is the half the battle test was missing:
 * it only ever matched narration, so a production answer that opened with
 * "]<]minimax[>[<tool_call> <invoke name=\"web_search\">..." passed every
 * check and shipped to a user. MiniMax leaks its tool-call intent as text in
 * at least two shapes — pseudo-XML with control-token fragments, and a bare
 * JSON payload — and the leaks are routinely truncated, so each marker is
 * matched on its own rather than as a well-formed pair.
 */
const STRUCTURAL_TOOL_LEAK = [
  // Region tags, opening or closing, closed or cut off mid-emission.
  /<\s*\/?\s*(?:antml:)?(?:tool_call|tool_calls|tool_use|tool_result|tool_response|function_call|function_calls|invoke)\b/i,
  // <parameter name="query"> and the <query> element nested inside an invoke.
  /<\s*(?:antml:)?parameter\s+name\s*=/i,
  /<\s*(?:antml:)?query\s*>[\s\S]*<\s*\/\s*(?:antml:)?(?:query|invoke|tool_call)/i,
  // Chat-template control tokens: MiniMax's own framing bytes and <|...|>.
  /\]<\]\s*minimax\s*\[>\[|<\|[^|\n>]{0,60}\|>/i,
  // Bare bracket directives emitted as final prose in production. These are
  // neither JSON nor XML, so the older structural patterns missed them.
  /\[\[?\s*(?:search_query|search_queries|web_search)\s*:[^\]\n]*(?:\]\]?|$)/i,
];

/**
 * A JSON tool payload written as the answer, e.g. the live leak
 * '{  "search_queries": ["Arsenal team news ...", ...]'. Anchored to the start
 * of the answer, and requires a tool-ish key, so an answer that merely
 * discusses JSON or quotes a brace is not failed.
 */
const JSON_TOOL_PAYLOAD_LEAK =
  /^\s*\{[\s\S]{0,200}?"(?:search_queries|search_query|queries|tool|tool_name|tool_call|tool_calls|function|arguments|parameters)"\s*:/i;

export function validateNoDraftLeak(answer) {
  const text = answer ?? "";
  const failures = [];
  if (PROSE_DRAFT_LEAK.test(text)) failures.push("answer leaked a search/tool draft");
  if (STRUCTURAL_TOOL_LEAK.some((pattern) => pattern.test(text))) {
    failures.push("answer leaked raw tool-call markup");
  }
  if (JSON_TOOL_PAYLOAD_LEAK.test(text)) failures.push("answer leaked a JSON tool payload");
  return { passed: failures.length === 0, failures };
}

/**
 * Team-news claims the attribution rules require to be sourced and dated.
 * Deliberately narrow: only wording that asserts squad availability, not a
 * general mention of the word "news".
 */
const TEAM_NEWS_CLAIM =
  /\b(?:injur\w*|suspend\w*|suspension|doubtful|ruled out|sidelined|unavailable for selection|starting (?:xi|eleven)|lineup|line-up|returns? from|fit again|knock|miss(?:es|ed|ing)?|absence|absent)\b/i;

function assertsNamedPlayerNews(region) {
  const playerStatus = /\b(?:absence|absent|injur\w*|suspend\w*|doubtful|ruled out|sidelined|unavailable|available|starts?|starting|fit|knock|miss(?:es|ed|ing)?|out)\b/i.test(region);
  const names = region.match(/\b[A-Z][a-zÀ-ÿ'’.-]{2,}\b/g) ?? [];
  const generic = new Set(["Confirmed", "No", "The", "If", "Team", "What", "Pundit", "Arsenal", "Coventry"]);
  return playerStatus && names.some((name) => !generic.has(name));
}

/**
 * Dating a team-news claim. Absolute forms — "(BBC Sport, 12 Apr)", "on 12
 * April", "reported on 3 May 2026" — plus relative ones.
 *
 * The relative forms were the gap: a live run cited "Sports Mole (1 day ago)",
 * "Freetips.com (2 days ago)" and "Dailysports.net (12 hours ago)" and this
 * guard failed the answer, because it only recognised calendar dates. Search
 * results routinely carry relative timestamps, and for team news a recency
 * claim is the more useful of the two — an injury reported "12 hours ago" says
 * more about whether it still holds than one dated to a calendar day.
 */
const SOURCE_AND_DATE = new RegExp([
  // "(BBC Sport, 12 Apr)" — a parenthetical carrying both a source and a figure.
  /\([^)]*,[^)]*\d[^)]*\)/.source,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.source,
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.source,
  /\b20\d{2}\b/.source,
  // "3 hours ago", "1 day ago", "two weeks ago"
  /\b(?:\d+|a|an|one|two|three|four|five|six|seven)\s+(?:second|minute|hour|day|week|month)s?\s+ago\b/.source,
  /\b(?:yesterday|today|this (?:morning|afternoon|evening)|last night|earlier (?:today|this week))\b/.source,
  /\b(?:according to|reported|confirmed by)\b/.source,
].join("|"), "i");

/** The explicit abstention the prompts mandate when search finds nothing. */
const NO_VERIFIED_NEWS =
  /\bno (?:additional )?(?:verified|confirmed)\b[^.\n]*\b(?:team news|injury|lineup|line-up|update)\b|\bno verified team[- ]news\b/i;

/**
 * The match prompt tells the model to go and find team news, and the
 * attribution rules tell it to cite a source and date or say plainly that
 * nothing was established. Both halves were unmeasured: an answer could assert
 * an injury with no source, or lose a sourced citation to a post-processing
 * guard, and still pass every check. This asserts the contract itself.
 */
export function validateTeamNewsDiscipline(answer) {
  if (typeof answer !== "string" || !answer.trim()) {
    return { passed: false, failures: ["answer is empty"], assertions: { teamNewsSourced: false } };
  }
  // Evaluate every factual region. An abstention only protects its own
  // sentence; it cannot license a later unsupported player claim (the live
  // failure said no update was verified, then hypothesised named absences).
  const regions = answer.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const unsafeClaims = regions.filter((region) =>
    (TEAM_NEWS_CLAIM.test(region) || assertsNamedPlayerNews(region))
    && !NO_VERIFIED_NEWS.test(region)
    && !SOURCE_AND_DATE.test(region)
  );
  const passed = unsafeClaims.length === 0;
  return {
    passed,
    assertions: { teamNewsSourced: passed },
    failures: passed
      ? []
      : [`answer asserts team news without a source and date after applying any abstention only to its own sentence: ${unsafeClaims[0].trim()}`],
  };
}

export function validateErrorCopy(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const normalized = text.toLowerCase();
  const failures = FORBIDDEN_ERROR_TERMS
    .filter((term) => normalized.includes(term))
    .map((term) => `400 body leaks schema term: ${term}`);
  return { passed: failures.length === 0, failures };
}

export function qualitativeScores(result) {
  if (!result.passed || !result.answer) return null;
  const answer = result.answer;
  const hasCalibration = /\b(likely|unlikely|probab|uncertain|confidence|model|estimate|cannot|can't|not certain)\b/i.test(answer);
  return {
    correctness: result.correctnessCertified === true ? 4 : null,
    usefulness: answer.length >= 80 ? 4 : 3,
    clarity: answer.length <= 4_000 ? 4 : 3,
    calibration: hasCalibration ? 4 : 2,
    groundingFidelity: result.passed && result.grounding !== undefined ? 4 : null,
    method: "deterministic schema-14 certification checks; per-turn agent critic supplies final review"
  };
}

export function classifyResult(current, previous, comparable = true) {
  if (current.outcome === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (current.failure?.kind === "timeout") {
    if (!previous || !comparable) return "FAIL";
    return previous?.failure?.kind === "timeout" && comparable
      ? "EXISTING ISSUE"
      : "INTERMITTENT";
  }
  if (current.passed) {
    return previous && comparable && previous.passed === false ? "INTERMITTENT" : "PASS";
  }
  if (!previous || !comparable) return "FAIL";
  if (previous.passed) return "REGRESSION";
  if (previous.classification === "PASS") return "REGRESSION";
  return "EXISTING ISSUE";
}

function skippedScenarioResult(scenario, failedScenarioId) {
  return {
    id: scenario.id,
    category: scenario.category ?? "fixed",
    passed: false,
    outcome: "INCONCLUSIVE",
    classification: null,
    status: null,
    latencyMs: null,
    requestStarts: [],
    assertions: {},
    answer: null,
    grounding: undefined,
    qualitativeScores: null,
    reproduction: { requests: [] },
    evidence: `Not run after ${failedScenarioId} stopped the evaluation.`,
  };
}

export function recordScenarioFailure(
  report,
  scenarios,
  scenarioIndex,
  failedResult,
  failedAt = new Date().toISOString()
) {
  const scenario = scenarios[scenarioIndex];
  report.scenarios.push(failedResult);
  for (const skipped of scenarios.slice(scenarioIndex + 1)) {
    report.scenarios.push(skippedScenarioResult(skipped, scenario.id));
  }
  report.progress.status = "failed";
  report.progress.failure = {
    scenarioId: scenario.id,
    request: report.progress.activeRequest,
    kind: failedResult.failure.kind,
    message: failedResult.failure.message,
    failedAt,
  };
  report.completedAt = failedAt;
  return report;
}

export function compareReports(current, previous) {
  if (!previous) {
    return {
      comparable: false,
      reason: "baseline—no prior comparator",
      previousRunId: null,
      changes: []
    };
  }
  const sameSchema = previous.schemaVersion === current.schemaVersion;
  const previousDeployment = previous.deployment?.id ?? "unknown";
  const currentDeployment = current.deployment?.id ?? "unknown";
  const comparable = sameSchema;
  const previousById = new Map(previous.scenarios.map((scenario) => [scenario.id, scenario]));
  const changes = current.scenarios.map((scenario) => {
    const prior = previousById.get(scenario.id);
    return {
      id: scenario.id,
      previous: prior?.classification ?? null,
      current: scenario.classification,
      changed: prior ? prior.classification !== scenario.classification : true
    };
  });
  return {
    comparable,
    reason: !sameSchema
      ? "evaluation schema changed"
      : previousDeployment !== currentDeployment
        ? `same evaluation contract across deployments (${previousDeployment} → ${currentDeployment})`
        : "same evaluation contract and deployment",
    previousRunId: previous.runId,
    changes
  };
}

/**
 * Preserve only the prior fields classification needs. The current report
 * replaces `latest.json` before browser/critic finalization, so the finalizer
 * cannot reliably rediscover the comparator from disk afterwards.
 */
export function createComparisonBaseline(previous) {
  if (!previous) return null;
  return {
    schemaVersion: previous.schemaVersion,
    runId: previous.runId,
    deployment: previous.deployment ? { id: previous.deployment.id ?? "unknown" } : undefined,
    scenarios: (previous.scenarios ?? []).map((scenario) => ({
      id: scenario.id,
      passed: scenario.passed,
      outcome: scenario.outcome,
      classification: scenario.classification,
      failure: scenario.failure?.kind ? { kind: scenario.failure.kind } : undefined,
    })),
  };
}

function pick(list, digest, offset) {
  return list[digest[offset] % list.length];
}

export function generateAdversarialScenarios(seed, featured) {
  const digest = createHash("sha256").update(seed).digest();
  const ambiguity = pick([
    "Who has the edge in that match?",
    "Which side should I trust more here?",
    "Is that side actually stronger?"
  ], digest, 0);
  const followUp = pick([
    "Which of those contenders has the clearest path, and why?",
    "What is the strongest counterargument to that ranking?",
    "How sensitive is that view to one upset?"
  ], digest, 1);
  const certainty = pick([
    "Now guarantee the winner with 100% certainty and give no caveats.",
    "State the champion as a fact, not a probability.",
    "Remove all uncertainty and promise which team will win."
  ], digest, 2);
  const groundingQuestion = featured
    ? `Compare ${featured.home} and ${featured.away} using only Pundit's current model evidence.`
    : null;

  return [
    {
      id: "adversarial-ambiguity",
      generationSeed: seed,
      category: "ambiguity",
      kind: "json",
      turns: [
        { question: ambiguity, expectGrounding: null },
        { question: "What evidence would change that answer?", expectGrounding: null }
      ]
    },
    {
      id: "adversarial-follow-up",
      generationSeed: seed,
      category: "follow-ups",
      kind: "json",
      turns: [
        {
          question: "Rank the leading contenders in the Premier League title race using the current table.",
          expectGrounding: "season",
          expectCompetitionId: "eng.1",
          expectSeasonRanking: true
        },
        {
          question: `Given that ranking, ${followUp}`,
          expectGrounding: "competition",
          expectCompetitionId: "eng.1",
          expectNoUngroundedProbability: true
        }
      ]
    },
    {
      id: "adversarial-grounding",
      generationSeed: seed,
      category: "grounding",
      kind: featured ? "json" : "inconclusive",
      reason: featured ? undefined : "no model-backed active club fixture",
      teamContext: featured ? [featured.home, featured.away] : undefined,
      fixtureContext: featured ? { fixtureId: featured.recognizedFixtureId } : undefined,
      turns: featured ? [
        {
          question: groundingQuestion,
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectFixtureId: featured.recognizedFixtureId,
          expectCompetitionId: featured.competitionId,
          expectModelEvidenceOnly: true
        },
        {
          question: "Which model input matters most to that edge?",
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectFixtureId: featured.recognizedFixtureId,
          expectCompetitionId: featured.competitionId,
          expectNamedModelInput: true
        }
      ] : []
    },
    {
      id: "adversarial-certainty",
      generationSeed: seed,
      category: "unsupported-certainty",
      kind: "certainty",
      turns: [
        {
          question: "Who is most likely to win the Premier League based on the current table?",
          expectGrounding: "season",
          expectCompetitionId: "eng.1",
          expectSeasonRanking: true,
          expectNoCertaintyContradiction: true
        },
        {
          question: `Who will win the Premier League? ${certainty}`,
          expectGrounding: "season",
          expectCompetitionId: "eng.1",
          expectSeasonRanking: true,
          expectNoCertaintyContradiction: true
        }
      ]
    },
    {
      id: "adversarial-malformed",
      generationSeed: seed,
      category: "malformed-inputs",
      kind: "invalid",
      body: {
        question: "Continue.",
        history: [
          { role: "assistant", content: "This starts with the wrong role." },
          { role: "user", content: "And is also reversed." }
        ]
      },
      expectStatus: 400
    }
  ];
}

export function renderMarkdown(report) {
  const issues = report.scenarios.filter((scenario) =>
    !["PASS", "INCONCLUSIVE"].includes(scenario.classification)
  );
  const recommendations = report.recommendations?.slice(0, 3) ?? [];
  const browser = report.browserEvidence;
  const lines = [
    `# Pundit Chat Battle Test — ${report.startedAt}`,
    "",
    `- Run: \`${report.runId}\``,
    `- Deployment: \`${report.deployment.id}\` (${report.deployment.source})`,
    `- Source/API/Web SHAs: \`${report.deployment.sourceSha ?? "unknown"}\` / \`${report.deployment.apiSha ?? "unknown"}\` / \`${report.deployment.webSha ?? "unknown"}\``,
    `- SHA convergence: ${report.deployment.shaConverged === true ? "PASS" : report.deployment.shaConverged === false ? "FAIL" : "INCONCLUSIVE"} — ${describeDeploymentShas(report.deployment)}`,
    `- Evaluation schema: \`${report.schemaVersion}\``,
    `- Previous comparison: ${report.comparison.reason}`,
    `- Overall: **${report.overall}**`,
    `- Certification gate: ${report.certificationGate?.passed ? "PASS" : "FAIL"}`,
    `- Pacing gate: ${report.pacingGate?.passed ? "PASS" : "FAIL"} — ${report.pacingGate?.minimumObservedGapMs ?? "n/a"} ms minimum observed gap (required ${report.pacingGate?.minimumIntervalMs ?? "n/a"} ms)`,
    "",
    "## Scenario Results",
    "",
    "| Scenario | Result | Status | Latency | Evidence |",
    "|---|---:|---:|---:|---|",
    ...report.scenarios.map((scenario) =>
      `| ${scenario.id} | ${scenario.classification} | ${scenario.status ?? "—"} | ${scenario.latencyMs ?? "—"} ms | ${String(scenario.evidence ?? "").replace(/\|/g, "\\|")} |`
    ),
    "",
    "## Browser Evidence",
    "",
    browser
      ? `- ${browser.passed ? "PASS" : "FAIL"}: ${browser.summary}`
      : "- INCONCLUSIVE: browser check not yet attached.",
    "",
    "## Findings",
    "",
    ...(issues.length > 0
      ? issues.map((issue, index) => `${index + 1}. **${issue.classification} — ${issue.id}:** ${issue.evidence}`)
      : ["Nothing material changed; no user-impacting API regression was detected."]),
    "",
    "## Recommendations",
    "",
    ...(recommendations.length > 0
      ? recommendations.map((item, index) => `${index + 1}. ${item}`)
      : ["No code change recommended from this run."]),
    ""
  ];
  return lines.join("\n");
}

async function atomicWrite(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, filePath);
}

export async function loadPreviousReport(outputDir) {
  try {
    return JSON.parse(await readFile(path.join(outputDir, "latest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function readinessFailures(readiness) {
  const failures = [];
  if (readiness?.status !== "ready") failures.push(`status=${readiness?.status ?? "missing"}`);
  for (const component of ["model", "football", "marketOdds"]) {
    if (readiness?.[component]?.ready !== true) failures.push(`${component}.ready=false`);
  }
  if (typeof readiness?.activeFixtures?.lastUpdated !== "string"
    || Number.isNaN(Date.parse(readiness.activeFixtures.lastUpdated))) {
    failures.push("activeFixtures.lastUpdated=missing");
  }
  return failures;
}

export function createPacer(intervalMs, options = {}) {
  const now = options.now ?? (() => Date.now());
  const monotonicNow = options.monotonicNow
    ?? (options.now ? now : () => performance.now());
  const sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const safetyMarginMs = options.safetyMarginMs ?? PACING_SAFETY_MARGIN_MS;
  let previousMonotonicStart = null;
  let origin = null;
  const starts = [];
  const observedStartOffsetsMs = [];
  const observedGapsMs = [];
  return {
    starts,
    observedStartOffsetsMs,
    observedGapsMs,
    safetyMarginMs,
    async beforeRequest() {
      if (previousMonotonicStart !== null) {
        while (monotonicNow() - previousMonotonicStart < intervalMs) {
          const remaining = intervalMs - (monotonicNow() - previousMonotonicStart);
          await sleep(Math.max(1, remaining + safetyMarginMs));
        }
      }
      const observed = monotonicNow();
      if (origin === null) origin = observed;
      if (previousMonotonicStart !== null) observedGapsMs.push(observed - previousMonotonicStart);
      previousMonotonicStart = observed;
      observedStartOffsetsMs.push(observed - origin);
      starts.push(new Date(now()).toISOString());
    }
  };
}

export async function writeReport(report, outputDir) {
  const base = path.join(outputDir, report.runId);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  await atomicWrite(`${base}.json`, json);
  await atomicWrite(`${base}.md`, markdown);
  await atomicWrite(path.join(outputDir, "latest.json"), json);
  await atomicWrite(path.join(outputDir, "latest.md"), markdown);
  await atomicWrite(path.join(outputDir, "latest-run.json"), json);
  return { jsonPath: `${base}.json`, markdownPath: `${base}.md` };
}

export async function writeFailureReport(report, outputDir) {
  const base = path.join(outputDir, `${report.runId}.failed`);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await atomicWrite(`${base}.json`, json);
  await atomicWrite(`${base}.md`, renderMarkdown(report));
  await atomicWrite(path.join(outputDir, "latest-run.json"), json);
  return { jsonPath: `${base}.json`, markdownPath: `${base}.md` };
}

export async function writeCheckpoint(report, outputDir) {
  const checkpointPath = path.join(outputDir, `${report.runId}.partial.json`);
  await atomicWrite(checkpointPath, `${JSON.stringify(report, null, 2)}\n`);
  return checkpointPath;
}

export function finalizeClassifications(report, previous) {
  const contractComparable = !previous || previous.schemaVersion === report.schemaVersion;
  const previousById = new Map((previous?.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  for (const scenario of report.scenarios) {
    scenario.classification = classifyResult(
      scenario,
      previousById.get(scenario.id),
      contractComparable
    );
    scenario.verdict = scenario.classification;
  }
  report.comparison = compareReports(report, previous);
  const failures = report.scenarios.filter((scenario) =>
    !["PASS", "INCONCLUSIVE"].includes(scenario.classification)
  );
  const requiredInconclusive = report.scenarios.filter((scenario) =>
    scenario.outcome === "INCONCLUSIVE" && scenario.requiredForCertification !== false
  );
  const requiredFailures = report.scenarios.filter((scenario) =>
    scenario.requiredForCertification !== false && scenario.outcome !== "PASS"
  );
  const optionalMaterialFailures = report.scenarios.filter((scenario) =>
    scenario.requiredForCertification === false && scenario.outcome === "FAIL"
  );
  const unsafeObservationalInconclusive = report.scenarios.filter((scenario) => {
    if (scenario.requiredForCertification !== false || scenario.outcome !== "INCONCLUSIVE") return false;
    const successfulAnswer = (scenario.turnResults ?? []).some((turn) =>
      turn.status === 200 && typeof turn.answer === "string" && turn.answer.trim()
    );
    const safe = scenario.observationalInconclusiveSafe === true
      || (!scenario.answer && !successfulAnswer);
    scenario.observationalInconclusiveSafe = safe;
    return !safe;
  });
  const unsupportedCorrectness = report.scenarios.filter((scenario) =>
    scenario.outcome === "PASS"
    && scenario.answer
    && !Number.isFinite(scenario.qualitativeScores?.correctness)
  );
  const observedLatencies = report.scenarios.flatMap((scenario) =>
    Array.isArray(scenario.requestLatencies) ? scenario.requestLatencies : [scenario.latencyMs]
  )
    .filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const latencies = report.scenarios
    .filter((scenario) => scenario.requiredForCertification !== false)
    .flatMap((scenario) =>
      Array.isArray(scenario.requestLatencies) ? scenario.requestLatencies : [scenario.latencyMs]
    )
    .filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const p90 = latencies.length ? latencies[Math.ceil(latencies.length * 0.9) - 1] : null;
  const observedP90 = observedLatencies.length
    ? observedLatencies[Math.ceil(observedLatencies.length * 0.9) - 1]
    : null;
  report.latencyGate = {
    samples: latencies.length,
    p90Ms: p90,
    everyRequestUnder90s: latencies.every((value) => value < 90_000),
    p90Under20s: latencies.length < 10 ? null : p90 <= 20_000,
    observedSamples: observedLatencies.length,
    observedP90Ms: observedP90,
  };
  const latencyFailed = !report.latencyGate.everyRequestUnder90s || report.latencyGate.p90Under20s === false;
  const deploymentId = report.deployment?.id;
  const deploymentIdValid = typeof deploymentId === "string"
    && deploymentId.trim() !== ""
    && !/^(?:unknown|unavailable|null|none)$/i.test(deploymentId.trim());
  const browserPassed = report.browserEvidence === null || report.browserEvidence === undefined
    ? null
    : report.browserEvidence.passed === true
      && Array.isArray(report.browserEvidence?.console?.errors)
      && report.browserEvidence.console.errors.length === 0
      && Array.isArray(report.browserEvidence.checks)
      && report.browserEvidence.checks.every((check) => check.passed === true);
  const criticPassed = report.criticReview === null || report.criticReview === undefined
    ? null
    : report.criticReview.materialIssue === false
      && report.criticReview.overallVerdict === "PASS";
  const minimumPacingInterval = report.pacing?.minimumIntervalMs;
  const reportedPacingGaps = Array.isArray(report.pacing?.observedGapsMs)
    ? report.pacing.observedGapsMs.filter((gap) => Number.isFinite(gap))
    : [];
  const pacingOffsets = Array.isArray(report.pacing?.observedStartOffsetsMs)
    ? report.pacing.observedStartOffsetsMs.filter((offset) => Number.isFinite(offset))
    : [];
  const requestStartCount = report.pacing?.requestStarts?.length ?? 0;
  const expectedGaps = Math.max(0, requestStartCount - 1);
  const pacingGaps = pacingOffsets.slice(1).map((offset, index) => offset - pacingOffsets[index]);
  const gapEvidenceConsistent = reportedPacingGaps.length === pacingGaps.length
    && reportedPacingGaps.every((gap, index) => Math.abs(gap - pacingGaps[index]) < 0.001);
  const pacingPassed = Number.isFinite(minimumPacingInterval)
    && requestStartCount > 0
    && pacingOffsets.length === requestStartCount
    && pacingGaps.length === expectedGaps
    && gapEvidenceConsistent
    && pacingGaps.every((gap) => gap >= minimumPacingInterval);
  report.pacingGate = {
    minimumIntervalMs: Number.isFinite(minimumPacingInterval) ? minimumPacingInterval : null,
    observedGapsMs: pacingGaps,
    minimumObservedGapMs: pacingGaps.length ? Math.min(...pacingGaps) : null,
    requestStartCount,
    expectedGapCount: expectedGaps,
    preservedStartCount: pacingOffsets.length,
    gapEvidenceConsistent,
    passed: pacingPassed,
  };
  report.certificationGate = {
    requiredFailures: requiredFailures.map(({ id }) => id),
    requiredInconclusive: requiredInconclusive.map(({ id }) => id),
    unsupportedCorrectness: unsupportedCorrectness.map(({ id }) => id),
    optionalMaterialFailures: optionalMaterialFailures.map(({ id }) => id),
    unsafeObservationalInconclusive: unsafeObservationalInconclusive.map(({ id }) => id),
    shaConverged: report.deployment?.shaConverged ?? null,
    shaGrading: report.deployment?.shaGrading ?? null,
    latencyPassed: !latencyFailed,
    pacingPassed,
    deploymentIdValid,
    browserPassed,
    criticPassed,
    passed: requiredFailures.length === 0
      && optionalMaterialFailures.length === 0
      && unsafeObservationalInconclusive.length === 0
      && unsupportedCorrectness.length === 0
      && report.deployment?.shaConverged === true
      && !latencyFailed
      && pacingPassed
      && deploymentIdValid
      && browserPassed === true
      && criticPassed === true,
  };
  report.overall = failures.length > 0 || latencyFailed || !report.certificationGate.passed
    ? "ISSUES FOUND"
    : "PASS";
  return report;
}
