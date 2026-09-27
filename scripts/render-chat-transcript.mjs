#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

// Questions that name something only the live web can answer. A turn like this
// that comes back without a single citation answered from memory or not at all.
const CURRENT_NEWS_CUE = /\b(injur\w*|lineups?|line-up|team news|suspen\w*|manager|sacked|transfer\w*|latest|news|fitness|doubt\w*|ruled out|available|availability|starting xi|press conference)\b/i;

const MIN_SENTENCE_CHARS = 40;
const REPEATED_SENTENCE_MIN_SCENARIOS = 3;
const NEAR_DUPLICATE_THRESHOLD = 0.6;

export function transcriptTurns(report) {
  const turns = [];
  for (const scenario of report?.scenarios ?? []) {
    for (const turn of scenario.turnResults ?? []) {
      turns.push({
        scenarioId: scenario.id,
        category: scenario.category ?? "fixed",
        classification: scenario.classification ?? scenario.outcome ?? null,
        turn: turn.turn,
        question: turn.request?.question ?? null,
        answer: typeof turn.answer === "string" ? turn.answer : "",
        status: turn.status ?? null,
        latencyMs: turn.latencyMs ?? null,
        groundingKind: turn.grounding?.kind ?? null,
        capability: turn.capability?.status ?? null,
        citations: Array.isArray(turn.citations) ? turn.citations.length : 0,
        verification: turn.verification?.status ?? null,
        failedAssertions: Object.entries(turn.assertions ?? {})
          .filter(([, passed]) => passed === false)
          .map(([name]) => name),
      });
    }
  }
  return turns;
}

