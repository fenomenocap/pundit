import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const verified = { verification: { status: "verified" } };
  const turns = transcriptTurns(report([
    { id: "a", classification: "PASS", turnResults: [turn("Arsenal vs Chelsea?", `Arsenal 54%. ${TEMPLATE}`, verified)] },
    { id: "b", classification: "PASS", turnResults: [turn("Liverpool vs Fulham?", `Liverpool 61%. ${TEMPLATE}`, verified)] },
    { id: "c", classification: "PASS", turnResults: [turn("Spurs vs Wolves?", `Spurs 48%. ${TEMPLATE}`, verified)] },
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
    { id: "news", turnResults: [turn("Any injury news for Arsenal?", "Nothing confirmed.", { verification: { status: "verified" } })] },
    { id: "cited", turnResults: [turn("Latest team news for Chelsea?", "Palmer is fit.", { citations: [{ id: "S1" }], verification: { status: "verified" } })] },
    { id: "table", turnResults: [turn("What does the table show?", "Liverpool lead.")] },
  ]));
  assert.deepEqual(uncitedCurrentNewsTurns(turns).map((entry) => entry.scenarioId), ["news"]);
});

test("does not flag proper abstentions or deterministic model answers as uncited current news", () => {
  const turns = transcriptTurns(report([
    {
      id: "team-news-sourcing",
      turnResults: [turn(
        "Any injury or lineup news for Arsenal vs Leeds?",
        "I couldn't establish a verified, dated team-news update for this fixture, so I won't make an availability claim.",
        { verification: { status: "abstain" } },
      )],
    },
    {
      id: "replacing-is-not-epl",
      turnResults: [turn(
        "Who is replacing the injured manager?",
        "I need the manager and club before I can identify a replacement.",
        { verification: { status: "abstain" } },
      )],
    },
    {
      id: "analyst-conversation-golden-path",
      turnResults: [
        turn(
          "If the home striker is ruled out, exactly how many percentage points would you take off the home win?",
          "I can't quantify that lineup effect without verified team news and a revised forecast.",
          { verification: { status: "not-required" } },
        ),
        turn(
          "Back to that match: where do you disagree most with the available 1X2 market, and does the gap prove anything about lineups?",
          "On Arsenal, I am at 75.9% and Polymarket is at 70.8%.",
          { verification: { status: "not-required" } },
        ),
      ],
    },
  ]));
  assert.deepEqual(uncitedCurrentNewsTurns(turns), []);
});

test("does not flag repeated deterministic match or competition prose", () => {
  const template = "The leading scorelines are 2-0 (16.3%), 1-0 (14.1%), 3-0 (11.9%).";
  const tableRow = "**Man City** — 15 points from 5 matches, goal difference +8.";
  const turns = transcriptTurns(report([
    { id: "a", turnResults: [turn("Arsenal vs Leeds?", template, { verification: { status: "not-required" }, grounding: { kind: "match" } })] },
    { id: "b", turnResults: [turn("Preview Chelsea vs Fulham?", template, { verification: { status: "not-required" }, grounding: { kind: "match" } })] },
    { id: "c", turnResults: [turn("Analyse Spurs vs Wolves?", template, { verification: { status: "not-required" }, grounding: { kind: "match" } })] },
    { id: "d", turnResults: [turn("What does the current Premier League table show?", tableRow, { verification: { status: "not-required" }, grounding: { kind: "competition" } })] },
    { id: "e", turnResults: [turn("Quick detour: what does the current Premier League table show?", tableRow, { verification: { status: "not-required" }, grounding: { kind: "competition" } })] },
    { id: "f", turnResults: [turn("Table check?", tableRow, { verification: { status: "not-required" }, grounding: { kind: "competition" } })] },
  ]));
  assert.equal(repeatedSentences(turns).length, 0);
  assert.equal(nearDuplicateAnswers(turns).length, 0);
});

test("still flags repeated LLM-authored search-path prose", () => {
  const verified = { verification: { status: "verified" } };
  const turns = transcriptTurns(report([
    { id: "a", turnResults: [turn("Arsenal vs Chelsea?", `Arsenal 54%. ${TEMPLATE}`, verified)] },
    { id: "b", turnResults: [turn("Liverpool vs Fulham?", `Liverpool 61%. ${TEMPLATE}`, verified)] },
    { id: "c", turnResults: [turn("Spurs vs Wolves?", `Spurs 48%. ${TEMPLATE}`, verified)] },
  ]));
  assert.equal(repeatedSentences(turns).length, 1);
});

test("treats recovered intermittent scenarios as clean for the daily sweep gate", () => {
  const summary = summarizeTranscript(report([
    {
      id: "table-route-preserves-match",
      passed: true,
      outcome: "PASS",
      classification: "INTERMITTENT",
      evidence: "3 turn(s), grounding=match, fixture=espn:eng.1:401879268",
      turnResults: [turn("Back to that match: what will the 1X2 be?", "My 1X2 is Arsenal 75.9%, draw 17.9% and Leeds 6.2%.", { verification: { status: "not-required" } })],
    },
  ]));
  assert.equal(summary.status, "clean");
  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, 1);
});

test("regrades the 2026-09-28 daily sweep artifact as clean", () => {
  const fixturePath = path.resolve(__dirname, "../evals/chat/fixtures/2026-09-28-daily-sweep-attention-regression.json");
  const evalReport = JSON.parse(readFileSync(fixturePath, "utf8"));
  const summary = summarizeTranscript(evalReport);
  assert.equal(summary.status, "clean");
  assert.equal(summary.failed, 0);
  assert.equal(summary.repeatedSentences, 0);
  assert.equal(summary.nearDuplicatePairs, 0);
  assert.equal(summary.uncitedCurrentNews, 0);
  assert.equal(summary.findings.length, 0);
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
