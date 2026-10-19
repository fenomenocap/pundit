import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeSearchReplayQuery } from "./chat-eval-search-replay.mjs";
import { gradeRecordedJsonScenario } from "./chat-eval-gate-lib.mjs";

test("normalizeSearchReplayQuery lowercases and trims", () => {
  assert.equal(normalizeSearchReplayQuery("  Everton Manager TODAY  "), "everton manager today");
});

test("monitor gate fixture revalidates manager and dated club news turns", () => {
  const fixturePath = path.resolve(import.meta.dirname, "../evals/chat/fixtures/monitor-gate-pinned.json");
  const scenariosPath = path.resolve(import.meta.dirname, "../evals/chat/scenarios.monitor.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { fixed } = JSON.parse(readFileSync(scenariosPath, "utf8"));
  const manager = fixed.find((row) => row.id === "pinned-current-manager-and-result-evidence");
  const news = fixed.find((row) => row.id === "dated-club-news-delivers-supported-update");
  const managerRecording = fixture.scenarios.find((row) => row.id === manager.id);
  const newsRecording = fixture.scenarios.find((row) => row.id === news.id);
  const home = fixture.pinnedFeatured.home;
  const resolvedManager = {
    ...manager,
    kind: "json",
    __home: home,
    turns: manager.turns.map((turn) => ({
      expectGrounding: turn.expectGrounding === "match" ? "match" : turn.expectGrounding,
      expectTeams: [home, fixture.pinnedFeatured.away],
      expectFixtureId: fixture.pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: fixture.pinnedFeatured.competitionId,
      ...turn,
      expectCurrentManager: turn.expectCurrentManager
        ? { team: home }
        : undefined,
      expectLatestResult: turn.expectLatestResult
        ? { ...turn.expectLatestResult, team: home }
        : undefined,
      question: turn.questionTemplate.replaceAll("{home}", home).replaceAll("{away}", fixture.pinnedFeatured.away),
    })),
  };
  const resolvedNews = {
    ...news,
    kind: "json",
    __home: home,
    turns: news.turns.map((turn) => ({
      expectGrounding: "match",
      expectTeams: [home, fixture.pinnedFeatured.away],
      expectFixtureId: fixture.pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: fixture.pinnedFeatured.competitionId,
      ...turn,
      question: turn.questionTemplate.replaceAll("{home}", home).replaceAll("{away}", fixture.pinnedFeatured.away),
    })),
  };
  const now = Date.parse(fixture.evaluationNow);
  assert.equal(gradeRecordedJsonScenario(resolvedManager, managerRecording.turns, { evaluationNow: now }).outcome, "PASS");
  assert.equal(gradeRecordedJsonScenario(resolvedNews, newsRecording.turns, { evaluationNow: now }).outcome, "PASS");
});

test("Everton structural manager replay grades fixed-club scenario", () => {
  const fixturePath = path.resolve(import.meta.dirname, "../evals/chat/fixtures/monitor-gate-everton-structural-v1.json");
  const scenariosPath = path.resolve(import.meta.dirname, "../evals/chat/scenarios.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const { fixed } = JSON.parse(readFileSync(scenariosPath, "utf8"));
  const scenario = fixed.find((row) => row.id === "pinned-current-manager-everton-fixed");
  const recording = fixture.scenarios.find((row) => row.id === scenario.id);
  const home = fixture.pinnedFeatured.home;
  const resolved = {
    ...scenario,
    kind: "json",
    __home: home,
    turns: scenario.turns.map((turn) => ({
      expectGrounding: turn.expectGrounding === "match" ? "match" : turn.expectGrounding,
      expectTeams: [home, fixture.pinnedFeatured.away],
      expectFixtureId: fixture.pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: fixture.pinnedFeatured.competitionId,
      ...turn,
      expectCurrentManager: turn.expectCurrentManager
        ? { team: home }
        : undefined,
    })),
  };
  const now = Date.parse(fixture.evaluationNow);
  assert.equal(gradeRecordedJsonScenario(resolved, recording.turns, { evaluationNow: now }).outcome, "PASS");
});
