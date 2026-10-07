import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { sampleAgentFreshness } from "../config/freshness-policy";
import type { Grounding } from "./ask";
import { sampleMatchContextFields } from "./match-context";
import {
  DESK_SYSTEM,
  DESK_GENERAL_CONCEPT_SYSTEM,
  datedClubNewsExcerpt,
  writeDeskProse,
  renderDatedClubNewsRecords,
  card,
  composeDeskFootballTake,
  deskProseIsCurrentNewsRemainder,
  stripSurplusCurrentNewsNotices,
  filterDeskEvidenceRows,
  formatSearchEvidence,
  formatManagerEvidence,
  formatDeskCitationDate,
  humaniseDeskCitationDates,
  sanitizeDeskModelProse,
  sanitizeDeskFootballHypotheses,
  shouldRestoreDeskFootballTake,
  stripDeskBoardRecitals,
} from "./desk-voice";
import { composeDeskTakeOutline } from "./response-composer";
import { buildMatchPricing } from "./response-correctness";

function match(over: Partial<Grounding> = {}): Grounding {
  const pHome = 0.82;
  const pDraw = 0.13;
  const pAway = 0.05;
  return {
    kind: "match",
    fixtureId: "espn:eng.1:city",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-13",
    stage: "match",
    home: "Manchester City",
    away: "Sunderland",
    pHome,
    pDraw,
    pAway,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.4,
    pBttsNo: 0.6,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    pricing: buildMatchPricing({
      fixtureId: "espn:eng.1:city",
      home: "Manchester City",
      away: "Sunderland",
      kickoff: "2026-09-13",
      pricedAt: "2026-09-11T03:00:00.000Z",
      pHome,
      pDraw,
      pAway,
    }),
    marketDivergence: [],
    freshness: sampleAgentFreshness(),
    ...sampleMatchContextFields({
      homeElo: 1950,
      awayElo: 1520,
      homeForm: ["W", "W", "D"],
      awayForm: ["L", "D", "L"],
      homeTable: { position: 2, points: 10, goalDifference: 6, playedGames: 4 },
      awayTable: { position: 18, points: 2, goalDifference: -5, playedGames: 4 },
    }),
    ...over,
  };
}

const NOW = Date.parse("2026-09-11T03:00:00.000Z");

