import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const EVAL_SCHEMA_VERSION = 5;
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
  if (expectedKind === "match") {
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
  } else if (expectedKind === "competition") {
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
  }

  const failures = Object.entries(assertions)
    .filter(([, passed]) => !passed)
    .map(([name]) => `${expectedKind} grounding failed ${name}`);
  return { passed: failures.length === 0, assertions, failures };
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
    correctness: null,
    usefulness: answer.length >= 80 ? 4 : 3,
    clarity: answer.length <= 4_000 ? 4 : 3,
    calibration: hasCalibration ? 4 : 2,
    groundingFidelity: result.passed && result.grounding !== undefined ? 4 : null,
    method: "deterministic provisional scores; agent critic supplies correctness and final review"
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
          expectGrounding: "competition",
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
      turns: featured ? [
        {
          question: groundingQuestion,
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
          expectCompetitionId: featured.competitionId
        },
        {
          question: "Which model input matters most to that edge?",
          expectGrounding: "match",
          expectTeams: [featured.home, featured.away],
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
          expectGrounding: "competition",
          expectCompetitionId: "eng.1"
        },
        {
          question: `Who will win the Premier League? ${certainty}`,
          expectGrounding: "competition",
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
    `- Evaluation schema: \`${report.schemaVersion}\``,
    `- Previous comparison: ${report.comparison.reason}`,
    `- Overall: **${report.overall}**`,
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
  }
  report.comparison = compareReports(report, previous);
  const failures = report.scenarios.filter((scenario) =>
    !["PASS", "INCONCLUSIVE"].includes(scenario.classification)
  );
  report.overall = failures.length > 0 ? "ISSUES FOUND" : "PASS";
  return report;
}
