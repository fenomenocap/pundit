#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import {
  EVAL_SCHEMA_VERSION,
  executeRuntimeHelperScenario,
  sanitizeEvidence,
} from "./chat-battle-test-lib.mjs";
import { gradeRecordedJsonScenario } from "./chat-eval-gate-lib.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const options = {
    fixturePath: path.join(ROOT, "evals/chat/fixtures/monitor-gate-pinned.json"),
    scenariosPath: path.join(ROOT, "evals/chat/scenarios.monitor.json"),
    mode: "assert-only",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--fixture") options.fixturePath = path.resolve(argv[++index]);
    else if (argument === "--scenarios") options.scenariosPath = path.resolve(argv[++index]);
    else if (argument === "--assert-only") options.mode = "assert-only";
    else if (argument === "--live-replay") options.mode = "live-replay";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function resolveScenarioTemplates(scenario, pinnedFeatured) {
  const home = pinnedFeatured.home;
  const away = pinnedFeatured.away;
  const clone = JSON.parse(JSON.stringify(scenario));
  if (clone.kind === "featured") {
    clone.kind = "json";
    clone.turns = [{
      question: `What does Pundit's model say about ${home} vs ${away}?`,
      expectGrounding: "match",
      expectTeams: [home, away],
      expectFixtureId: pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: pinnedFeatured.competitionId,
      expectHeadlineOneXTwo: clone.expectHeadlineOneXTwo,
    }];
  }
  if (clone.kind === "featured-question" && clone.questionTemplate) {
    const {
      questionTemplate,
      kind: _kind,
      id: _id,
      description: _description,
      ...turnExpectations
    } = clone;
    clone.kind = "json";
    clone.turns = [{
      expectGrounding: "match",
      expectTeams: [home, away],
      expectFixtureId: pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: pinnedFeatured.competitionId,
      question: questionTemplate.replaceAll("{home}", home).replaceAll("{away}", away),
      ...turnExpectations,
    }];
    delete clone.questionTemplate;
  }
  if (clone.kind === "featured-turns" && Array.isArray(clone.turns)) {
    clone.kind = "json";
    clone.turns = clone.turns.map((turn) => ({
      expectGrounding: "match",
      expectTeams: [home, away],
      expectFixtureId: pinnedFeatured.recognizedFixtureId,
      expectCompetitionId: pinnedFeatured.competitionId,
      ...turn,
    }));
  }
  if (clone.questionTemplate) {
    clone.question = clone.questionTemplate.replaceAll("{home}", home).replaceAll("{away}", away);
  }
  if (Array.isArray(clone.turns)) {
    clone.turns = clone.turns.map((turn) => {
      const next = { ...turn };
      if (next.questionTemplate) {
        next.question = next.questionTemplate.replaceAll("{home}", home).replaceAll("{away}", away);
      }
      if (next.expectCurrentManager?.team === "{home}") {
        next.expectCurrentManager = { team: home };
      }
      if (next.expectLatestResult?.team === "{home}") {
        next.expectLatestResult = { ...next.expectLatestResult, team: home };
      }
      return next;
    });
  }
  clone.__home = home;
  clone.__away = away;
  if (pinnedFeatured.recognizedFixtureId && !clone.fixtureContext) {
    clone.fixtureContext = { fixtureId: pinnedFeatured.recognizedFixtureId };
    clone.teamContext = [home, away];
  }
  return clone;
}

function gradeRuntimeHelperScenario(scenario) {
  const actual = executeRuntimeHelperScenario(scenario, ROOT);
  const serialized = JSON.stringify(actual);
  const assertions = {
    exactRuntimeResult: Array.isArray(scenario.expect)
      ? serialized === JSON.stringify(scenario.expect)
      : Object.entries(scenario.expect ?? {}).every(([key, value]) =>
        JSON.stringify(actual?.[key]) === JSON.stringify(value)
      ),
    requiredText: !scenario.expectText || scenario.expectText.every((text) => serialized.includes(text)),
    forbiddenText: !scenario.forbidText || scenario.forbidText.every((text) => !serialized.includes(text)),
  };
  const passed = Object.values(assertions).every(Boolean);
  return {
    id: scenario.id,
    passed,
    outcome: passed ? "PASS" : "FAIL",
    assertions,
    evidence: passed
      ? `Runtime helper ${scenario.helper} passed.`
      : `Runtime helper ${scenario.helper} mismatch: ${sanitizeEvidence(actual)}.`,
  };
}

async function runAssertOnly(fixture, scenarios) {
  const recordings = new Map(fixture.scenarios.map((row) => [row.id, row]));
  const results = [];
  for (const definition of scenarios) {
    if (definition.kind === "runtime-helper") {
      results.push(gradeRuntimeHelperScenario(definition));
      continue;
    }
    const recorded = recordings.get(definition.id);
    if (!recorded) {
      throw new Error(`Pinned fixture is missing recorded turns for monitor scenario ${definition.id}`);
    }
    const resolved = resolveScenarioTemplates(definition, fixture.pinnedFeatured);
    const graded = gradeRecordedJsonScenario(resolved, recorded.turns, {
      evaluationNow: Date.parse(fixture.evaluationNow ?? fixture.recordedAt),
    });
    results.push(graded);
  }
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(options.fixturePath, "utf8"));
  const scenarioConfig = JSON.parse(await readFile(options.scenariosPath, "utf8"));
  if (scenarioConfig.schemaVersion !== EVAL_SCHEMA_VERSION) {
    throw new Error(`Scenario schema ${scenarioConfig.schemaVersion} does not match evaluator ${EVAL_SCHEMA_VERSION}.`);
  }
  if (fixture.schemaVersion !== 1) {
    throw new Error(`Pinned gate fixture schema ${fixture.schemaVersion} is unsupported.`);
  }
  const scenarioIds = new Set(scenarioConfig.fixed.map(({ id }) => id));
  for (const recorded of fixture.scenarios) {
    if (!scenarioIds.has(recorded.id)) {
      throw new Error(`Pinned fixture includes ${recorded.id}, which is not in the monitor manifest.`);
    }
  }
  for (const definition of scenarioConfig.fixed) {
    if (definition.kind === "runtime-helper") continue;
    if (!fixture.scenarios.some((row) => row.id === definition.id)) {
      throw new Error(`Pinned fixture must record turns for monitor scenario ${definition.id}`);
    }
  }

  if (options.mode !== "assert-only") {
    throw new Error("Only --assert-only is implemented in CI; use chat-battle-test.mjs with --search-replay-id for live replay.");
  }

  const results = await runAssertOnly(fixture, scenarioConfig.fixed);
  const failures = results.filter((row) => row.outcome !== "PASS");
  console.log(JSON.stringify({
    mode: options.mode,
    replayId: fixture.searchReplayId,
    pinnedFeatured: fixture.pinnedFeatured,
    scenarios: results.length,
    passed: results.filter((row) => row.outcome === "PASS").length,
    failed: failures.map(({ id, evidence }) => ({ id, evidence })),
    overall: failures.length === 0 ? "PASS" : "FAIL",
  }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`pinned chat-eval gate failed: ${error.message}`);
  process.exitCode = 1;
});