describe("bounded dated club-news expression", () => {
  const newsNow = Date.parse("2026-10-06T02:00:00Z");
  const newsGrounding = match({ home: "Arsenal", away: "Leeds", date: "2026-10-10" });
  const newsSources = [{ id: "S10", title: "Arsenal injury update", url: "https://www.standard.co.uk/report",
    date: "2026-10-05T09:42:23Z", tier: "news" as const,
    snippet: "Arsenal injury update: Christos Tzolis had a hamstring injury while representing Greece on Thursday, October 1. Ben White was back in training. Kai Havertz had a hamstring issue." }];
  const newsRow = { sourceId: "S10", club: "Arsenal", playerName: "Christos Tzolis", statusText: "was sidelined with a hamstring injury" };
  const newsJson = (row: Record<string, unknown> = newsRow) => JSON.stringify({ updates: [row] });

  it("labels the immutable source publication date without converting it into the injury date", () => {
    const answer = renderDatedClubNewsRecords(newsJson(), newsSources, newsGrounding, newsNow);
    expect(answer).toBe("In an update published on 2026-10-05, Arsenal’s Christos Tzolis was sidelined with a hamstring injury [[S10]].");
    expect(answer).not.toMatch(/injur\w*.*(?:2026|October|Thursday)|Greece/);
    const three = [newsRow, { ...newsRow, playerName: "Ben White", statusText: "has been spotted back in training" },
      { ...newsRow, playerName: "Kai Havertz", statusText: "may be doubtful" }];
    expect(renderDatedClubNewsRecords(JSON.stringify({ updates: three }), newsSources, newsGrounding, newsNow)).toContain("Kai Havertz may be doubtful [[S10]]");
  });

  it("renders the actual provider's bounded past injury wording alongside its two valid updates", () => {
    const sources = [
      { ...newsSources[0], id: "S2", date: "2026-10-06T05:00:00Z", snippet: "Arsenal injury update: Declan Rice has neural hamstring pain. Ben White was spotted back in training." },
      { ...newsSources[0], id: "S4", date: "2026-10-06T14:34:50Z", snippet: "Arsenal injury update: both Kai Havertz and Christos Tzolis sustained hamstring issues while away with Germany and Greece, respectively." },
    ];
    const rows = [
      { sourceId: "S2", club: "Arsenal", playerName: "Declan Rice", statusText: "has been dealing with neural hamstring pain" },
      { sourceId: "S2", club: "Arsenal", playerName: "Ben White", statusText: "has been spotted back in training" },
      { sourceId: "S4", club: "Arsenal", playerName: "Kai Havertz", statusText: "sustained a hamstring issue" },
    ];
    const answer = renderDatedClubNewsRecords(JSON.stringify({ updates: rows }), sources, newsGrounding, Date.parse("2026-10-07T06:00:00Z"));
    expect(answer).toContain("Arsenal’s Declan Rice has been dealing with neural hamstring pain [[S2]].");
    expect(answer).toContain("Arsenal’s Ben White has been spotted back in training [[S2]].");
    expect(answer).toContain("Arsenal’s Kai Havertz sustained a hamstring issue [[S4]].");
    expect(answer).not.toMatch(/Germany|Greece|available|starting/);
  });

  it.each(["will be fit", "was injured on Thu", "sustained a hamstring issue yesterday", "was doubtful but should play"])(
    "withholds an invalid status independently without erasing a separately valid source-bound update: %s", (statusText) => {
      const valid = { ...newsRow, playerName: "Ben White", statusText: "has been spotted back in training" };
      const rejected = vi.fn();
      const answer = renderDatedClubNewsRecords(JSON.stringify({ updates: [valid, { ...newsRow, statusText }] }), newsSources, newsGrounding, newsNow, rejected);
      expect(answer).toContain("Arsenal’s Ben White has been spotted back in training [[S10]].");
      expect(answer).not.toMatch(/Christos|will|Thu|yesterday|should play/);
      expect(rejected).toHaveBeenCalledExactlyOnceWith("status_grammar");
      expect(renderDatedClubNewsRecords(newsJson({ ...newsRow, statusText }), newsSources, newsGrounding, newsNow)).toBeNull();
    }
  );

  it("still rejects a whole contract with an invalid source rather than retaining its other status", () => {
    expect(renderDatedClubNewsRecords(JSON.stringify({ updates: [newsRow, { ...newsRow, playerName: "Ben White", sourceId: "S999" }] }), newsSources, newsGrounding, newsNow)).toBeNull();
  });

  it("normalizes an allowed club alias and full-name whitespace without accepting a duplicate player", () => {
    const source = { ...newsSources[0], snippet: "Manchester City injury update: Joe Example was doubtful." };
    const row = { ...newsRow, club: "Man City", playerName: " Joe   Example ", statusText: "may be doubtful" };
    const grounding = match({ date: "2026-10-10" });
    expect(renderDatedClubNewsRecords(newsJson(row), [source], grounding, newsNow)).toContain("Manchester City’s Joe Example may be doubtful");
    expect(renderDatedClubNewsRecords(JSON.stringify({ updates: [row, { ...row, playerName: "Joe Example" }] }), [source], grounding, newsNow)).toBeNull();
  });

  it("keeps the publisher calendar date consistent with its citation at a timezone boundary", () => {
    const date = "2026-10-06T00:15:00+0100";
    expect(renderDatedClubNewsRecords(newsJson(), [{ ...newsSources[0], date }], newsGrounding, newsNow)).toContain("published on 2026-10-06");
    expect(formatDeskCitationDate(date)).toBe("6 Oct");
  });

  it.each([
    "was sidelined with a hamstring injury on 2026-10-05", "was injured on Thursday", "was injured on Thu",
    "was injured in October", "was injured in Oct", "was injured this morning", "was injured on the fifth",
    "was sidelined for a fortnight", "was sidelined for three weeks", "was injured in May", "was injured yesterday",
    "was sidelined with a hamstring injury while playing for Greece", "was expected to return", "may return to training",
    "will be fit", "may be fit", "could start", "was doubtful but should play", "had a 50% chance of starting",
    "was injured [[S1]]", "was injured https://example.com", "was injured. Ben White was suspended",
    "was sidelined alongside Ben White", "was injured for Arsenal", "was injured\nwith a hamstring injury",
  ])("rejects event timing, future projections, extra subjects or markup by the positive grammar: %s", (statusText) => {
    expect(renderDatedClubNewsRecords(newsJson({ ...newsRow, statusText }), newsSources, newsGrounding, newsNow)).toBeNull();
  });

  it.each([
    "Based solely on SEARCH EVIDENCE: Christos Tzolis suffered a hamstring injury on 2026-10-05 [[S10]].",
    "```json\n{\"updates\":[]}\n```", "{\"updates\":[", "null", "[]", "{}", "{\"updates\":[]}",
    JSON.stringify({ updates: [newsRow], publicationDate: "2026-10-05" }),
    JSON.stringify({ updates: [{ ...newsRow, date: "2026-10-05" }] }),
    JSON.stringify({ updates: [newsRow, newsRow, newsRow, newsRow] }),
    JSON.stringify({ updates: [{ ...newsRow, sourceId: "S999" }] }),
    JSON.stringify({ updates: [{ ...newsRow, sourceId: "S10]] injected" }] }),
    JSON.stringify({ updates: [{ ...newsRow, club: "Chelsea" }] }),
    JSON.stringify({ updates: [{ ...newsRow, playerName: "Ben" }] }),
    JSON.stringify({ updates: [{ ...newsRow, playerName: "Absent Player" }] }),
    JSON.stringify({ updates: [{ ...newsRow, statusText: "" }] }),
  ])("rejects malformed or unauthorized record contracts without forwarding raw output: %s", (raw) => {
    expect(renderDatedClubNewsRecords(raw, newsSources, newsGrounding, newsNow)).toBeNull();
  });

  it.each(["", "2026-09-28", "2026-10-07", "not-a-date"])("rejects undated, stale or future sources: %s", (date) => {
    expect(renderDatedClubNewsRecords(newsJson(), [{ ...newsSources[0], date }], newsGrounding, newsNow)).toBeNull();
  });

  it("requires the full player identity in the same source body, rather than its title or another page", () => {
    expect(renderDatedClubNewsRecords(newsJson(), [{ ...newsSources[0], title: "Christos Tzolis injury", snippet: "Arsenal injury news." },
      { ...newsSources[0], id: "S11" }], newsGrounding, newsNow)).toBeNull();
  });

  it.each([
    "was reported injured", "was sidelined with a hamstring injury", "was reported doubtful", "may be doubtful",
    "Has Been Spotted Back In Training", "has a Neural Hamstring pain",
    "was suspended", "was back in training", "has been spotted back in training", "has continued training",
    "has returned to training", "withdrew from international duty", "was undergoing assessment", "was in rehabilitation",
    "had a hamstring issue pending assessment", "has been dealing with neural hamstring pain",
    "sustained a hamstring issue", "suffered an ankle injury", "has sustained a calf strain", "had suffered a knee problem",
    ...["neural hamstring", "hamstring", "groin", "calf", "knee", "ankle", "muscle", "back", "thigh", "adductor", "achilles", "foot", "hip", "shoulder", "ligament", "tendon"]
      .flatMap((part) => ["injury", "issue", "problem", "strain", "pain", "tear"].map((condition) => `has a ${part} ${condition}`)),
  ])("permits every prompted status and approved condition while leaving its factual support to verification: %s", (statusText) => {
    expect(renderDatedClubNewsRecords(newsJson({ ...newsRow, statusText }), newsSources, newsGrounding, newsNow)).toContain(statusText);
  });

  it.each([
    { raw: "private provider text", sources: newsSources, reason: "invalid_json" },
    { raw: newsJson({ ...newsRow, privateField: "private value" }), sources: newsSources, reason: "shape" },
    { raw: newsJson({ ...newsRow, sourceId: "S99" }), sources: newsSources, reason: "source_id" },
    { raw: newsJson({ ...newsRow, club: "private club" }), sources: newsSources, reason: "club" },
    { raw: newsJson({ ...newsRow, playerName: "Private Player" }), sources: newsSources, reason: "player_body" },
    { raw: newsJson(), sources: [{ ...newsSources[0], date: "" }], reason: "date" },
    { raw: newsJson({ ...newsRow, statusText: "private event context" }), sources: newsSources, reason: "status_grammar" },
    { raw: JSON.stringify({ updates: [newsRow, newsRow] }), sources: newsSources, reason: "duplicate" },
  ])("reports only a safe rejection enum: $reason", ({ raw, sources, reason }) => {
    const rejected = vi.fn();
    expect(renderDatedClubNewsRecords(raw, sources, newsGrounding, newsNow, rejected)).toBeNull();
    expect(rejected).toHaveBeenCalledExactlyOnceWith(reason);
    expect(JSON.stringify(rejected.mock.calls)).not.toMatch(/private|Christos|Arsenal|hamstring|S10/i);
  });

  it("keeps a literal status passage beyond publisher navigation inside the same bounded excerpt", () => {
    const text = "Training menu. Withdrawal headlines. " + "Navigation. ".repeat(500)
      + "Joe Example (Arsenal) has a hamstring issue. The report does not confirm future availability.";
    const excerpt = datedClubNewsExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(2_500);
    expect(excerpt).toContain("Joe Example (Arsenal) has a hamstring issue");
    expect(excerpt).toContain("source passage omitted");
    expect(datedClubNewsExcerpt("Short report.")).toBe("Short report.");
  });

  it.each(["openrouter", "minimax", "reasoning-enabled", "thinking-only", "truncated", "error", "stale"] as const)(
    "uses provider-compatible budgets and fails closed with safe diagnostics: %s", async (mode) => {
      const envNames = ["OPENROUTER_API_KEY", "MINIMAX_API_KEY", "PUNDIT_REASONING"] as const;
      const saved = envNames.map((name) => [name, process.env[name]] as const);
      delete process.env.OPENROUTER_API_KEY; delete process.env.MINIMAX_API_KEY; delete process.env.PUNDIT_REASONING;
      process.env[mode === "minimax" ? "MINIMAX_API_KEY" : "OPENROUTER_API_KEY"] = "test-only";
      if (mode === "reasoning-enabled") process.env.PUNDIT_REASONING = "on";
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T02:00:00Z"));
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const records = JSON.stringify({ updates: [{ sourceId: "S9", club: "Arsenal", playerName: "Joe Example", statusText: "was reported injured" }] });
      const prose = "In an update published on 2026-10-05, Arsenal’s Joe Example was reported injured [[S9]].";
      const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params) => {
        const input = params as Anthropic.MessageCreateParamsNonStreaming;
        expect(input.max_tokens).toBe(mode === "minimax" || mode === "reasoning-enabled" ? 8_192 : 1_024);
        expect(input.thinking).toEqual(mode === "minimax" || mode === "reasoning-enabled" ? undefined : { type: "disabled" });
        if (mode === "error") throw new Error("sensitive provider body must never be logged");
        return Promise.resolve({ content: mode === "thinking-only" ? [{ type: "thinking", thinking: "private internal text", signature: "" }]
          : [{ type: "text", text: records }], stop_reason: mode === "truncated" ? "max_tokens" : "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      });
      try {
        const result = await writeDeskProse("Latest Arsenal injury news?", match({ home: "Arsenal", away: "Leeds", date: "2026-10-10" }), [], undefined, {
          queries: ["q"], results: [{ id: "S9", title: "Arsenal injury bulletin", url: "https://www.arsenal.com/news/fitness",
            date: mode === "stale" ? "2026-09-20" : "2026-10-05", tier: "official",
            snippet: "Joe Example (Arsenal) is injured. Earlier fixtures: Arsenal vs Everton: archive." }],
        }, { datedClubNews: true });
        expect(result).toBe(["openrouter", "minimax", "reasoning-enabled"].includes(mode) ? prose : null);
        expect(create).toHaveBeenCalledTimes(mode === "stale" ? 0 : 1);
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toMatch(/sensitive provider body|private internal text|test-only/);
        if (mode === "error") expect(warn.mock.calls[0][0]).toContain('"errorType":"Error"');
      } finally {
        create.mockRestore(); info.mockRestore(); warn.mockRestore(); vi.useRealTimers();
        for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      }
    }
  );

  it.each(["recover", "second-invalid", "repair-source", "repair-status", "empty", "source", "club", "player", "date", "future", "status", "shape", "duplicate",
    "budget", "abort", "abort-on-reserve", "truncated", "error", "other-mode"] as const)(
    "bounds a dated-news JSON syntax repair without promoting unsupported records: %s", async (mode) => {
      const saved = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = "test-only";
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T02:00:00Z"));
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const controller = new AbortController();
      const reserve = vi.fn(() => { if (mode === "abort-on-reserve") controller.abort(); return mode !== "budget"; });
      const source = { id: "S9", title: "Arsenal injury bulletin", url: "https://www.arsenal.com/news/fitness",
        date: "2026-10-05", tier: "official" as const, snippet: "Joe Example (Arsenal) is injured." };
      const row = { sourceId: "S9", club: "Arsenal", playerName: "Joe Example", statusText: "was reported injured" };
      if (mode === "source" || mode === "repair-source") row.sourceId = "S999";
      if (mode === "club") row.club = "Chelsea";
      if (mode === "player") row.playerName = "Unknown Person";
      if (mode === "date") source.date = "2026-09-01";
      if (mode === "future") source.date = "2026-10-07";
      if (mode === "status" || mode === "repair-status") row.statusText = "will start for Arsenal";
      const valid = JSON.stringify({ updates: mode === "duplicate" ? [row, row] : [row] });
      const invalid = "private malformed draft: {updates:";
      const signals: (AbortSignal | null | undefined)[] = [];
      let calls = 0;
      const create = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation((params, options) => {
        calls += 1; signals.push(options?.signal);
        const input = params as Anthropic.MessageCreateParamsNonStreaming;
        expect(JSON.stringify(input.messages)).not.toContain(invalid);
        if (mode !== "other-mode") expect(input.temperature).toBe(0);
        if (calls === 2) expect(String(input.messages.at(-1)?.content)).toContain("Formatting reminder:");
        if (mode === "error") throw new Error("private provider body");
        if (mode === "abort") controller.abort();
        const semantic = ["empty", "source", "club", "player", "status", "shape", "duplicate"].includes(mode);
        const text = mode === "empty" ? '{"updates":[]}' : mode === "shape" ? '{"wrong":[]}'
          : semantic ? valid : calls === 1 || mode === "second-invalid" ? invalid : valid;
        return Promise.resolve({ content: [{ type: "text", text }], stop_reason: mode === "truncated" ? "max_tokens" : "end_turn" } as Anthropic.Message) as ReturnType<typeof Anthropic.Messages.prototype.create>;
      });
      try {
        const result = await writeDeskProse("Latest Arsenal injury news?", match({ home: "Arsenal", away: "Leeds", date: "2026-10-10" }), [], controller.signal,
          { queries: ["q"], results: [source] }, { datedClubNews: mode !== "other-mode", reserveRepairCall: reserve });
        expect(create).toHaveBeenCalledTimes(["date", "future"].includes(mode) ? 0 : ["recover", "second-invalid", "repair-source", "repair-status"].includes(mode) ? 2 : 1);
        expect(reserve).toHaveBeenCalledTimes(["recover", "second-invalid", "repair-source", "repair-status", "budget", "abort-on-reserve"].includes(mode) ? 1 : 0);
        if (mode === "recover") {
          expect(result).toBe("In an update published on 2026-10-05, Arsenal’s Joe Example was reported injured [[S9]].");
          expect(signals[0]).toBe(signals[1]);
        } else if (mode !== "other-mode") expect(result).toBeNull();
        expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toMatch(/private malformed draft|private provider body|test-only/);
      } finally {
        create.mockRestore(); info.mockRestore(); warn.mockRestore(); vi.useRealTimers();
        if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
      }
    }
  );
});

describe("filterDeskEvidenceRows", () => {
  it("exposes a literal same-source current-role passage after navigation without inventing source metadata", () => {
    const row = { id: "S10", title: "Arsenal manager report", snippet: "Contract reporting.", date: "2026-09-22", tier: "news" as const, url: "https://www.skysports.com/report" };
    const role = "Arsenal manager Mikel Arteta has agreed a new contract with the club.";
    const body = `${"Site navigation\n\n".repeat(600)}${role}\n\nUnrelated match commentary.`;
    const before = JSON.stringify(row);
    const result = formatManagerEvidence([row], "Arsenal", [{ ...row, text: body }], Date.parse("2026-10-07"));
    expect(result).toContain("[[S10]] 22 Sep"); expect(result).toContain(role);
    expect(result).not.toContain("Site navigation"); expect(JSON.stringify(row)).toBe(before);
  });

  it("includes a short complete role statement from a dated body when the search snippet lacks identity", () => {
    const row = { id: "S10", title: "Arsenal manager report", snippet: "Club reporting.", date: "2026-10-06", tier: "news" as const, url: "https://www.skysports.com/report" };
    const role = "Mikel Arteta is Arsenal’s manager.";
    expect(formatManagerEvidence([row], "Arsenal", [{ ...row, text: role }], Date.parse("2026-10-07"))).toContain(role);
  });

  it.each(["stale", "future", "undated", "wrong-id", "wrong-url", "different-date", "404"])("never supplies an unbound or unusable manager body (%s)", (mode) => {
    const row = { id: "S10", title: "Arsenal manager report", snippet: "Contract reporting.", date: "2026-09-22", tier: "news" as const, url: "https://www.skysports.com/report" };
    const page = { ...row, text: "Arsenal manager Pat Example has agreed a new contract with the club." };
    if (mode === "stale") row.date = page.date = "2026-07-01";
    if (mode === "future") row.date = page.date = "2026-10-08";
    if (mode === "undated") row.date = page.date = "";
    if (mode === "wrong-id") page.id = "S1";
    if (mode === "wrong-url") page.url = "https://www.skysports.com/other";
    if (mode === "different-date") page.date = "2026-09-23";
    const result = formatManagerEvidence([row], "Arsenal", mode === "404" ? [] : [page], Date.parse("2026-10-07"));
    expect(result).not.toContain("Pat Example"); expect(result).toContain("Contract reporting.");
  });

  it("selects a relevant manager report ahead of profiles without changing original IDs or other turn ordering", () => {
    const profiles = Array.from({ length: 9 }, (_, index) => ({
      id: `S${index + 1}`, title: "Arsenal manager staff directory", snippet: "Arsenal staff profile.", date: "",
      tier: "official" as const, url: `https://www.arsenal.com/profile-${index}`,
    }));
    const news = { id: "S10", title: "Arsenal manager agrees new contract", snippet: "Arsenal manager remains in charge.", date: "", tier: "news" as const, url: "https://www.skysports.com/current-report" };
    const stale = { ...news, id: "S11", date: "2026-07-01" };
    const otherClub = { ...news, id: "S12", title: "Chelsea manager agrees new contract", snippet: "Chelsea manager remains in charge." };
    const rows = [...profiles, news, stale, otherClub];
    const original = JSON.stringify(rows);
    const grounding = match({ home: "Arsenal", away: "Leeds" });
    const now = Date.parse("2026-10-07T06:00:00Z");
    const kept = filterDeskEvidenceRows(rows, grounding, now, "Who is Arsenal's manager today?");
    expect(kept.map((row) => row.id)).toEqual(["S10", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    expect(kept[0]?.date).toBe(""); // Selection supplies no publication or role proof.
    expect(filterDeskEvidenceRows(rows, grounding, now, "What is Arsenal's latest result?").map((row) => row.id))
      .toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
    expect(JSON.stringify(rows)).toBe(original);
  });

  it("drops months-old previews and a different opponent", () => {
    const kept = filterDeskEvidenceRows(
      [
        {
          id: "S1",
          title: "Manchester City vs Sunderland Team News, H2H, early...",
          snippet: "Rodri ACL, De Bruyne groin, Bobb still out.",
          date: "2025-12-04T09:23:37.534Z",
          url: "https://www.goal.com/old-sunderland",
        },
        {
          id: "S2",
          title: "Man City Starting XI vs Sunderland: Confirmed Team News",
          snippet: "Yahoo preview from January.",
          date: "2026-01-01",
          url: "https://sports.yahoo.com/old-xi",
        },
        {
          id: "S3",
          title: "Man City vs Coventry injury, suspension list, predicted XIs",
          snippet: "Doku calf. Stones and Bobb unavailable.",
          date: "2026-09-04T15:00:00+01:00",
          url: "https://www.sportsmole.co.uk/coventry",
        },
        {
          id: "S4",
          title: "Manchester City vs Sunderland: predicted lineup and team news",
          snippet: "Haaland leads the line this weekend.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.bbc.co.uk/current",
        },
      ],
      match(),
      NOW
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toContain("bbc.co.uk");
    expect(kept[0]?.id).toBe("S4");
  });

  it("drops City previews when the pinned fixture is Chelsea vs Hull", () => {
    const kept = filterDeskEvidenceRows(
      [
        {
          title: "Manchester City vs Sunderland Team News",
          snippet: "Rodri still out.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.goal.com/city",
        },
        {
          title: "Chelsea vs Hull City: predicted lineup and team news",
          snippet: "Jackson is a doubt.",
          date: "2026-09-09T12:00:00.000Z",
          url: "https://www.standard.co.uk/chelsea-hull",
        },
      ],
      match({
        home: "Chelsea",
        away: "Hull City",
        fixtureId: "espn:eng.1:chelsea-hull",
      }),
      NOW
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toContain("chelsea-hull");
  });
});

describe("desk citation rewrite", () => {
  it("keeps dated manager citations balanced across repeated delivery formatting", () => {
    const raw = "Mikel Arteta is Arsenal’s manager ([Mikel Arteta agrees improved Arsenal contract, signing extension until 2030 | Arsenal | The Guardian](https://www.theguardian.com/football/2026/sep/22/mikel-arteta-agrees-contract-extension-arsenal-2030), 2026-09-22T17:36:29.000Z).";
    const once = humaniseDeskCitationDates(raw);
    expect(once).toContain("2030) · 22 Sep).");
    expect(humaniseDeskCitationDates(once)).toBe(once);
    expect(humaniseDeskCitationDates(humaniseDeskCitationDates(once))).toBe(once);
    expect(once).not.toMatch(/\)\) ·|Sep\)\)/);
  });

  it("preserves multiple independently dated or undated citations on a second pass", () => {
    const raw = "The report ([Club update](https://www.arsenal.com/news/update), 2026-10-04) differs from the notice ([League notice](https://www.premierleague.com/news/notice), undated).";
    const once = humaniseDeskCitationDates(raw);
    expect(once).toContain("update) · 4 Oct)");
    expect(once).toContain("notice) · undated)");
    expect(humaniseDeskCitationDates(once)).toBe(once);
  });

  it("retains parenthetical and long source titles without duplicating wrapper punctuation", () => {
    const title = `Club statement (interim manager) ${"x".repeat(157)}`;
    const raw = `The appointment ([${title}](https://www.arsenal.com/news/appointment), 2026-10-04).`;
    const once = humaniseDeskCitationDates(raw);
    expect(once).toContain(`[${title}](https://www.arsenal.com/news/appointment) · 4 Oct)`);
    expect(humaniseDeskCitationDates(once)).toBe(once);
  });

  it("unsticks a jammed markdown citation and drops an offset ISO instant", () => {
    const raw = "just 40% BTTS([Manchester City vs Sunderland Team News, H2H, early... ]"
      + "(https://www.goal.com/en/news/city), 2025-12-04T09:23:37.534Z). "
      + "later has Dias ([Man City vs Coventry](https://www.sportsmole.co.uk/x), "
      + "2026-09-04T15:00:00+01:00).";
    const out = humaniseDeskCitationDates(raw);
    expect(out).not.toMatch(/T09:23:37/);
    expect(out).not.toMatch(/\+01:00/);
    expect(out).toContain("BTTS ([Manchester City vs Sunderland Team News, H2H, early...](https://www.goal.com/en/news/city) · 4 Dec)");
    expect(out).toContain("([Man City vs Coventry](https://www.sportsmole.co.uk/x) · 4 Sep)");
  });
});

describe("single-club current evidence relevance", () => {
  it("keeps a dated latest-result report against another opponent while rejecting unrelated and stale reports", () => {
    const g = match({ home: "Arsenal", away: "Leeds" });
    const now = Date.parse("2026-10-05T00:00:00Z");
    const rows = [
      { title: "Arsenal vs Brighton: match report", snippet: "Arsenal won 3-0.", date: "2026-10-04" },
      { title: "Leeds vs Chelsea: match report", snippet: "Leeds won 2-0.", date: "2026-10-04" },
      { title: "Arsenal vs Brighton: old report", snippet: "Arsenal won 2-0.", date: "2026-08-01" },
    ];
    expect(filterDeskEvidenceRows(rows, g, now, "What is Arsenal's latest result?"))
      .toEqual([{ ...rows[0], id: "S1" }]);
    expect(filterDeskEvidenceRows(rows, g, now, "Any injury news for Arsenal vs Leeds?"))
      .toEqual([]);
    expect(filterDeskEvidenceRows(rows, g, now, "What was Arsenal vs Leeds' result?"))
      .toEqual([]);
    for (const question of [
      "What is Arsenal’s latest result against Liverpool?",
      "What is Arsenal's latest result against Riverside United?",
      "What was Arsenal's latest result away to Liverpool?",
    ]) expect(filterDeskEvidenceRows(rows, g, now, question)).toEqual([]);
  });
});

describe("sanitizeDeskModelProse", () => {
  it("drops MiniMax-authored markdown links and unevidenced ACL names", () => {
    const dumped = "The bench still waits on Rodri (ACL) ([City vs Sunderland](https://www.goal.com/old), 2025-12-04T09:23:37.534Z). Who decides it is the first ball in behind.";
    const clean = sanitizeDeskModelProse(dumped);
    expect(clean).toContain("Who decides it is the first ball in behind.");
    expect(clean).not.toMatch(/Rodri/);
    expect(clean).not.toMatch(/goal\.com/);
  });
});

describe("formatSearchEvidence dates", () => {
  it("feeds MiniMax a short date, not a machine instant", () => {
    const block = formatSearchEvidence([
      {
        id: "S1",
        title: "City vs Sunderland team news",
        snippet: "Haaland leads the line.",
        date: "2026-09-09T17:47:51.000Z",
      },
    ]);
    expect(block).toContain("9 Sep");
    expect(block).not.toContain("T17:47:51");
  });

  it("groups desk search evidence by tier when tiers are present", () => {
    const block = formatSearchEvidence([
      {
        id: "S1",
        title: "xG report",
        snippet: "City 2.1 xG last five.",
        date: "2026-09-09",
        tier: "analytics",
      },
      {
        id: "S2",
        title: "Team news",
        snippet: "Rodri still out.",
        date: "2026-09-09",
        tier: "news",
      },
    ]);
    expect(block).toContain("ANALYTICS EVIDENCE");
    expect(block).toContain("NEWS EVIDENCE");
    expect(block).toContain("[[S1]]");
    expect(block).toContain("[[S2]]");
  });
});

describe("desk football-take floor", () => {
  it("writes a schematic take without board numbers or current-news claims", () => {
    const take = composeDeskFootballTake(match());
    expect(take).toMatch(/I lean to Manchester City at home/);
    expect(take).toMatch(/If Manchester City draw Sunderland's first press/);
    expect(take).toMatch(/tactical possibilities/);
    expect(take).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(take).not.toMatch(/EV%|captured decimal|2\.70|Etihad|injured|manager/i);
    expect(stripDeskBoardRecitals(take)).toBe(take);
  });

  it("treats a conflict notice as empty remainder and keeps a briefing restorable", () => {
    expect(deskProseIsCurrentNewsRemainder(
      "Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe(true);
    expect(deskProseIsCurrentNewsRemainder(
      "City should control this at home. Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe(false);
    expect(shouldRestoreDeskFootballTake("Give me the match briefing for Arsenal vs Leeds United.")).toBe(true);
    expect(shouldRestoreDeskFootballTake("Tactical matchup")).toBe(true);
    expect(shouldRestoreDeskFootballTake("What is the latest team news?")).toBe(false);
    expect(stripSurplusCurrentNewsNotices(
      "Arsenal should control this at home. Current reports conflict on one or more requested facts, so I’ve left those claims out."
    )).toBe("Arsenal should control this at home.");
  });
});

describe("desk take outline", () => {
  it("orders labelled 1X2, optional wrinkle, then football sentences", () => {
    const g = match();
    const bare = composeDeskTakeOutline(g);
    expect(bare).toMatch(/^My 1X2 is Manchester City .* \(fair /);
    expect(bare).toMatch(/I lean to Manchester City at home/);
    expect(bare).not.toMatch(/unavailable|not priced into/i);
    expect(bare).not.toMatch(/captured decimal|EV%|pass or play/i);

    const withWrinkle = composeDeskTakeOutline(g, {
      footballProse: "If Manchester City can control territory, they could create chances without overcommitting.",
      playerEvidence: {
        observations: [{
          playerId: "haaland",
          playerName: "Erling Haaland",
          teamId: "Manchester City",
          fixtureId: g.fixtureId,
          evidenceType: "availability",
          value: "out",
          sourceId: "S1",
          observedAt: "2026-09-09T12:00:00.000Z",
          effectiveAt: "2026-09-09T12:00:00.000Z",
        }],
        markets: [],
      },
    });
    expect(withWrinkle.indexOf("My 1X2")).toBeLessThan(withWrinkle.indexOf("Erling Haaland"));
    expect(withWrinkle.indexOf("Erling Haaland")).toBeLessThan(
      withWrinkle.indexOf("If Manchester City can control territory")
    );
    expect(withWrinkle).toMatch(/not priced into the 1X2 above/);
    expect(withWrinkle).toMatch(/fair 1\.22/);
  });

  it("keeps real book decimals out of the outline and never invents them from no-vig", () => {
    const outline = composeDeskTakeOutline(match());
    expect(outline).toMatch(/fair 1\.22/);
    // No-vig market legs must not be inverted into a fake sportsbook decimal.
    expect(outline).not.toMatch(/Stake decimal|captured decimal|1\/0\.|book price/i);
    expect(outline).not.toMatch(/\bEV%\b/);
  });
});

describe("desk qualitative voice", () => {
  it("forbids MiniMax from printing the board, 2.70, or a stadium", () => {
    expect(DESK_SYSTEM).toMatch(/Do not print probabilities/);
    expect(DESK_SYSTEM).toMatch(/Do not name a stadium/);
    expect(DESK_SYSTEM).not.toMatch(/Put a number on it/);
    expect(DESK_SYSTEM).toMatch(/"2\.70"/);
    const prompt = card(match());
    expect(prompt).toContain("Manchester City are at home");
    expect(prompt).toContain("Elo Manchester City 1950 vs Sunderland 1520");
    expect(prompt).toContain("Form Manchester City WWD");
    expect(prompt).toContain("Manchester City: 2nd, 10 pts");
    expect(prompt).not.toMatch(/\d+%/);
    expect(prompt).not.toMatch(/Etihad|2\.70|Old Trafford/i);
  });

  it("strips board recitals and keeps the football sentence", () => {
    const dump = [
      "United vs City at the Etihad, derby frame, and I puts City around 53% to win with a 26% draw and 21% home win.",
      "City walk into the fixture without a corresponding blow named on the list, so the visitors keep their structure intact.",
      "The engine sees it tight on goals — Over 2.5 at 51% versus Under at 49%.",
      "Totals sit near even because every match uses the same 2.70 expected goals.",
      "The modal scoreline is 1-1 at 13%.",
      "City 21 / 26 / 53 on the 1X2.",
    ].join(" ");
    const clean = stripDeskBoardRecitals(dump);
    expect(clean).toContain("City walk into the fixture");
    expect(clean).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(clean).not.toMatch(/Etihad|2\.70|the engine|1x2|BTTS|modal/i);
    expect(clean).not.toMatch(/\b21\s*\/\s*26\s*\/\s*53\b/);
  });
});


describe("conditional desk tactics", () => {
  it("drops invented player roles, asserted game flow and time-of-day claims", () => {
    const g = match({ home: "Arsenal", away: "Leeds United" });
    const bad = "Arsenal control the tempo from the first whistle. Saka and Ødegaard pull Leeds out of shape. It's a low-event night because Leeds lack midfield legs.";
    expect(sanitizeDeskFootballHypotheses(bad, g)).toBe("");
    const outline = composeDeskTakeOutline(g, { footballProse: bad });
    expect(outline).toMatch(/My 1X2/);
    expect(outline).toMatch(/If Arsenal draw Leeds United's first press/);
    expect(outline).not.toMatch(/Saka|Ødegaard|night|lack midfield legs/);
  });

  it("keeps tactical possibilities but refuses uncited named players and numerical effects", () => {
    const g = match({ home: "Arsenal", away: "Leeds United" });
    const valid = "If Arsenal press high, Leeds could attack the space behind. I would look for whether the home side can protect against transitions.";
    expect(sanitizeDeskFootballHypotheses(valid, g)).toBe(valid);
    for (const text of [
      "If Saka plays, Arsenal could control the game.",
      "If saka plays, Arsenal could control the game.",
      "If Ødegaard presses, Arsenal could control the game.",
      "If Arsenal press, Leeds could have a 30% chance.",
      "If Arsenal press tonight, Leeds could struggle.",
    ]) expect(sanitizeDeskFootballHypotheses(text, g)).toBe("");
  });

  it("does not convert a draw lean into a predicted stalemate or low goal count", () => {
    const take = composeDeskFootballTake(match({ pHome: 0.3, pDraw: 0.4, pAway: 0.3 }));
    expect(take).toMatch(/draw as the likeliest single outcome/);
    expect(take).toMatch(/does not establish a low-scoring game/);
    expect(take).not.toMatch(/midfield stalemate|tight night/);
  });

  it("explains conditional build-up, width and counter-cover without a venue claim on neutral ground", () => {
    const take = composeDeskFootballTake(match({ homeFieldAdvantage: false }));
    expect(take).toContain("supporting receiver could become free");
    expect(take).toContain("central passing lanes");
    expect(take).toContain("cut-back");
    expect(take).toContain("less cover against a counterattack");
    expect(take).toContain("players who stayed back would need to cover");
    expect(take).not.toMatch(/at home|away from home|injur|Saka|\d+%/i);
    expect(DESK_GENERAL_CONCEPT_SYSTEM).toContain("Stable football concepts do not require a current-news source");
  });
});
