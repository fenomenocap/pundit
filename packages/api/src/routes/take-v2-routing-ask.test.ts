import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerQuestion } from "../services/ask";
import { fixture } from "../services/__fixtures__/model-fixture";
import { replaceFootballDataForTests, replaceSeasonScheduleForTests } from "../services/football-data";
import { replaceModelDataForTests } from "../services/model-data";
import { composeMatchResponse } from "../services/response-composer";
import { planResponse } from "../services/response-plan";
import {
  resolvePunditTakeOverride,
  withPunditTakeRequestScope,
} from "../services/pundit-take/flags";
import { spursCoventryGrounding } from "../services/pundit-take/test-fixtures/spurs-coventry-grounding";
import { ensureHeaderV2AskAnswerNonEmpty } from "./ask";

const LEGACY_EV = /captured decimal line before I can print EV%/i;

const SWEEP_PROMPTS = {
  ipswich: {
    draw: "Will Ipswich Town vs Nottingham Forest be a draw?",
    guarantee: "Is Nottingham Forest a guaranteed win against Ipswich Town?",
    provenance: "Where do your numbers for Ipswich Town vs Nottingham Forest come from?",
  },
  arsenal: {
    draw: "Will Arsenal vs Everton be a draw?",
    guarantee: "Is Everton a guaranteed win against Arsenal?",
    provenance: "Where do your numbers for Arsenal vs Everton come from?",
  },
} as const;

/** Same non-streaming path as POST /api/ask after the v2 header scope and empty guard. */
async function askWithV2Header(question: string) {
  const takeOverride = resolvePunditTakeOverride("v2", false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("test deadline")), 20_000);
  try {
    return await withPunditTakeRequestScope(takeOverride, async () => {
      let result = await answerQuestion(
        question,
        [],
        undefined,
        controller.signal,
      );
      result = ensureHeaderV2AskAnswerNonEmpty(question, takeOverride, result);
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}

function seedFixtures() {
  const ipswichForest = fixture("Ipswich", "Nottingham Forest", {
    fixtureId: 401879901,
    utcDate: "2026-10-25T15:00:00.000Z",
    date: "2026-10-25",
    pHome: 0.266,
    pDraw: 0.275,
    pAway: 0.459,
    homeElo: 1694,
    awayElo: 1750,
  });
  const arsenalEverton = fixture("Arsenal", "Everton", {
    fixtureId: 401879902,
    utcDate: "2026-10-25T17:30:00.000Z",
    date: "2026-10-25",
    pHome: 0.62,
    pDraw: 0.22,
    pAway: 0.16,
    homeElo: 1920,
    awayElo: 1780,
  });
  replaceModelDataForTests({
    fixtures: [ipswichForest, arsenalEverton],
    lastUpdated: new Date(),
    error: null,
  });
  replaceSeasonScheduleForTests({
    competitionId: "eng.1",
    seasonId: "2026-27",
    fixtures: [],
    lastUpdated: new Date(),
    error: null,
    servingLastGood: false,
  });
  replaceFootballDataForTests({
    byCompetition: {},
    upcoming: [],
    recent: [],
    standings: [],
    lastUpdated: null,
    error: null,
    competitionErrors: {},
  });
}

describe("POST /api/ask v2 policy routing (sweep wording)", () => {
  const prevEnv = process.env;

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    process.env = {
      ...prevEnv,
      PUNDIT_DATA_DIR: path.resolve(__dirname, "../../data"),
      PUNDIT_TAKE_V2: "false",
      OPENROUTER_API_KEY: "",
      MINIMAX_API_KEY: "",
      CHAT_ENGINE: "legacy",
    };
    seedFixtures();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = prevEnv;
  });

  for (const [label, prompts] of Object.entries(SWEEP_PROMPTS)) {
    for (const [kind, question] of Object.entries(prompts)) {
      it(`header v2 ${label} ${kind}: ${question.slice(0, 48)}…`, async () => {
        const result = await askWithV2Header(question);
        const answer = result.answer ?? "";
        expect(answer.trim().length).toBeGreaterThan(20);
        expect(answer).not.toMatch(LEGACY_EV);
      });
    }
  }

  it("default path without v2 header stays byte-identical on a priced fixture", () => {
    const question = "Who wins Tottenham v Coventry?";
    const grounding = spursCoventryGrounding();
    const plan = planResponse(question, { groundingKind: "match", hasCompleteMarket1x2: true });
    const prev = process.env.PUNDIT_TAKE_V2;
    delete process.env.PUNDIT_TAKE_V2;
    try {
      const legacy = composeMatchResponse(question, grounding, plan);
      const scoped = withPunditTakeRequestScope(null, () => composeMatchResponse(question, grounding, plan));
      expect(scoped).toBe(legacy);
    } finally {
      if (prev === undefined) delete process.env.PUNDIT_TAKE_V2;
      else process.env.PUNDIT_TAKE_V2 = prev;
    }
  });
});
