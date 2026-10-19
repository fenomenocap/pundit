#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  compareEngineQuality,
  computeTurnQualityMetrics,
  summarizeLlmJudge,
} from "./chat-eval-quality-metrics.mjs";
import { resolveJudgeEvalTurns, skippedNoKeyJudge, resolveJudgeMode } from "./chat-eval-llm-judge.mjs";
import { writeReport } from "./chat-battle-test-lib.mjs";

function flattenReportTurns(report) {
  const turns = [];
  for (const scenario of report?.scenarios ?? []) {
    for (const turn of scenario.turnResults ?? []) {
      turns.push({
        scenarioId: scenario.id,
        turn: turn.turn,
        question: turn.request?.question ?? null,
        httpStatus: turn.status,
        answer: turn.answer,
        verification: turn.verification,
        citations: turn.citations,
        usedLlm: turn.usedLlm,
        engine: turn.engine,
      });
    }
  }
  return turns;
}

export async function mergeDualEngineChatEvalReports(legacy, agent, outputPath) {
  const legacyTurns = flattenReportTurns(legacy);
  const agentTurns = flattenReportTurns(agent);

  const merged = {
    ...legacy,
    requestEngine: "both",
    agentEval: {
      runId: agent.runId,
      overall: agent.overall,
      qualityMetrics: agent.qualityMetrics ?? computeTurnQualityMetrics(agentTurns),
      llmJudgeSummary: agent.llmJudgeSummary ?? summarizeLlmJudge(agent),
      scenarioCount: agent.scenarios?.length ?? 0,
    },
    qualityMetrics: legacy.qualityMetrics ?? computeTurnQualityMetrics(legacyTurns),
    llmJudgeSummary: legacy.llmJudgeSummary ?? summarizeLlmJudge(legacy),
    engineQualityComparison: compareEngineQuality(legacyTurns, agentTurns),
  };

  const judgeNeedsRerun = (judge) => !judge?.scoredTurns
    || (judge.judgedTurns > 0 && judge.scoredTurns === 0);

  const judgeMode = resolveJudgeMode(process.env.CHAT_EVAL_JUDGE_MODE);
  const hasLocalJudgeKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const hasRemoteJudge = judgeMode === "remote"
    && Boolean(process.env.CHAT_EVAL_INTERNAL_TOKEN?.trim());
  const judgeAvailable = judgeMode === "off"
    ? false
    : judgeMode === "remote"
      ? hasRemoteJudge
      : hasLocalJudgeKey;
  const judgeOptions = { maxTurns: 24, paceMs: 250, judgeMode };

  if (!judgeAvailable) {
    merged.llmJudge = skippedNoKeyJudge(legacyTurns, { maxTurns: 24 });
    merged.llmJudgeSummary = summarizeLlmJudge(merged);
    merged.agentEval.llmJudge = skippedNoKeyJudge(agentTurns, { maxTurns: 24 });
    merged.agentEval.llmJudgeSummary = summarizeLlmJudge({ llmJudge: merged.agentEval.llmJudge });
  } else {
    if (judgeNeedsRerun(legacy.llmJudge)) {
      merged.llmJudge = await resolveJudgeEvalTurns(legacyTurns, judgeOptions);
      merged.llmJudgeSummary = summarizeLlmJudge(merged);
    }
    if (judgeNeedsRerun(agent.llmJudge)) {
      merged.agentEval.llmJudge = await resolveJudgeEvalTurns(agentTurns, judgeOptions);
      merged.agentEval.llmJudgeSummary = summarizeLlmJudge({ llmJudge: merged.agentEval.llmJudge });
    }
  }

  await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
  const outputDir = path.dirname(outputPath);
  await writeReport(merged, outputDir);
  return merged;
}

async function main() {
  const [legacyPath, agentPath, outputPath] = process.argv.slice(2);
  if (!legacyPath || !agentPath || !outputPath) {
    throw new Error("usage: merge-dual-engine-chat-eval.mjs <legacy-run.json> <agent-run.json> <out-run.json>");
  }
  const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
  const agent = JSON.parse(await readFile(agentPath, "utf8"));
  const merged = await mergeDualEngineChatEvalReports(legacy, agent, outputPath);
  console.log(JSON.stringify({
    outputPath,
    legacyOverall: legacy.overall,
    agentOverall: agent.overall,
    engineQualityComparison: merged.engineQualityComparison,
    legacyJudge: merged.llmJudgeSummary,
    agentJudge: merged.agentEval.llmJudgeSummary,
  }, null, 2));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
