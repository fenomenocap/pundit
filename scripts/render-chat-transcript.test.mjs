import assert from "node:assert/strict";
import test from "node:test";
import {
  nearDuplicateAnswers,
  renderTranscript,
  repeatedSentences,
  summarizeTranscript,
  transcriptTurns,
  uncitedCurrentNewsTurns,
} from "./render-chat-transcript.mjs";

const TEMPLATE = "The model makes this a genuinely open contest with no side clearly ahead of the other.";

function turn(question, answer, extra = {}) {
  return {
    turn: 1,
    request: { question },
    status: 200,
    latencyMs: 1000,
    grounding: { kind: "match" },
    capability: { status: "priced" },
    citations: [],
    verification: null,
    answer,
    assertions: {},
    ...extra,
  };
}

function report(scenarios) {
  return {
    runId: "2026-09-24T06-17-00-000Z",
    startedAt: "2026-09-24T06:17:00.000Z",
    overall: "PASS",
    progress: { status: "complete" },
    deployment: { sourceSha: "abcdef1234567", apiSha: "abcdef1234567" },
    scenarios,
  };
}

test("flags the same templated sentence across three scenarios even when the numbers differ", () => {
  const turns = transcriptTurns(report([
    { id: "a", classification: "PASS", turnResults: [turn("Arsenal vs Chelsea?", `Arsenal 54%. ${TEMPLATE}`)] },
    { id: "b", classification: "PASS", turnResults: [turn("Liverpool vs Fulham?", `Liverpool 61%. ${TEMPLATE}`)] },
    { id: "c", classification: "PASS", turnResults: [turn("Spurs vs Wolves?", `Spurs 48%. ${TEMPLATE}`)] },
  ]));
  const repeated = repeatedSentences(turns);
  assert.equal(repeated.length, 1);
  assert.deepEqual(repeated[0].scenarios, ["a", "b", "c"]);
});

test("does not flag a sentence that recurs in only two scenarios", () => {
  const turns = transcriptTurns(report([
    { id: "a", turnResults: [turn("Q1?", TEMPLATE)] },
    { id: "b", turnResults: [turn("Q2?", TEMPLATE)] },
  ]));
  assert.equal(repeatedSentences(turns).length, 0);
});

test("pairs near-identical answers to different questions but not the same question asked twice", () => {
  const body = "Arsenal press high and win the ball in the final third, then Saka isolates the full-back while Odegaard drifts into the half-space to create the overload that Chelsea struggle to cover.";
  const turns = transcriptTurns(report([
    { id: "a", turnResults: [turn("How do Arsenal win this?", body)] },
    { id: "b", turnResults: [turn("What is the tactical matchup?", body)] },
    { id: "c", turnResults: [turn("How do Arsenal win this?", body)] },
  ]));
  const pairs = nearDuplicateAnswers(turns);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((pair) => pair.a.question !== pair.b.question));
});

test("flags current-news questions that came back without citations", () => {
  const turns = transcriptTurns(report([
    { id: "news", turnResults: [turn("Any injury news for Arsenal?", "Nothing confirmed.")] },
    { id: "cited", turnResults: [turn("Latest team news for Chelsea?", "Palmer is fit.", { citations: [{ id: "S1" }] })] },
    { id: "table", turnResults: [turn("What does the table show?", "Liverpool lead.")] },
  ]));
  assert.deepEqual(uncitedCurrentNewsTurns(turns).map((entry) => entry.scenarioId), ["news"]);
});

test("summary is clean only when the run completed with no findings", () => {
  const clean = summarizeTranscript(report([
    { id: "a", classification: "PASS", turnResults: [turn("What does the table show?", "Liverpool lead on goal difference.")] },
  ]));
  assert.equal(clean.status, "clean");
  assert.equal(clean.passed, 1);

  const failed = summarizeTranscript(report([
    { id: "a", classification: "REGRESSION", evidence: "grounding=null", turnResults: [turn("Q?", "A.")] },
  ]));
  assert.equal(failed.status, "attention");
  assert.equal(failed.findings[0].scenario, "a");

  const stopped = summarizeTranscript({ ...report([]), progress: { status: "failed" } });
  assert.equal(stopped.status, "attention");
});

test("transcript quotes every question and answer", () => {
  const rendered = renderTranscript(report([
    { id: "a", classification: "PASS", turnResults: [turn("Preview Arsenal vs Chelsea", "Line one.\nLine two.")] },
  ]));
  assert.match(rendered, /\*\*Turn 1 · Q:\*\* Preview Arsenal vs Chelsea/);
  assert.match(rendered, /> Line one\.\n> Line two\./);
});
