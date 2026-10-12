import { afterEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { ownedLatestResult } from "./structured-results";
import { answerQuestion, answerQuestionStream } from "./ask";
import { getCachedMatches, replaceFootballDataForTests, replaceSeasonScheduleForTests, getCachedSeasonSchedule, type FootballMatch } from "./football-data";

const now = Date.parse("2026-10-06T02:00:00Z");
const match: FootballMatch = { id: 401879274, competitionId: "eng.1", competition: "Premier League", homeTeam: "Brighton", awayTeam: "Arsenal",
  utcDate: "2026-09-19T14:00:00Z", status: "FINISHED", stage: null, matchday: 5, group: null, score: { home: 3, away: 0 } };
const state = () => ({ upcoming: [], recent: [match], standings: [], lastUpdated: new Date(now), error: null, competitionErrors: {},
  byCompetition: { "eng.1": { upcoming: [], recent: [match], standings: [], error: null }, "uefa.champions_qual": { upcoming: [], recent: [], standings: [], error: null } } });
const season = () => ({ competitionId: "eng.1", seasonId: "2026-27", fixtures: [match], lastUpdated: new Date(now), error: null, servingLastGood: false });

describe("owned latest results", () => {
  afterEach(() => vi.useRealTimers());
  it.each(["What is Arsenal’s latest Premier League result?", "What is Arsenal's latest result in the Premier League?", "What's Arsenal's last EPL result?", "What was the most recent result for Arsenal in the Premier League?"])("answers natural explicit competition wording: %s", (q) => {
    const result = ownedLatestResult(q, state(), now, season());
    expect(result?.answer).toContain("Brighton 3–0 Arsenal");
    expect(result?.answer).toContain("Brighton won");
    expect(result?.answer).toContain("2026-09-19");
    expect(result?.citations[0].url).toBe("https://www.espn.com/soccer/match/_/gameId/401879274");
    expect(result?.answer).not.toContain("another cup");
  });
  it.each(["Did Arsenal win their last game?", "Did Arsenal lose the last match?", "did Arsenal draw their most recent fixture"])("answers yes/no last-game wording from the result: %s", (q) => {
    const result = ownedLatestResult(q, state(), now, season());
    expect(result?.answer).toContain("Brighton 3–0 Arsenal");
    expect(result?.answer).not.toContain("need a verified match report");
  });
  it("declines to explain why a last game ended as it did", () => {
    const result = ownedLatestResult("Why did Arsenal lose their last game?", state(), now, season());
    expect(result?.answer).toContain("Brighton 3–0 Arsenal");
    expect(result?.answer).toContain("need a verified match report to explain why");
  });
  it("leaves compound last-game questions to search", () => {
    expect(ownedLatestResult("Did Arsenal win their last game against Liverpool?", state(), now, season())).toBeNull();
    expect(ownedLatestResult("Did Arsenal win their last game and did Liverpool?", state(), now, season())).toBeNull();
  });
  it("states coverage and does not infer causes from the result", () => {
    const result = ownedLatestResult("What is Arsenal's latest result and why?", state(), now, season());
    expect(result?.answer).toContain("in my covered competitions");
    expect(result?.answer).toContain("another cup match may be more recent");
    expect(result?.answer).toContain("need a verified match report to explain why");
  });
  it("uses a fresh complete season during an international break with an empty rolling window", () => {
    const cached = state(); cached.recent = []; cached.byCompetition["eng.1"].recent = [];
    expect(ownedLatestResult("What is Arsenal's latest Premier League result?", cached, now, season())?.answer).toContain("Brighton 3–0 Arsenal");
    expect(ownedLatestResult("What is Arsenal's latest Premier League result?", cached, now,
      { ...season(), lastUpdated: new Date(now - 6 * 60 * 60 * 1000) })).toBeNull();
    expect(ownedLatestResult("What is Arsenal's latest Premier League result?", cached, now,
      { ...season(), servingLastGood: true })).toBeNull();
    expect(ownedLatestResult("What is Arsenal's latest Premier League result?", cached, now,
      { ...season(), seasonId: "2025-26" })).toBeNull();
  });
  it("returns the correct home orientation and draw rather than inferring a winner", () => {
    const cached = state(); cached.recent = [{ ...match, homeTeam: "Arsenal", awayTeam: "Brighton", score: { home: 0, away: 0 } }];
    expect(ownedLatestResult("What is Arsenal's latest result?", cached, now, { ...season(), fixtures: [] })?.answer).toContain("Arsenal 0–0 Brighton");
    expect(ownedLatestResult("What is Arsenal's latest result?", cached, now, { ...season(), fixtures: [] })?.answer).toContain("a draw");
  });
  it.each(["What is their latest result?", "Who won the league?", "What is Arsenal's latest result against Liverpool?", "What is Arsenal's latest result in 2025?", "What is Arsenal's latest result in the FA Cup?", "What is Arsenal's latest result and Liverpool's latest result?", "What is Arsenal's latest result and why does Liverpool press high?"])("leaves unsupported or compound scope to search: %s", (q) => {
    expect(ownedLatestResult(q, state(), now, season())).toBeNull();
  });
  it("fails closed on stale/future/failed caches and competing malformed final records", () => {
    const q = "What is Arsenal's latest result?";
    expect(ownedLatestResult(q, { ...state(), lastUpdated: new Date(now - 31 * 60 * 1000 - 1) }, now, season())).toBeNull();
    expect(ownedLatestResult(q, { ...state(), lastUpdated: new Date(now + 1) }, now, season())).toBeNull();
    expect(ownedLatestResult(q, { ...state(), competitionErrors: { "uefa.champions_qual": "failed" } }, now, season())).toBeNull();
    for (const newer of [{ ...match, id: 5, utcDate: "2026-10-05T14:00:00Z", score: { home: null, away: 0 } },
      { ...match, id: 5, utcDate: "invalid" }, { ...match, id: 5, utcDate: "19 Sep 2026" }, { ...match, id: 5 }, { ...match, id: 5, utcDate: "2026-10-07T00:00:00Z" },
      { ...match, id: 5, utcDate: "2026-10-05T14:00:00Z", score: { home: -1, away: 0 } }, { ...match, score: { home: 2, away: 0 } }]) {
      expect(ownedLatestResult(q, { ...state(), recent: [match, newer] }, now, season())).toBeNull();
    }
  });
  it("shares exact deterministic output/citation in JSON, desk and SSE without inference", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const prior = getCachedMatches(); const priorSeason = getCachedSeasonSchedule();
    replaceFootballDataForTests(state()); replaceSeasonScheduleForTests(season());
    const create = vi.spyOn(Anthropic.Messages.prototype, "create");
    try {
      const q = "What is Arsenal's latest Premier League result?";
      const json = await answerQuestion(q);
      const desk = await answerQuestion(q, [], undefined, undefined, undefined, undefined, "desk");
      const deltas: string[] = []; const groundings: unknown[] = [];
      const sse = await answerQuestionStream(q, [], undefined, { onGrounding: (g) => groundings.push(g), onDelta: (s) => deltas.push(s) });
      expect(sse).toEqual(json); expect(desk.citations).toEqual(json.citations);
      expect(deltas).toEqual([json.answer]); expect(groundings).toEqual([null]);
      expect(json.verification).toEqual({ status: "verified", supportedClaimCount: 1, removedClaimCount: 0 });
      expect(create).not.toHaveBeenCalled();
      const abort = new AbortController(); abort.abort(new Error("cancelled"));
      await expect(answerQuestion(q, [], undefined, abort.signal)).rejects.toThrow("cancelled");
    } finally { create.mockRestore(); replaceFootballDataForTests(prior); replaceSeasonScheduleForTests(priorSeason); }
  });
});
