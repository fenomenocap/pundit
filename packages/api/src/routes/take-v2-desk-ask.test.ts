import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../services/__fixtures__/model-fixture";
import {
  answerQuestion,
  buildGrounding,
  closedGroundedAnswer,
  resolveAskContext,
} from "../services/ask";
import { clubRatingsAreCurrent, getCachedClubRatings, refreshClubRatingsForTest } from "../services/club-ratings";
import { getCachedModelData } from "../services/model-data";
import { espnFixtureIdentity } from "../services/fixture-registry";
import { replaceFootballDataForTests, replaceSeasonScheduleForTests } from "../services/football-data";
import { replaceModelDataForTests } from "../services/model-data";
import {
  resolvePunditTakeOverride,
  withPunditTakeRequestScope,
} from "../services/pundit-take/flags";
import { ensureHeaderV2AskAnswerNonEmpty } from "./ask";

const FIXTURE_ID = "espn:eng.1:401878767";

const CHELSEA_SPURS_DESK_PROMPTS = [
  "Who wins Chelsea v Tottenham?",
  "Why?",
  "Fair odds for Chelsea v Tottenham?",
  "Over 2.5 Chelsea v Tottenham?",
  "BTTS in Chelsea v Tottenham?",
  "Chelsea at 1.70, play or pass?",
  "What would flip this call for Chelsea v Tottenham?",
  "What about the draw?",
  "How much should I stake on Chelsea?",
] as const;

const LEGACY_DESK_MARKERS = /structured card|\bElo\b|Postecoglou|The server provides/i;

type HistoryTurn = { role: "user" | "assistant"; content: string };

function seedChelseaSpursModel() {
  const chelseaSpurs = fixture("Chelsea", "Tottenham", {
    fixtureId: 401878767,
    utcDate: "2026-10-25T17:30:00.000Z",
    date: "2026-10-25",
    pHome: 0.42,
    pDraw: 0.28,
    pAway: 0.30,
    stakePHome: 0.44,
    stakePDraw: 0.26,
    stakePAway: 0.30,
  });
  replaceModelDataForTests({
    fixtures: [chelseaSpurs],
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
  expect(espnFixtureIdentity(chelseaSpurs)).toBe(FIXTURE_ID);
}

function hasV2TakeSurface(answer: string): boolean {
  return /\|\s*Outcome\s*\|/.test(answer) || /\n\nModel /.test(answer);
}

async function deskAsk(
  question: string,
  history: HistoryTurn[],
  takeOverride: ReturnType<typeof resolvePunditTakeOverride>,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("test deadline")), 25_000);
  try {
    return await withPunditTakeRequestScope(takeOverride, async () => {
      const userLine = /\bplay or pass\b/i.test(question)
        ? { outcome: "home" as const, decimalOdds: 1.7 }
        : undefined;
      let result = await answerQuestion(
        question,
        history,
        undefined,
        controller.signal,
        { fixtureId: FIXTURE_ID },
        userLine,
        "desk",
      );
      result = ensureHeaderV2AskAnswerNonEmpty(question, takeOverride, result);
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}

describe("POST /api/ask desk + history with x-pundit-take v2", () => {
  const prevEnv = process.env;

  beforeEach(async () => {
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
    process.env = {
      ...prevEnv,
      PUNDIT_DATA_DIR: path.resolve(__dirname, "../../data"),
      PUNDIT_TAKE_V2: "false",
      OPENROUTER_API_KEY: "",
      MINIMAX_API_KEY: "",
      CHAT_ENGINE: "legacy",
      ANALYST_RESPONSE_V2: "true",
    };
    await refreshClubRatingsForTest(new Date("2026-10-20T12:00:00.000Z"));
    seedChelseaSpursModel();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = prevEnv;
  });

  it("seeds priced Chelsea v Spurs for fixtureContext routing", () => {
    expect(clubRatingsAreCurrent(getCachedClubRatings())).toBe(true);
    expect(getCachedModelData().fixtures.length).toBeGreaterThan(0);
    const ctx = resolveAskContext(
      "Who wins Chelsea v Tottenham?",
      [],
      undefined,
      getCachedModelData().fixtures,
      [],
      [],
      { fixtureContext: { fixtureId: FIXTURE_ID }, recognizedFixtures: [], now: Date.now(), modelInitialized: true, modelRefreshing: false, ratingsAvailable: true, missingRatingTeamIds: new Set() },
    );
    expect(ctx).toMatchObject({ tier: "match" });
  });

  it("closed grounded v2 take includes table for desk who-wins", () => {
    const takeOverride = resolvePunditTakeOverride("v2", false);
    withPunditTakeRequestScope(takeOverride, () => {
      const ctx = resolveAskContext(
        "Who wins Chelsea v Tottenham?",
        [],
        undefined,
        getCachedModelData().fixtures,
        [],
        [],
        { fixtureContext: { fixtureId: FIXTURE_ID }, recognizedFixtures: [], now: Date.now(), modelInitialized: true, modelRefreshing: false, ratingsAvailable: true, missingRatingTeamIds: new Set() },
      );
      if (ctx.tier !== "match") throw new Error(`expected match tier got ${JSON.stringify(ctx)}`);
      const grounding = buildGrounding(ctx.fixture);
      const closed = closedGroundedAnswer("Who wins Chelsea v Tottenham?", grounding, false);
      expect(closed).toMatch(/\|\s*Outcome\s*\|/);
    });
  });

  it("runs nine Chelsea v Spurs desk prompts with v2 table or footer each turn", async () => {
    const takeOverride = resolvePunditTakeOverride("v2", false);
    const history: HistoryTurn[] = [];
    for (const question of CHELSEA_SPURS_DESK_PROMPTS) {
      const result = await deskAsk(question, history, takeOverride);
      const answer = result.answer ?? "";
      expect(answer.trim().length, question).toBeGreaterThan(20);
      expect(hasV2TakeSurface(answer), question).toBe(true);
      expect(answer, question).not.toMatch(LEGACY_DESK_MARKERS);
      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: answer });
    }
  });

  it("no header desk who-wins uses the v2 take surface", async () => {
    const result = await deskAsk("Who wins Chelsea v Tottenham?", [], null);
    const answer = result.answer ?? "";
    expect(answer).toMatch(/\|\s*Outcome\s*\|/);
    expect(answer).not.toMatch(LEGACY_DESK_MARKERS);
  });

  it("no header desk conversation stays byte-identical across replays", async () => {
    const runOnce = async () => {
      const history: HistoryTurn[] = [];
      const answers: string[] = [];
      for (const question of CHELSEA_SPURS_DESK_PROMPTS) {
        const result = await deskAsk(question, history, null);
        const answer = result.answer ?? "";
        answers.push(answer);
        history.push({ role: "user", content: question });
        history.push({ role: "assistant", content: answer });
      }
      return answers;
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
  });
});
