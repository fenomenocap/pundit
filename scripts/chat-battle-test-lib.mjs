import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const EVAL_SCHEMA_VERSION = 4;
export const MIN_REQUEST_INTERVAL_MS = 13_000;
export const FEATURED_STAGES = new Set(["semifinals", "3rd-place-match", "final"]);

export function isKnownTeam(team) {
  return typeof team === "string"
    && team.trim().toLowerCase() !== "tbd"
    && !/\b(?:winner|loser)\b/i.test(team);
}

export function selectFeaturedMatch(matches = []) {
  return matches.find((match) =>
    FEATURED_STAGES.has(match.stage)
    && ["SCHEDULED", "IN_PLAY"].includes(match.status)
    && isKnownTeam(match.homeTeam)
    && isKnownTeam(match.awayTeam)
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

export function validateSse(events, expectedGrounding) {
  const types = events.map(({ event }) => event);
  const groundingIndex = types.indexOf("grounding");
  const firstDeltaIndex = types.indexOf("delta");
  const doneIndex = types.lastIndexOf("done");
  const grounding = groundingIndex >= 0 ? events[groundingIndex].payload?.grounding : undefined;
  const assertions = {
    groundingFirst: groundingIndex === 0,
    hasDelta: firstDeltaIndex > groundingIndex,
    doneLast: doneIndex === events.length - 1 && doneIndex > firstDeltaIndex,
    groundingKind: (grounding?.kind ?? null) === expectedGrounding,
  };
  return { passed: Object.values(assertions).every(Boolean), assertions, grounding };
}

export function sanitizeEvidence(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/(api[_-]?key|authorization|token|secret)\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 2_000);
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
    groundingFidelity: result.grounding === null ? 4 : result.grounding ? 4 : null,
    method: "deterministic provisional scores; agent critic supplies correctness and final review"
  };
}

export function classifyResult(current, previous, comparable = true) {
  if (current.outcome === "INCONCLUSIVE") return "INCONCLUSIVE";
  if (current.passed) {
    return previous && comparable && previous.passed === false ? "INTERMITTENT" : "PASS";
  }
  if (!previous || !comparable) return "EXISTING ISSUE";
  if (previous.passed) return "REGRESSION";
  if (previous.classification === "PASS") return "REGRESSION";
  return "EXISTING ISSUE";
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
  const previousDeployment = previous.deployment?.id;
  const currentDeployment = current.deployment?.id;
  const knownDeployments = previousDeployment && currentDeployment
    && previousDeployment !== "unknown" && currentDeployment !== "unknown";
  const comparable = sameSchema && (!knownDeployments || previousDeployment === currentDeployment);
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
      : knownDeployments && previousDeployment !== currentDeployment
        ? "deployment changed"
        : "same evaluation contract",
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
    ? `Compare ${featured.homeTeam} and ${featured.awayTeam} using only Pundit's current model evidence.`
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
        { question: "Rank the leading contenders for the 2026 World Cup.", expectGrounding: "tournament" },
        { question: `Given that ranking, who will win the World Cup, and ${followUp}`, expectGrounding: "tournament" }
      ]
    },
    {
      id: "adversarial-grounding",
      generationSeed: seed,
      category: "grounding",
      kind: featured ? "json" : "inconclusive",
      reason: featured ? undefined : "no active featured fixture",
      teamContext: featured ? [featured.homeTeam, featured.awayTeam] : undefined,
      turns: featured ? [
        { question: groundingQuestion, expectGrounding: "match" },
        { question: "Which model input matters most to that edge?", expectGrounding: "match" }
      ] : []
    },
    {
      id: "adversarial-certainty",
      generationSeed: seed,
      category: "unsupported-certainty",
      kind: "certainty",
      turns: [
        { question: "Who is most likely to win the 2026 World Cup?", expectGrounding: "tournament" },
        { question: `Who will win the World Cup? ${certainty}`, expectGrounding: "tournament" }
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
  return { jsonPath: `${base}.json`, markdownPath: `${base}.md` };
}

export function finalizeClassifications(report, previous) {
  const deploymentComparable = !previous
    || (previous.schemaVersion === report.schemaVersion
      && (previous.deployment?.id === "unknown"
        || report.deployment?.id === "unknown"
        || previous.deployment?.id === report.deployment?.id));
  const previousById = new Map((previous?.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  for (const scenario of report.scenarios) {
    scenario.classification = classifyResult(
      scenario,
      previousById.get(scenario.id),
      deploymentComparable
    );
  }
  report.comparison = compareReports(report, previous);
  const failures = report.scenarios.filter((scenario) =>
    !["PASS", "INCONCLUSIVE"].includes(scenario.classification)
  );
  report.overall = failures.length > 0 ? "ISSUES FOUND" : "PASS";
  return report;
}