function normalizeSentence(sentence) {
  return sentence
    .toLowerCase()
    .replace(/\d+(\.\d+)?%?/g, "#")
    .replace(/[^a-z# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSentences(text) {
  return String(text ?? "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_CHARS);
}

// Numbers are masked before comparing, so "Arsenal 54%" and "Chelsea 31%"
// built from the same template count as one repeated sentence. That is the
// canned-prose shape this detector exists to surface.
export function repeatedSentences(turns, minScenarios = REPEATED_SENTENCE_MIN_SCENARIOS) {
  const byKey = new Map();
  for (const turn of turns) {
    for (const sentence of splitSentences(turn.answer)) {
      const key = normalizeSentence(sentence);
      if (key.length < MIN_SENTENCE_CHARS) continue;
      const entry = byKey.get(key) ?? { example: sentence, scenarios: new Set(), occurrences: 0 };
      entry.scenarios.add(turn.scenarioId);
      entry.occurrences += 1;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .filter((entry) => entry.scenarios.size >= minScenarios)
    .map((entry) => ({
      example: entry.example,
      scenarios: [...entry.scenarios].sort(),
      occurrences: entry.occurrences,
    }))
    .sort((a, b) => b.scenarios.length - a.scenarios.length || b.occurrences - a.occurrences);
}

function shingles(text) {
  const words = normalizeSentence(text).split(" ").filter(Boolean);
  const set = new Set();
  for (let index = 0; index + 3 <= words.length; index += 1) {
    set.add(words.slice(index, index + 3).join(" "));
  }
  return set;
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// Two different questions answered with substantially the same text.
export function nearDuplicateAnswers(turns, threshold = NEAR_DUPLICATE_THRESHOLD) {
  const candidates = turns
    .filter((turn) => turn.answer.length >= 120 && turn.question)
    .map((turn) => ({ turn, shingles: shingles(turn.answer) }));
  const pairs = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (normalizeSentence(a.turn.question) === normalizeSentence(b.turn.question)) continue;
      const similarity = jaccard(a.shingles, b.shingles);
      if (similarity >= threshold) {
        pairs.push({
          similarity: Math.round(similarity * 100) / 100,
          a: { scenarioId: a.turn.scenarioId, turn: a.turn.turn, question: a.turn.question },
          b: { scenarioId: b.turn.scenarioId, turn: b.turn.turn, question: b.turn.question },
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

export function uncitedCurrentNewsTurns(turns) {
  return turns
    .filter((turn) => turn.question && CURRENT_NEWS_CUE.test(turn.question) && turn.citations === 0)
    .map(({ scenarioId, turn, question, verification }) => ({ scenarioId, turn, question, verification }));
}

export function summarizeTranscript(report, { runDate } = {}) {
  const turns = transcriptTurns(report);
  const scenarios = report?.scenarios ?? [];
  const passed = scenarios.filter((scenario) => (scenario.classification ?? scenario.outcome) === "PASS").length;
  const inconclusive = scenarios.filter((scenario) => (scenario.classification ?? scenario.outcome) === "INCONCLUSIVE").length;
  const failedScenarios = scenarios.filter((scenario) =>
    !["PASS", "INCONCLUSIVE"].includes(scenario.classification ?? scenario.outcome)
  );
  const repeated = repeatedSentences(turns);
  const nearDuplicates = nearDuplicateAnswers(turns);
  const uncited = uncitedCurrentNewsTurns(turns);
  const answeredTurns = turns.filter((turn) => turn.answer.length > 0);
  const findings = [
    ...failedScenarios.map((scenario) => ({
      scenario: scenario.id,
      summary: `${scenario.classification ?? scenario.outcome}: ${String(scenario.evidence ?? "").slice(0, 400)}`,
    })),
    ...repeated.slice(0, 5).map((entry) => ({
      scenario: "repetition",
      summary: `Same sentence in ${entry.scenarios.length} scenarios: "${entry.example.slice(0, 200)}"`,
    })),
    ...nearDuplicates.slice(0, 5).map((pair) => ({
      scenario: "near-duplicate",
      summary: `${Math.round(pair.similarity * 100)}% overlap between answers to "${pair.a.question}" and "${pair.b.question}"`,
    })),
    ...uncited.map((turn) => ({
      scenario: turn.scenarioId,
      summary: `Current-news question answered with no citations: "${turn.question}"`,
    })),
  ];
  const progressStatus = report?.progress?.status ?? null;
  let status = "clean";
  if (progressStatus !== "complete") status = "attention";
  if (findings.length > 0) status = "attention";
  return {
    date: runDate ?? String(report?.startedAt ?? "").slice(0, 10),
    runId: report?.runId ?? null,
    status,
    overall: report?.overall ?? null,
    progress: progressStatus,
    scenariosRun: scenarios.length,
    passed,
    inconclusive,
    failed: failedScenarios.length,
    turns: turns.length,
    answeredTurns: answeredTurns.length,
    turnsWithCitations: turns.filter((turn) => turn.citations > 0).length,
    medianLatencyMs: median(turns.map((turn) => turn.latencyMs).filter(Number.isFinite)),
    repeatedSentences: repeated.length,
    nearDuplicatePairs: nearDuplicates.length,
    uncitedCurrentNews: uncited.length,
    findings,
    sourceCommit: report?.deployment?.sourceSha?.slice(0, 7) ?? null,
    apiSha: report?.deployment?.apiSha?.slice(0, 7) ?? null,
    ranAt: report?.startedAt ?? null,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function quote(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderTranscript(report, summary = summarizeTranscript(report)) {
  const turns = transcriptTurns(report);
  const lines = [
    `# Pundit chat transcript — ${summary.date}`,
    "",
    `- Run \`${summary.runId}\` · overall **${summary.overall ?? "n/a"}** · progress ${summary.progress ?? "n/a"}`,
    `- API \`${summary.apiSha ?? "?"}\` · scenarios ${summary.scenariosRun} (pass ${summary.passed}, inconclusive ${summary.inconclusive}, fail ${summary.failed})`,
    `- Turns ${summary.turns} · answered ${summary.answeredTurns} · with citations ${summary.turnsWithCitations} · median latency ${summary.medianLatencyMs ?? "n/a"} ms`,
    `- Quality signals: ${summary.repeatedSentences} repeated sentence(s), ${summary.nearDuplicatePairs} near-duplicate answer pair(s), ${summary.uncitedCurrentNews} uncited current-news turn(s)`,
    "",
    "## Findings",
    "",
    ...(summary.findings.length
      ? summary.findings.map((finding, index) => `${index + 1}. **${finding.scenario}** — ${finding.summary}`)
      : ["None."]),
    "",
    "## Conversations",
    "",
  ];
  let currentScenario = null;
  for (const turn of turns) {
    if (turn.scenarioId !== currentScenario) {
      currentScenario = turn.scenarioId;
      lines.push(`### ${turn.scenarioId} — ${turn.classification ?? "n/a"} (${turn.category})`, "");
    }
    lines.push(
      `**Turn ${turn.turn} · Q:** ${turn.question ?? "(no question)"}`,
      "",
      `_grounding=${turn.groundingKind ?? "none"} · capability=${turn.capability ?? "n/a"} · citations=${turn.citations} · verification=${turn.verification ?? "n/a"} · HTTP ${turn.status ?? "?"} · ${turn.latencyMs ?? "?"} ms_`,
      "",
      turn.answer ? quote(turn.answer) : "> _(empty answer)_",
      "",
    );
    if (turn.failedAssertions.length) {
      lines.push(`Failed assertions: ${turn.failedAssertions.join(", ")}`, "");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [reportPath, transcriptPath, summaryPath, runDate] = process.argv.slice(2);
  if (!reportPath || !transcriptPath || !summaryPath) {
    throw new Error("usage: render-chat-transcript.mjs <report.json> <transcript.md> <summary.json> [YYYY-MM-DD]");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const summary = summarizeTranscript(report, { runDate });
  await writeFile(transcriptPath, renderTranscript(report, summary));
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    status: summary.status,
    scenariosRun: summary.scenariosRun,
    failed: summary.failed,
    repeatedSentences: summary.repeatedSentences,
    nearDuplicatePairs: summary.nearDuplicatePairs,
    uncitedCurrentNews: summary.uncitedCurrentNews,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`render-chat-transcript failed: ${error.message}`);
    process.exitCode = 1;
  });
}
