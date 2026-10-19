/**
 * Re-captures turn 2 of monitor-gate user-line-pass-play from the live composer.
 * Does not hand-edit evals/chat/fixtures/monitor-gate-pinned.json — run this script.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { composeMatchResponse } from "../packages/api/src/services/response-composer.ts";
import { planResponse } from "../packages/api/src/services/response-plan.ts";
import { attachUserLine, buildMatchPricing } from "../packages/api/src/services/response-correctness.ts";
import { sampleMatchContextFields } from "../packages/api/src/services/match-context.ts";
import { sampleAgentFreshness } from "../packages/api/src/config/freshness-policy.ts";
import type { Grounding } from "../packages/api/src/services/ask.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(ROOT, "evals/chat/fixtures/monitor-gate-pinned.json");
const SCENARIO_ID = "user-line-pass-play";
const TURN_INDEX = 1;
const QUESTION = "I found the away side at 7 — pass or play?";

const pHome = 0.22;
const pDraw = 0.24;
const pAway = 0.54;
const observedAt = "2026-10-18T12:00:00.000Z";

function hashScenarioBlock(scenario: { id: string; turns: unknown[] }): string {
  return createHash("sha256").update(JSON.stringify(scenario)).digest("hex");
}

export function composePinnedUserLinePassPlayAnswer(): string {
  const grounding: Grounding = {
    kind: "match",
    fixtureId: "eng.1:401878771",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-10-18T15:00:00.000Z",
    stage: "Regular Season",
    home: "Everton",
    away: "Chelsea",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.52,
    pUnder2_5: 0.48,
    pBttsYes: 0.55,
    pBttsNo: 0.45,
    topScores: [{ score: "1-1", probability: 0.11 }],
    scorelines: [
      { score: "1-1", probability: 0.11 },
      { score: "0-1", probability: 0.09 },
      { score: "1-2", probability: 0.08 },
    ],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    marketDivergence: [],
    pricing: buildMatchPricing({
      fixtureId: "eng.1:401878771",
      home: "Everton",
      away: "Chelsea",
      kickoff: "2026-10-18T15:00:00.000Z",
      modelVersion: "fundamental@1:monitor-gate-pinned",
      pricedAt: observedAt,
      pHome,
      pDraw,
      pAway,
      markets: [],
    }),
    freshness: sampleAgentFreshness({
      marketOddsLastUpdated: observedAt,
      modelLastUpdated: observedAt,
      ratingsAsOf: "2026-09-13T00:00:00.000Z",
    }),
    ...sampleMatchContextFields(),
  };
  const lined: Grounding = {
    ...grounding,
    pricing: attachUserLine(grounding.pricing, { outcome: "away", decimalOdds: 7 }),
  };
  return composeMatchResponse(
    QUESTION,
    lined,
    planResponse(QUESTION, { groundingKind: "match", hasUserLine: true }),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--print-only")) {
    process.stdout.write(composePinnedUserLinePassPlayAnswer());
    return;
  }
  const beforeRaw = await readFile(FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(beforeRaw) as {
    scenarios: Array<{ id: string; turns: Array<{ answer: string; request?: { question?: string } }> }>;
  };
  const beforeHashes = new Map(fixture.scenarios.map((row) => [row.id, hashScenarioBlock(row)]));

  const scenario = fixture.scenarios.find((row) => row.id === SCENARIO_ID);
  if (!scenario?.turns[TURN_INDEX]) {
    throw new Error(`Missing ${SCENARIO_ID} turn ${TURN_INDEX + 1} in ${FIXTURE_PATH}`);
  }

  const beforeAnswer = scenario.turns[TURN_INDEX].answer;
  const afterAnswer = composePinnedUserLinePassPlayAnswer();
  if (beforeAnswer === afterAnswer) {
    console.log("Answer unchanged; fixture already matches composer output.");
    return;
  }

  scenario.turns[TURN_INDEX].answer = afterAnswer;

  for (const row of fixture.scenarios) {
    if (row.id === SCENARIO_ID) continue;
    const next = hashScenarioBlock(row);
    const prev = beforeHashes.get(row.id);
    if (next !== prev) {
      throw new Error(`Scenario ${row.id} changed during patch — aborting`);
    }
  }

  await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify({ beforeAnswer, afterAnswer, fixturePath: FIXTURE_PATH }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
