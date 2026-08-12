import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const EVAL_SCHEMA_VERSION = 9;
export const MIN_REQUEST_INTERVAL_MS = 13_000;

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

function finiteProbability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
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

export function validateNoDraftLeak(answer) {
  const leaked = /\b(?:let me (?:search|check|look)|i(?:'ll| will) (?:search|check|look)|now i have enough|search results show)\b/i.test(answer ?? "");
  return { passed: !leaked, failures: leaked ? ["answer leaked a search/tool draft"] : [] };
}

/**
 * Team-news claims the attribution rules require to be sourced and dated.
 * Deliberately narrow: only wording that asserts squad availability, not a
 * general mention of the word "news".
 */
const TEAM_NEWS_CLAIM =
  /\b(?:injur\w*|suspend\w*|suspension|doubtful|ruled out|sidelined|unavailable for selection|starting (?:xi|eleven)|lineup|line-up|returns? from|fit again|knock)\b/i;

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
  const claims = TEAM_NEWS_CLAIM.test(answer);
  const abstains = NO_VERIFIED_NEWS.test(answer);
  // An abstention settles the contract on its own: there is no claim left to
  // source. Checking it first keeps "no verified injury update" from being read
  // as an unsourced injury claim.
  const passed = abstains || !claims || SOURCE_AND_DATE.test(answer);
  return {
    passed,
    assertions: { teamNewsSourced: passed },
    failures: passed
      ? []
      : ["answer asserts team news without naming a source and date, and without"
        + " stating that no verified update was established"],
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
    method: "deterministic schema-9 certification checks; agent critic supplies final review"
  };
}

export function classifyResult(current, previous, comparable = true) {
  if (current.outcome === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (current.failure?.kind === "timeout") {
    return previous?.failure?.kind === "timeout" && comparable
      ? "EXISTING ISSUE"
      : "INTERMITTENT";
  }
  if (current.passed) {
    return previous && comparable && previous.passed === false ? "INTERMITTENT" : "PASS";
  }
  if (!previous || !comparable) return "EXISTING ISSUE";
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
          expectCompetitionId: "eng.1"
        },
        {
          question: `Given that ranking, ${followUp}`,
          expectGrounding: "competition",
          expectCompetitionId: "eng.1"
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
          expectCompetitionId: featured.competitionId
        },
        {
          question: "Which model input matters most to that edge?",
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectFixtureId: featured.recognizedFixtureId,
          expectCompetitionId: featured.competitionId
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
          expectCompetitionId: "eng.1"
        },
        {
          question: `Who will win the Premier League? ${certainty}`,
          expectGrounding: "season",
          expectCompetitionId: "eng.1"
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
    `- SHA convergence: ${report.deployment.shaConverged === true ? "PASS" : report.deployment.shaConverged === false ? "FAIL" : "INCONCLUSIVE"}`,
    `- Evaluation schema: \`${report.schemaVersion}\``,
    `- Previous comparison: ${report.comparison.reason}`,
    `- Overall: **${report.overall}**`,
    `- Certification gate: ${report.certificationGate?.passed ? "PASS" : "FAIL"}`,
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

export function createPacer(intervalMs, {
  now = () => Date.now(),
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
} = {}) {
  let previousStart = null;
  const starts = [];
  return {
    starts,
    async beforeRequest() {
      if (previousStart !== null) {
        const remaining = intervalMs - (now() - previousStart);
        if (remaining > 0) await sleep(remaining);
      }
      previousStart = now();
      starts.push(new Date(previousStart).toISOString());
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
    scenario.outcome === "INCONCLUSIVE" && scenario.requiredForCertification === true
  );
  const unsupportedCorrectness = report.scenarios.filter((scenario) =>
    scenario.outcome === "PASS"
    && scenario.answer
    && !Number.isFinite(scenario.qualitativeScores?.correctness)
  );
  const latencies = report.scenarios.flatMap((scenario) =>
    Array.isArray(scenario.requestLatencies) ? scenario.requestLatencies : [scenario.latencyMs]
  )
    .filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const p90 = latencies.length ? latencies[Math.ceil(latencies.length * 0.9) - 1] : null;
  report.latencyGate = {
    samples: latencies.length,
    p90Ms: p90,
    everyRequestUnder90s: latencies.every((value) => value < 90_000),
    p90Under20s: latencies.length < 10 ? null : p90 <= 20_000,
  };
  const latencyFailed = !report.latencyGate.everyRequestUnder90s || report.latencyGate.p90Under20s === false;
  report.certificationGate = {
    requiredInconclusive: requiredInconclusive.map(({ id }) => id),
    unsupportedCorrectness: unsupportedCorrectness.map(({ id }) => id),
    shaConverged: report.deployment?.shaConverged ?? null,
    passed: requiredInconclusive.length === 0
      && unsupportedCorrectness.length === 0
      && report.deployment?.shaConverged !== false,
  };
  report.overall = failures.length > 0 || latencyFailed || !report.certificationGate.passed
    ? "ISSUES FOUND"
    : "PASS";
  return report;
}
