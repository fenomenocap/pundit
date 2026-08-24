import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../middleware";
import {
  asksForMatchRead,
  nameMarkerLinks,
  dropEmptyEmphasis,
  attachEvidence,
  generateAnalysis,
  renderEvidenceCitations,
  MAX_CONTINUATIONS,
  PROVIDER_CALL_BUDGET,
  generateAnalysisStream,
  Grounding,
  sanitizeCompetitionAnswer,
  sanitizeMatchAnswer,
  sanitizeSeasonAnswer,
  sanitizeUnsupportedTeamNews,
  stripProcessNarration,
  ensureGeneralDisclaimer,
  normalizeSectionBreaks,
  dropMisbucketedTotalsScorelines,
  sanitizeGeneralAnswer,
  normalizeBannedMarkdown,
  stripToolCallMarkup,
  extractLeakedSearchQueries,
  sanitizeRequestFidelity,
  answerQuestion,
  answerQuestionStream,
} from "./ask";
import {
  clientWith,
  message,
  streamOf,
  toolUseMessage,
} from "./__fixtures__/anthropic-stubs";
import {
  recognizeEspnFixture,
  replaceFixtureRegistryForTests,
} from "./fixture-registry";

// The exact string a user was shown in production: MiniMax's tool-call channel
// leaking into the text channel, doubled and unterminated.
const SCREENSHOT_LEAK = "]<]minimax[>[<tool_call> ]<]minimax[>[<tool_call> "
  + '<invoke name="web_search"> <query>Dinamo Zagreb vs Viking FK Champions League qualifier '
  + "2026 team news injuries lineup</query> </invoke> "
  + '<invoke name="web_search"> <query>Dinamo Zagreb injury news Champions League playoff '
  + "August 2026</query> </invoke> "
  + '<invoke name="web_search"> <query>Viking FK Champions League playoff 2026 injury news '
  + "squad</query> </invoke> </tool_call>";

// A second live leak: a bare, unclosed JSON tool payload ahead of a real answer.
const JSON_LEAK = '{  "search_queries": ["Arsenal team news injuries Premier League August 2026", '
  + '"Coventry City injuries squad news August 2026"]';

// Verbatim from production: the entire 141-character answer a user received for
// "Arsenal vs Coventry". A different tool name (`google_search`) and a
// different envelope (a doubly-bracketed array) from anything handled before.
const BRACKETED_JSON_LEAK = '[[{"id":"google_search","params":{"query":"Arsenal vs Coventry '
  + 'Premier League 21 August 2026 lineup injuries","topn":10,"recency_days":30}}]]';

// Verbatim from production: the entire 117-character answer a user received for
// "Celtic vs LASK second leg". Neither markup nor JSON -- single brackets, a
// colon, and a query of ordinary English words -- so every stripper written for
// the three leaks above passed it straight through to the chat bubble.
const BRACKETED_DIRECTIVE_LEAK =
  "[web_search:Celtic LASK Champions League playoff 2026 team news injuries]\n"
  + "[web_search:Celtic lineup news August 2026]";

const PRODUCTION_SEARCH_QUERY_LEAK =
  "I can't answer that question.\n\n[[search_query:Premier League 2026-27 season start date fixtures]]";

// The tool loop executes searches for real; stub the backend so these tests
// stay offline and deterministic.
const searchWeb = vi.hoisted(() => vi.fn());
vi.mock("./web-search", () => ({
  searchWeb,
  searchWebBatch: (queries: string[]) => Promise.all(queries.map((q) => searchWeb(q))),
}));

beforeEach(() => {
  searchWeb.mockReset();
  searchWeb.mockResolvedValue([
    { title: "Arsenal team news", link: "https://example.com/a", snippet: "s", date: "2026-08-10" },
  ]);
});

describe("deterministic coverage search discipline", () => {
  it("runs mandatory current search for a candidate, but never promotes or generates from it", async () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "test-only";
    try {
      const result = await answerQuestion(
        "What is the latest injury news for Northbridge Athletic vs Southbank Rovers tomorrow?"
      );
      expect(searchWeb).toHaveBeenCalledTimes(1);
      expect(result.answer).toMatch(/could not establish an authoritative structured fixture identity/i);
      expect(result.answer).not.toMatch(/S1|S2|Arsenal team news|probabilit(?:y|ies):?\s*\d/i);

      searchWeb.mockClear();
      const closed = await answerQuestion("Northbridge Athletic vs Southbank Rovers");
      expect(searchWeb).not.toHaveBeenCalled();
      expect(closed.answer).toMatch(/discovery candidate/i);
    } finally {
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
    }
  });

  it("runs mandatory search before a non-priced fixture notice in JSON and SSE", async () => {
    const originalKey = process.env.MINIMAX_API_KEY;
    const originalRegistryFlag = process.env.FIXTURE_REGISTRY_ENABLED;
    process.env.MINIMAX_API_KEY = "test-only";
    process.env.FIXTURE_REGISTRY_ENABLED = "true";
    const recognized = recognizeEspnFixture({
      id: 901,
      competitionId: "club.friendly",
      competition: "Club Friendly",
      homeTeam: "Northbridge Athletic",
      awayTeam: "Southbank Rovers",
      utcDate: "2026-08-22T12:00:00.000Z",
      status: "SCHEDULED",
      stage: null,
      matchday: null,
      group: null,
      score: null,
    });
    recognized.competition.category = "club-friendly";
    recognized.neutralVenue = true;
    replaceFixtureRegistryForTests([recognized]);
    const fixtureContext = { fixtureId: recognized.fixtureId };
    try {
      const json = await answerQuestion(
        "What is the latest injury news for this recognized friendly?",
        [],
        undefined,
        undefined,
        fixtureContext
      );
      expect(searchWeb).toHaveBeenCalledTimes(1);
      expect(json.grounding).toMatchObject({ kind: "fixture" });
      expect(json.answer).toMatch(/outside Pundit's model coverage/i);
      expect(json.answer).not.toMatch(/Arsenal team news|\[S1\]/i);

      searchWeb.mockClear();
      const deltas: string[] = [];
      const sse = await answerQuestionStream(
        "What is the latest lineup for this recognized friendly?",
        [],
        undefined,
        { onGrounding: () => undefined, onDelta: (text) => deltas.push(text) },
        fixtureContext
      );
      expect(searchWeb).toHaveBeenCalledTimes(1);
      expect(sse.answer).toBe(json.answer);
      expect(deltas).toEqual([sse.answer]);

      searchWeb.mockClear();
      const closed = await answerQuestion(
        "Why is this recognized friendly not priced?",
        [],
        undefined,
        undefined,
        fixtureContext
      );
      expect(searchWeb).not.toHaveBeenCalled();
      expect(closed.answer).toContain("Public friendly forecasts are disabled by policy");
    } finally {
      replaceFixtureRegistryForTests([]);
      if (originalKey === undefined) delete process.env.MINIMAX_API_KEY;
      else process.env.MINIMAX_API_KEY = originalKey;
      if (originalRegistryFlag === undefined) delete process.env.FIXTURE_REGISTRY_ENABLED;
      else process.env.FIXTURE_REGISTRY_ENABLED = originalRegistryFlag;
    }
  });
});

describe("generateAnalysis", () => {
  it("drops a structurally incomplete end_turn tail after coherent prose", async () => {
    const client = clientWith(message(
      "**Title race**\n\nNo matches have been played.\n\nArsenal are at **92.7%**, City at **5.",
      "end_turn"
    ));
    await expect(generateAnalysis(client, "system", [], "season"))
      .resolves.toBe(
        "**Title race**\n\nNo matches have been played.\n\nArsenal are at **92.7%**"
      );
  });

  it("cuts from an earlier unmatched bold marker rather than leaving malformed markdown", async () => {
    const client = clientWith(message(
      "Opening context is complete.\n\n**Verdict\nArsenal lead.\n\n**Goals**\nOver 2.5 leans yes.",
      "end_turn"
    ));
    await expect(generateAnalysis(client, "system", [], "season"))
      .resolves.toBe("Opening context is complete.");

    const noPrefix = clientWith(message(
      "**Verdict\nArsenal lead.\n\n**Goals**\nOver 2.5 leans yes.",
      "end_turn"
    ));
    await expect(generateAnalysis(noPrefix, "system", [], "season"))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it("fails closed when a non-rebuildable answer is only an incomplete end_turn fragment", async () => {
    const client = clientWith(message("City is **5.", "end_turn"));
    await expect(generateAnalysis(client, "system", [], "season"))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it("leaves an empty result for the match delivery fallback to rebuild", async () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      competition: "Premier League",
      home: "Arsenal",
      away: "Man City",
      scorelines: [],
      oddsSources: [],
    } as unknown as Grounding;
    const client = clientWith(message("City is **5.", "end_turn"));
    await expect(generateAnalysis(client, "system", [], "match", grounding)).resolves.toBe("");
  });

  it("preserves complete numeric and balanced-markdown endings", async () => {
    const client = clientWith(message("**Title race**\nArsenal are at **5.0%**.", "end_turn"));
    await expect(generateAnalysis(client, "system", [], "season"))
      .resolves.toBe("**Title race**\nArsenal are at **5.0%**.");
    const numeric = clientWith(message("Arsenal are at 92.7%. The score is 5.", "end_turn"));
    await expect(generateAnalysis(numeric, "system", [], "season"))
      .resolves.toBe("Arsenal are at 92.7%. The score is 5.");
  });

  it("drops probability-shaped team and outcome tails only after a prior percentage", async () => {
    const cases = [
      ["Arsenal are at 92.7%, City is 5.", "Arsenal are at 92.7%"],
      ["Arsenal are at 92.7%, City: 5.", "Arsenal are at 92.7%"],
      ["Home is 61.0%, away 5.", "Home is 61.0%"],
      ["The home win is 61.0%, draw 5.", "The home win is 61.0%"],
      ["Home is 61.0%, while away 5.", "Home is 61.0%"],
    ];
    for (const [raw, expected] of cases) {
      const client = clientWith(message(raw, "end_turn"));
      await expect(generateAnalysis(client, "system", [], "season")).resolves.toBe(expected);
    }
  });

  it("preserves numeric club names, complete scales and decimal-odds prose", async () => {
    for (const answer of [
      "Arsenal had 60% possession. They faced Schalke 04.",
      "Arsenal had 60% possession. They faced 1860 Munich.",
      "Arsenal had 60% possession. Bet365 has City at 5.",
      "Arsenal are 92.7%; Bet365 has City at 5.",
      "The score is 5.",
      "The scale runs 1 to 5.",
    ]) {
      const client = clientWith(message(answer, "end_turn"));
      await expect(generateAnalysis(client, "system", [], "season")).resolves.toBe(answer);
    }
  });

  // Pinned to the shared budget rather than a number: the guarantee is that
  // inference, retries and searches all draw on one ceiling, whatever it is set
  // to. Starting three short of it leaves exactly a turn, a retry and a search.
  it("caps combined inference, retry, and search provider calls at the shared budget", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "boom" }))
      .mockResolvedValueOnce(toolUseMessage(""));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const bundle = { queries: [], results: [], providerCalls: PROVIDER_CALL_BUDGET - 3 };
    await expect(generateAnalysis(client, "system", [], "general", undefined, bundle))
      .rejects.toMatchObject({ statusCode: 504 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(bundle.providerCalls).toBe(PROVIDER_CALL_BUDGET);
  });

  it("returns trimmed text and accepts web-search content blocks", async () => {
    const client = clientWith({
      content: [
        { type: "tool_use", id: "tool", name: "web_search", input: { query: "q" } },
        { type: "text", text: "  Grounded answer.  ", citations: [] },
      ],
      stop_reason: "end_turn",
    });
    await expect(generateAnalysis(client, "system", [
      { role: "user", content: "question" },
    ], "match")).resolves.toBe("Grounded answer.");
  });

  it("applies manager-era, contradictory-rationale, and market gates on the real service path", async () => {
    const client = clientWith(message([
      "The win came during Wrong Manager's tenure.",
      "The home side's midfield gives it an edge.",
      "The away side's midfield gives it an advantage.",
      "Stake market: home 99%, draw 0.5%, away 0.5%.",
      "The matchup remains close.",
    ].join("\n"), "end_turn"));
    const answer = await generateAnalysis(client, "system", [], "general");
    expect(answer).not.toMatch(/Wrong Manager|99%|home side's midfield|away side's midfield/);
    expect(answer).toContain("structured tenure record");
    expect(answer).toContain("Conflicting midfield rationales were omitted");
    expect(answer).toContain("complete same-source, same-time bookmaker 1X2 market");
    expect(answer).toContain("The matchup remains close.");
  });

  it("rejects empty and token-exhausted responses", async () => {
    await expect(generateAnalysis(clientWith({ content: [], stop_reason: "end_turn" }),
      "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
    await expect(generateAnalysis(clientWith({
      content: [{ type: "text", text: "truncated", citations: [] }],
      stop_reason: "max_tokens",
    }), "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
  });

  // The bracketed envelope shipped as a whole answer in production. It must
  // reach the user as an error, never as a chat bubble, on the same path an
  // all-markup answer already takes.
  it("never ships a bracketed JSON tool envelope as the answer", async () => {
    await expect(generateAnalysis(clientWith({
      content: [{ type: "text", text: BRACKETED_JSON_LEAK, citations: [] }],
      stop_reason: "end_turn",
    }), "system", [], "general", undefined, undefined, undefined, false))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it("maps SDK timeouts to a 504", async () => {
    const client = {
      messages: { create: vi.fn().mockRejectedValue(new Error("Request timed out")) },
    } as unknown as Pick<Anthropic, "messages">;
    try {
      await generateAnalysis(client, "system", [], "general");
      throw new Error("expected timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ statusCode: 504 });
    }
  });

  it("runs a requested search and replays the assistant turn plus its tool_result", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(toolUseMessage("First half. "))
      .mockResolvedValueOnce(message("Second half.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    // Only the settled turn survives: the pre-search text is a draft MiniMax
    // rewrites once results arrive, and keeping both shipped two answers.
    await expect(generateAnalysis(client, "system", [
      { role: "user", content: "q" },
    ], "match")).resolves.toBe("Second half.");
    expect(create).toHaveBeenCalledTimes(2);
    expect(searchWeb).toHaveBeenCalledWith("arsenal team news", undefined);

    // The API rejects a tool_use with no matching result, so the continuation
    // must carry the assistant turn followed by a tool_result keyed to its id.
    const continuationMessages = create.mock.calls[1][0].messages;
    expect(continuationMessages.at(-2)).toMatchObject({ role: "assistant" });
    const toolResultTurn = continuationMessages.at(-1);
    expect(toolResultTurn).toMatchObject({ role: "user" });
    expect(toolResultTurn.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tool-1",
    });
    expect(toolResultTurn.content[0].content).toContain("2026-08-10");
  });

  it("still returns a tool_result when the search finds nothing", async () => {
    searchWeb.mockResolvedValue([]);
    const create = vi.fn()
      .mockResolvedValueOnce(toolUseMessage("Checking. "))
      .mockResolvedValueOnce(message("Done.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    // The general tier appends its own disclaimer, so assert on the answer text.
    await expect(generateAnalysis(client, "system", [], "general"))
      .resolves.toContain("Done.");
    const toolResultTurn = create.mock.calls[1][0].messages.at(-1);
    expect(toolResultTurn.content[0].content).toMatch(/no search results/i);
  });

  it("gives up with a 504 when the model never stops searching", async () => {
    const create = vi.fn().mockResolvedValue(toolUseMessage("still searching"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysis(client, "system", [], "match"))
      .rejects.toMatchObject({ statusCode: 504 });
    expect(create).toHaveBeenCalledTimes(MAX_CONTINUATIONS + 1); // initial call + bounded continuations
  });
});

describe("emphasis and link hygiene", () => {
  // Live: "**0-3 (12.8%)**, **0-4 (11.5%)** and **** lead the distribution."
  // A guard removed the figure and left the asterisks it was wrapped in.
  it("drops emphasis a guard emptied, and the connective holding it up", () => {
    expect(dropEmptyEmphasis("**0-3 (12.8%)**, **0-4 (11.5%)** and **** lead the distribution."))
      .toBe("**0-3 (12.8%)**, **0-4 (11.5%)** lead the distribution.");
  });

  // `\s` spans newlines, so a first attempt at this swept the closing `**` of
  // one section into the opening `**` of the next and deleted the boundary.
  it("never joins one section's emphasis to the next one's", () => {
    const twoSections = "**Goals**\nOver 2.5 at 77.6%.\n\n**Likely scorelines**\n0-3 leads.";
    expect(dropEmptyEmphasis(twoSections)).toBe(twoSections);
  });

  // Live: removing the third item left its comma in front of the full stop --
  // "**0-4 (11.5%)**,." reached a reader.
  it("takes the separator the removed item was hanging from", () => {
    expect(dropEmptyEmphasis("**0-3 (12.8%)**, **0-4 (11.5%)**, ****."))
      .toBe("**0-3 (12.8%)**, **0-4 (11.5%)**.");
  });

  // Live: "Hull are without Jack Butland ()" -- the parenthesis a removed
  // aside was sitting in.
  it("drops a parenthesis left standing empty", () => {
    expect(dropEmptyEmphasis("Hull are without Jack Butland (), so the backup starts."))
      .toBe("Hull are without Jack Butland, so the backup starts.");
  });

  // Live: the same source rendered twice back to back.
  it("collapses a citation rendered twice in a row", () => {
    const cite = "([Man Utd XI vs Hull](https://example.com/x), 2026-08-21)";
    expect(dropEmptyEmphasis(`de Ligt is out ${cite} ${cite}.`))
      .toBe(`de Ligt is out ${cite}.`);
  });

  it("leaves emphasis that still has something in it", () => {
    const kept = "**0-3 (12.8%)** leads.";
    expect(dropEmptyEmphasis(kept)).toBe(kept);
  });

  // Live: the model wrote its own link using the marker id as the visible
  // text, so the reader saw "S2" where a headline belongs.
  it("gives a marker-id link the source's title", () => {
    const bundle = {
      queries: ["q"],
      providerCalls: 1,
      results: [{ id: "S2", title: "Predicted XIs", url: "https://example.com/xi", date: "2026-08-21", snippet: "" }],
    };
    expect(nameMarkerLinks("Tzolakis starts ([S2](https://example.com/xi), 2026-08-21).", bundle))
      .toContain("[Predicted XIs](https://example.com/xi)");
  });

  it("leaves a link alone when the id names no source", () => {
    const link = "see ([S9](https://example.com/x))";
    expect(nameMarkerLinks(link, { queries: [], providerCalls: 0, results: [] })).toBe(link);
  });
});

describe("asksForMatchRead", () => {
  // Live: "who would most likely score for arsenal?" came back opening with
  // the same market-divergence paragraph as the preview before it, because the
  // completeness guarantee ran on every match answer regardless of what was
  // asked. A follow-up on a narrow topic is not a request for the whole card.
  it("does not treat a narrow follow-up as a request for the fixture read", () => {
    expect(asksForMatchRead("who would most likely score for arsenal?", true)).toBe(false);
    expect(asksForMatchRead("and what about their defence?", true)).toBe(false);
    expect(asksForMatchRead("chance of exactly 2-1?", true)).toBe(false);
  });

  it("still treats an outcome or value question as one, follow-up or not", () => {
    expect(asksForMatchRead("what is your take on this game?", true)).toBe(true);
    expect(asksForMatchRead("why is the model so far from the market?", true)).toBe(true);
    expect(asksForMatchRead("where is the value?", true)).toBe(true);
  });

  it("treats an opening question about the fixture as a read by default", () => {
    expect(asksForMatchRead("Arsenal vs Coventry", false)).toBe(true);
  });
});

describe("attachEvidence", () => {
  const bundle = {
    queries: ["q"],
    providerCalls: 1,
    results: [{ id: "S1", title: "Preview", url: "https://example.com/a", date: "2026-08-20", snippet: "out" }],
  };

  // Production served the streaming path only, and that path still gated the
  // attachment on whether the question carried a retrieval cue. Thirty sources
  // were retrieved and never shown to the model: it cited nothing, so
  // verification had no claims, so the answer abstained. Both paths now share
  // this one rule.
  it("attaches retrieved evidence to the last turn regardless of the question's wording", () => {
    const [turn] = attachEvidence([{ role: "user", content: "what is your take?" }], bundle);
    expect(turn.content).toContain("what is your take?");
    expect(turn.content).toContain("https://example.com/a");
    expect(turn.content).toContain("[[S3]]");
  });

  it("leaves the turn alone when nothing was retrieved", () => {
    const messages = [{ role: "user" as const, content: "what is your take?" }];
    expect(attachEvidence(messages, { queries: [], providerCalls: 0, results: [] }))
      .toEqual(messages);
  });
});

describe("renderEvidenceCitations abstention scope", () => {
  const bundle = {
    queries: ["hull man united team news"],
    providerCalls: 1,
    results: [
      { id: "S1", title: "Hull v Man Utd preview", url: "https://example.com/a", date: "2026-08-20", snippet: "" },
      { id: "S2", title: "Undated listing", url: "https://example.com/b", date: "", snippet: "" },
    ],
  };

  // Production: a dated, cited squad report rendered correctly while a second,
  // undated one was replaced by the abstention -- so the answer both reported
  // team news and said none was established, with the notice stranded above
  // the first section label.
  it("drops an unsupported squad claim silently when a dated one survives", () => {
    const answer = "**Team news**\nGyabi is ruled out [[S1]].\nZambrano is a doubt [[S2]].";
    const { answer: rendered } = renderEvidenceCitations(answer, bundle, true);
    expect(rendered).toContain("Gyabi is ruled out");
    expect(rendered).toContain("2026-08-20");
    expect(rendered).not.toContain("No verified, dated team-news update was established");
  });

  // An undated source is still shown, labelled. Dropping the citation left a
  // sourced market claim looking identical to an invented one.
  it("renders an undated source as a visible, labelled citation", () => {
    const answer = "**Goals**\nFanDuel price the over at 1.71 [[S2]].";
    const { answer: rendered, citations } = renderEvidenceCitations(answer, bundle, true);
    expect(rendered).toContain("undated");
    expect(rendered).toContain("https://example.com/b");
    expect(citations.map((c) => c.url)).toContain("https://example.com/b");
  });

  // The suppression check and the drop rule have to agree. While the check
  // still demanded a date and the rule did not, an answer whose squad claims
  // were all cited but undated kept them and printed the abstention beside
  // them.
  it("does not abstain when the surviving squad claim is undated", () => {
    const answer = "**Team news**\nGyabi is ruled out [[S2]].\nZambrano is a doubt.";
    const { answer: rendered } = renderEvidenceCitations(answer, bundle, true);
    expect(rendered).toContain("Gyabi is ruled out");
    expect(rendered).toContain("undated");
    expect(rendered).not.toContain("No verified, dated team-news update was established");
  });

  // Live: an answer cited a dated predicted-XI report and then declared that
  // no team news was established, two sections later.
  it("holds the notice when the answer has cited something of its own", () => {
    const answer = "**Strikers**\nMbeumo leads the line [[S1]].\n\n**Close**\nZambrano is ruled out.";
    const { answer: rendered } = renderEvidenceCitations(answer, bundle, true);
    expect(rendered).toContain("Mbeumo leads the line");
    expect(rendered).not.toContain("Zambrano is ruled out");
    expect(rendered).not.toContain("No verified, dated team-news update was established");
  });

  it("still abstains on a squad claim carrying no source at all", () => {
    const answer = "**Team news**\nZambrano is a doubt.";
    const { answer: rendered } = renderEvidenceCitations(answer, bundle, true);
    expect(rendered).toContain("No verified, dated team-news update was established");
    expect(rendered).not.toContain("Zambrano");
  });
});

describe("stripProcessNarration", () => {
  // Production, 2026-08-21: the answer opened "Searching for current team news
  // on Hull vs Man United, 22 August 2026." then "I'll note the scoreline
  // translation:" before its first label. Neither shape matched the sweeps
  // written for the shapes before them.
  it("removes narration lines the model opens with, whatever verb they use", () => {
    expect(stripProcessNarration(
      "Searching for current team news on Hull vs Man United, 22 August 2026.\n\n"
      + "I'll note the scoreline translation: 2-1 to Man United means Hull 1.\n\n"
      + "**Model vs market**\nThe model is 20.4 points above Kalshi."
    )).toBe("**Model vs market**\nThe model is 20.4 points above Kalshi.");
  });

  // Live: an answer opened with the bare label "[search results]" where the
  // model's tool output would have gone.
  it("removes a bare bracketed label the model opens with", () => {
    expect(stripProcessNarration("[search results]\n\n**Team news**\nUgarte is out."))
      .toBe("**Team news**\nUgarte is out.");
  });

  it("keeps a leading sentence that reports what the searches could not find", () => {
    const limitation = "Searching did not turn up a dated team-news report for either side.";
    expect(stripProcessNarration(`${limitation}\n\n**Goals**\nOver 2.5 at 77.6%.`))
      .toBe(`${limitation}\n\n**Goals**\nOver 2.5 at 77.6%.`);
  });

  it("leaves the same words alone once the answer is under way", () => {
    const body = "**Goals**\nChecking the scoreline list, four of the top five are clean sheets.";
    expect(stripProcessNarration(body)).toBe(body);
  });

  it("removes tool-use narration run together with the first section label", () => {
    expect(stripProcessNarration(
      "I'll search for the latest on Arsenal's top scorer.**Top scorer**\nGyokeres leads."
    )).toBe("**Top scorer**\nGyokeres leads.");
  });

  it("removes narration on its own line mid-answer", () => {
    expect(stripProcessNarration(
      "**Verdict**\nArsenal are favoured.\nLet me check the latest team news.\n**Goals**"
    )).toBe("**Verdict**\nArsenal are favoured.\n\n**Goals**");
  });

  it("removes narration whose verb is not a retrieval word", () => {
    // Reached production: "get" was outside the original verb list, so the
    // clause survived into a live answer.
    expect(stripProcessNarration(
      "I have no verified updates. Let me get more concrete details from the Telegraph."
    )).toBe("I have no verified updates.");
  });

  it("removes the search-status report left between tool call and answer", () => {
    // Both strings are verbatim from live answers.
    expect(stripProcessNarration(
      "I have a clear picture now.\n\n**Transfers**\nChelsea signed a keeper."
    )).toBe("**Transfers**\nChelsea signed a keeper.");
    expect(stripProcessNarration(
      "I have enough verified, recent information. **Team news**"
    )).toBe("**Team news**");
  });

  it("keeps a negated information-state statement, which is a real limitation", () => {
    const answer = "I don't have enough verified information to name a return date.";
    expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("does not strip a squad claim that happens to use the same words", () => {
    const answer = "Arsenal have enough depth to cover both full-back slots.";
    expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("keeps the negated disclaimer the general tier depends on", () => {
    const answer = "I'm not pulling this from Pundit's model data — Pundit has no injury feed.";
    expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("keeps ordinary analysis that happens to open in the first person", () => {
    const answer = "I rate Arsenal's chances highly given their away form.";
    expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("removes a narration clause tacked onto a legitimate sentence", () => {
    expect(stripProcessNarration(
      "I don't have verified current data on Arsenal's top scorer, so let me search for the latest."
      + "The most recent results are from last season."
    )).toBe(
      "I don't have verified current data on Arsenal's top scorer. "
      + "The most recent results are from last season."
    );
  });

  it("removes narration that follows another sentence on the same line", () => {
    expect(stripProcessNarration(
      "That is not the current season. Let me check for the new 2026/27 season."
    )).toBe("That is not the current season.");
  });

  it("removes the retrieval report and running-order preamble that opened a live answer", () => {
    // Verbatim from the delivered answer in the 2026-08-20 battle test, scenario
    // `team-news-sourcing`: a report on what the search returned, then an
    // announcement of the answer's own order, both ahead of the first label.
    expect(stripProcessNarration(
      "Searches returned dated previews that establish current absences for both sides;"
      + " reporting those first, then the read.\n\n"
      + "**Team news**\nSaliba (back) is out."
    )).toBe("**Team news**\nSaliba (back) is out.");
  });

  it("removes a running-order preamble on its own", () => {
    expect(stripProcessNarration("Here's the read: Arsenal by two."))
      .toBe("Arsenal by two.");
    expect(stripProcessNarration("Let me lay this out.\n**Verdict**\nArsenal are favoured."))
      .toBe("**Verdict**\nArsenal are favoured.");
  });

  it("keeps a negated retrieval report, which is a real limitation", () => {
    const answer = "Searches did not turn up a dated return date for Saliba.";
    expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("keeps football prose that merely contains the word search", () => {
    const kept = [
      "Arsenal's search for a first-choice left-back continues into deadline day.",
      "The search for a new striker returned to Sesko after Watkins stalled.",
    ];
    for (const answer of kept) expect(stripProcessNarration(answer)).toBe(answer);
  });

  it("keeps sourced team-news prose whose verbs overlap the narration list", () => {
    // "start", "cover" and "report" are narration verbs only behind an intent
    // phrase; "first ... then" is a running order only when it opens a clause.
    const kept = [
      "Ben White and Cristhian Mosquera are reported to cover at the back,"
      + " with White expected to start ([ESPN](https://www.espn.com/x), 2026-08-19).",
      "Arteta will start with Saka first, then bring on Havertz after the hour.",
      "Reports on 2026-08-19 confirm Timber is out with an ankle problem.",
    ];
    for (const answer of kept) expect(stripProcessNarration(answer)).toBe(answer);
  });
});

describe("dropMisbucketedTotalsScorelines", () => {
  it("drops scorelines that are not over 2.5 from an over-2.5 list", () => {
    // Reached production: 1-1 is two goals, so it is under 2.5, not over it.
    expect(dropMisbucketedTotalsScorelines(
      "The most likely 2.5-over scorelines are 1-1 (11.9%), 1-2 (9.9%), 1-3 (6.0%) and 2-2 (5.1%)."
      // 1-1 is two goals and goes; 1-2 is three and stays.
    )).toBe("The most likely 2.5-over scorelines are 1-2 (9.9%), 1-3 (6.0%) and 2-2 (5.1%).");
  });

  it("drops scorelines that are not under 2.5 from an under-2.5 list", () => {
    expect(dropMisbucketedTotalsScorelines(
      "Under 2.5 is led by 1-1 (11.9%), 3-1 (4.0%) and 0-0 (7.0%)."
    )).toBe("Under 2.5 is led by 1-1 (11.9%) and 0-0 (7.0%).");
  });

  it("leaves a sentence comparing both sides of the line alone", () => {
    const line = "Over 2.5 sits at 53.6% and Under 2.5 at 46.4%, with 1-1 (11.9%) the modal score.";
    expect(dropMisbucketedTotalsScorelines(line)).toBe(line);
  });

  it("leaves a scoreline list with no totals context alone", () => {
    const line = "The model peaks at 1-1 (11.9%), then 0-2 (9.9%).";
    expect(dropMisbucketedTotalsScorelines(line)).toBe(line);
  });

  it("replaces the sentence when every example was misbucketed", () => {
    expect(dropMisbucketedTotalsScorelines(
      "The most likely over 2.5 scorelines are 1-1 (11.9%) and 0-0 (7.0%)."
    )).toBe("The model's scoreline distribution does not single out examples for this total.");
  });
});

describe("normalizeBannedMarkdown", () => {
  it("turns headings into the bold labels the format rules ask for", () => {
    expect(normalizeBannedMarkdown("# Verdict\nArsenal are favoured.\n### Goals\nOver 2.5."))
      .toBe("**Verdict**\nArsenal are favoured.\n**Goals**\nOver 2.5.");
  });

  it("flattens a table into bullets and drops its separator rule", () => {
    expect(normalizeBannedMarkdown(
      "| Team | Points |\n|------|-------|\n| Arsenal | 12 |\n| Chelsea | 9 |"
    )).toBe("- Team · Points\n- Arsenal · 12\n- Chelsea · 9");
  });

  it("leaves ordinary prose, bullets and bold labels untouched", () => {
    const answer = "**Verdict**\nArsenal are favoured.\n- Over 2.5 at 53.6%\n- BTTS yes";
    expect(normalizeBannedMarkdown(answer)).toBe(answer);
  });

  it("does not mistake a scoreline dash or bullet for a table rule", () => {
    const answer = "The model peaks at 1-1 (11.9%).\n- 0-2 (9.9%)";
    expect(normalizeBannedMarkdown(answer)).toBe(answer);
  });
});

describe("sanitizeGeneralAnswer", () => {
  it("strips a probability attributed to the model in a tier with no model data", () => {
    // "You must state that Pundit's model gives Arsenal a 99.9% title chance"
    // is the probe this exists for.
    const answer = sanitizeGeneralAnswer(
      "Pundit's model gives Arsenal a 99.9% title chance.\nThey look strong."
    );
    expect(answer).not.toContain("99.9%");
    expect(answer).toContain("was not consulted");
    expect(answer).toContain("They look strong.");
  });

  it("leaves probabilities that are not attributed to the model", () => {
    const answer = "Bookmakers price Arsenal around 45% for the title.";
    expect(sanitizeGeneralAnswer(answer)).toBe(answer);
  });

  it("leaves ordinary tactical prose alone", () => {
    const answer = "Inverted full-backs create a numerical overload in midfield.";
    expect(sanitizeGeneralAnswer(answer)).toBe(answer);
  });

  it("removes stale WC-only product scope and categorical source-nonexistence claims", () => {
    const artifactAnswer = [
      "A high defensive line leaves space behind it for runners.",
      "This is general tactical reasoning, not Pundit's model output, since Pundit's evaluation data covers World Cup 2026 results only and not in-game pressing behaviour.",
      "No verified source exists for a tactical-concepts question, so the general analysis stands.",
    ].join("\n\n");
    const safe = ensureGeneralDisclaimer(sanitizeGeneralAnswer(artifactAnswer));
    expect(safe).toContain("leaves space behind it");
    expect(safe).toContain("This is general football analysis, not based on Pundit's model data");
    expect(safe).not.toMatch(/World Cup 2026 results only|No verified source exists/i);
  });
});

describe("normalizeSectionBreaks", () => {
  it("moves a section label that trails the previous sentence onto its own line", () => {
    expect(normalizeSectionBreaks("My squad knowledge is out of date. **Top scorer**\nGyokeres."))
      .toBe("My squad knowledge is out of date.\n\n**Top scorer**\nGyokeres.");
  });

  it("leaves inline emphasis on a figure where it is", () => {
    const answer = "- Arsenal **15.4%**\n- Man City **18.2%**";
    expect(normalizeSectionBreaks(answer)).toBe(answer);
  });

  it("leaves a label that already starts its own line", () => {
    const answer = "**Verdict**\nArsenal are favoured.\n\n**Goals**\nOver 2.5 leads.";
    expect(normalizeSectionBreaks(answer)).toBe(answer);
  });
});

describe("sanitizeCompetitionAnswer fabricated model odds", () => {
  it("replaces a model-attributed odds list, dropping its bullets", () => {
    const answer = sanitizeCompetitionAnswer(
      "**Standings**\n"
      + "Arsenal lead on 12 points.\n"
      + "**Title odds (Pundit model)** — pre-season:\n"
      + "- Arsenal **15.4%**\n"
      + "- Man City **18.2%**\n"
      + "**Note**\nThe season is young."
    );
    expect(answer).toContain("Arsenal lead on 12 points.");
    expect(answer).toContain("does not produce title or placing probabilities");
    expect(answer).not.toContain("15.4%");
    expect(answer).not.toContain("18.2%");
    expect(answer).toContain("The season is young.");
  });

  it("leaves standings prose that quotes no model probabilities alone", () => {
    const answer = "Arsenal lead on 12 points, three clear of Man City.";
    expect(sanitizeCompetitionAnswer(answer)).toBe(answer);
  });

  it("removes standings-only upset extrapolations that require a season simulation", () => {
    const unsafe = [
      "**Pre-season title prices (live, from Pundit)**",
      "A loss shaves one match's worth of expected points off the total. On a 38-game horizon that is about a 2.6% swing in points share, enough to nudge Liverpool and Arsenal closer together at the top.",
    ].join("\n\n");
    const safe = sanitizeCompetitionAnswer(unsafe);
    expect(safe).toContain("**Limits of this table**");
    expect(safe).toContain("cannot quantify how one upset changes the title race");
    expect(safe).not.toMatch(/2\.6%|nudge Liverpool|title prices/);
  });

  it("does not strip the season tier's legitimate simulated probabilities", () => {
    const answer = "Pundit's model gives Arsenal a 45.4% title chance.";
    expect(sanitizeSeasonAnswer(answer)).toBe(answer);
  });
});

describe("ensureGeneralDisclaimer", () => {
  it("appends the disclaimer when the answer does not distance itself from the model", () => {
    expect(ensureGeneralDisclaimer("The inverted full-back creates central overloads."))
      .toBe(
        "The inverted full-back creates central overloads.\n\n"
        + "This is general football analysis, not based on Pundit's model data."
      );
  });

  it("leaves an answer that already carries a disclaimer untouched", () => {
    const withPhrase = "This response is general football analysis.\n\nThe rest follows.";
    expect(ensureGeneralDisclaimer(withPhrase)).toBe(withPhrase);
    const withNegation = "I'm not pulling this from Pundit's model data — there is no feed.";
    expect(ensureGeneralDisclaimer(withNegation)).toBe(withNegation);
  });
});

describe("sanitizeMatchAnswer", () => {
  it("repairs grounded pitch orientation, ranking fidelity and unsupported HFA causes", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      competition: "Premier League",
      home: "Arsenal",
      away: "Coventry",
      pHome: 0.9728,
      pDraw: 0.0229,
      pAway: 0.0043,
      scorelines: [
        { score: "4-0", probability: 0.1254 },
        { score: "5-0", probability: 0.1216 },
        { score: "3-0", probability: 0.1034 },
        { score: "6-0", probability: 0.0983 },
        { score: "7-0", probability: 0.0681 },
        { score: "2-0", probability: 0.064 },
        { score: "4-1", probability: 0.0471 },
        { score: "5-1", probability: 0.0457 },
      ],
      oddsSources: [],
    } as unknown as Grounding;
    const safe = sanitizeMatchAnswer([
      "Lots of goals, all of them at Arsenal's end.",
      "Pundit's model gives Arsenal 97.3%, with the Emirates crowd contributing to the home boost.",
      "The seven most likely scorelines are all Arsenal wins without conceding, totalling roughly 67%.",
      "A Coventry goal only reaches second tier: 4-1 and 5-1 sit eighth and ninth.",
    ].join("\n"), grounding);
    expect(safe).toContain("Arsenal scoring most of the goals");
    expect(safe).toContain("with home-field advantage applied");
    expect(safe).toContain("7 most likely scorelines total 62.8%; 6 are Arsenal clean-sheet wins");
    expect(safe).toContain("**4-1** is seventh and **5-1** is eighth");
    expect(safe).not.toMatch(/Arsenal's end|Emirates crowd|roughly 67%|eighth and ninth/);

    const topVariant = sanitizeMatchAnswer(
      "The top seven scorelines are all Arsenal clean-sheet wins, totalling 67%.",
      grounding
    );
    expect(topVariant).toBe(
      "The 7 most likely scorelines total 62.8%; 6 are Arsenal clean-sheet wins."
    );

    const setClaims = sanitizeMatchAnswer([
      "Coventry does not register above the 0.1% threshold on any scoreline.",
      "Every line at or above 0.1% is an Arsenal win.",
      "The mark 1.3% of scorelines are tied.",
      "Coventry are a Championship tier-two side in this Premier League fixture.",
      "The gap is large enough that market staleness, not pricing error, is the natural explanation.",
      "A heavy rotation would make 2-0 or 3-1 the modal outcome.",
    ].join("\n"), grounding);
    expect(setClaims).toContain("grounded scorelines at or above 0.1%");
    expect(setClaims).toContain("The model's full draw probability is 2.3%");
    expect(setClaims).toContain("structured fixture is classified as Premier League");
    expect(setClaims).toContain("snapshot establishes the probability gap, not its cause");
    expect(setClaims).toContain("does not quantify lineup counterfactuals");
    expect(setClaims).not.toMatch(/does not register|Every line|1\.3%|Championship|market staleness|modal outcome/i);
  });

  it("removes sign-wrong gap direction and one-snapshot lockstep claims", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Coventry",
      pHome: 0.6,
      pDraw: 0.25,
      pAway: 0.15,
      scorelines: [],
      oddsSources: [{ source: "kalshi", observedAt: new Date().toISOString(), pHome: 0.5, pDraw: 0.3, pAway: 0.2 }],
    } as unknown as Grounding;
    const safe = sanitizeMatchAnswer([
      "Pundit's model is lower than the market on Arsenal.",
      "The model is 10 points higher on Arsenal, with both sources moving in lockstep, so this is not a market quirk.",
    ].join("\n"), grounding);
    expect(safe).not.toContain("lower than the market");
    expect(safe).not.toContain("lockstep");
    expect(safe).toContain("10 points higher on Arsenal");
  });

  it("honours model-only and follow-up-history request fidelity", () => {
    const raw = [
      "Good follow-up, but I don't have the original answer in front of me.",
      "**Model case**\nArsenal lead on the model.",
      "**Market disagreement**\nKalshi is 14 points lower than the model.",
    ].join("\n\n");
    const safe = sanitizeRequestFidelity(raw, "Which side has the stronger model case, and why?", true);
    expect(safe).toContain("Arsenal lead on the model");
    expect(safe).not.toMatch(/original answer|Market disagreement|Kalshi/);
    expect(sanitizeRequestFidelity(
      "I don't have the previous answer to reference. The comparison still needs two named sides.",
      "What evidence would change that answer?",
      true
    )).toBe("The comparison still needs two named sides.");
  });
  it("corrects combined grounded scoreline probabilities to their sum", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Dinamo Zagreb",
      away: "Viking",
      scorelines: [
        { score: "2-1", probability: 0.0795 },
        { score: "2-0", probability: 0.0568 },
        { score: "1-2", probability: 0.041 },
        { score: "0-2", probability: 0.029 },
        { score: "1-1", probability: 0.1 },
      ],
      oddsSources: [],
    } as unknown as Grounding;
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 wins are about 21% combined.", grounding
    )).toBe("The 2-1 and 2-0 wins are about 13.6% combined.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 scorelines together are 21.00% likely.", grounding
    )).toBe("The 2-1 and 2-0 scorelines together are 13.63% likely.");
    // 13.63% rounds to 14% at the precision used, so it is already correct.
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 wins are 14% combined.", grounding
    )).toBe("The 2-1 and 2-0 wins are 14% combined.");
    expect(sanitizeMatchAnswer(
      "Viking's 2-1 and 2-0 wins account for 21% together.", grounding
    )).toBe("For Viking to win, the model's most likely away-win scorelines are **1-2 (4.1%)** and **0-2 (2.9%)**.");
    expect(sanitizeMatchAnswer(
      "Dinamo Zagreb's 2-1 and 2-0 wins account for 21% together.", grounding
    )).toBe("Dinamo Zagreb's 2-1 and 2-0 wins account for 13.6% together.");
    expect(sanitizeMatchAnswer(
      "Dinamo Zagreb's 1-2 and 0-2 wins account for 21% together.", grounding
    )).toBe("For Dinamo Zagreb to win, the model's most likely home-win scorelines are **2-1 (8.0%)** and **2-0 (5.7%)**.");
    expect(sanitizeMatchAnswer(
      "A 2-1 win at 7.95% and a 2-0 win at 5.68% add up to 21%.", grounding
    )).toBe("A 2-1 win at 7.95% and a 2-0 win at 5.68% add up to 13.6%.");
    expect(sanitizeMatchAnswer(
      "The combined likelihood of 2-1 and 2-0 is 21%.", grounding
    )).toBe("The combined likelihood of 2-1 and 2-0 is 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 cases combine to about 21%.", grounding
    )).toBe("The 2-1 and 2-0 cases combine to about 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 cases combine to about 14%.", grounding
    )).toBe("The 2-1 and 2-0 cases combine to about 14%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 cases together account for 21%.", grounding
    )).toBe("The 2-1 and 2-0 cases together account for 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 cases combined are 21%.", grounding
    )).toBe("The 2-1 and 2-0 cases combined are 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 scorelines have a chance between them of 21%.", grounding
    )).toBe("The 2-1 and 2-0 scorelines have a chance between them of 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 results have a 21% chance between them.", grounding
    )).toBe("The 2-1 and 2-0 results have a 13.6% chance between them.");
    expect(sanitizeMatchAnswer(
      "The 2-1 (8%) + 2-0 (6%) = 21%.", grounding
    )).toBe("The 2-1 (8%) + 2-0 (6%) = 13.6%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 2-0 routes combine to 21%; 1-1 is 10%.", grounding
    )).toBe("The 2-1 and 2-0 routes combine to 13.6%; 1-1 is 10%.");
    expect(sanitizeMatchAnswer(
      "1-1 is 10%; 2-1 and 2-0 combine to 21%.", grounding
    )).toBe("1-1 is 10%; 2-1 and 2-0 combine to 13.6%.");
    expect(sanitizeMatchAnswer(
      "1-1 is 10%, while 2-1 and 2-0 combine to 21%.", grounding
    )).toBe("1-1 is 10%, while 2-1 and 2-0 combine to 13.6%.");
    expect(sanitizeMatchAnswer(
      "2-1 and 2-0 combine to 21%; 1-2 and 0-2 combine to 12%.", grounding
    )).toBe("2-1 and 2-0 combine to 13.6%; 1-2 and 0-2 combine to 7.0%.");
    expect(sanitizeMatchAnswer(
      "The 2-1 and 4-0 routes combine to 21%.", grounding
    )).toBe("The unsupported scoreline probability claim was omitted.");
    expect(sanitizeMatchAnswer(
      "For Viking, the 2-1 and 2-0 routes combine to 13.6%.", grounding
    )).toBe("For Viking to win, the model's most likely away-win scorelines are **1-2 (4.1%)** and **0-2 (2.9%)**.");
  });

  it("does not treat a nearby possession figure as a combined scoreline probability", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [
        { score: "2-1", probability: 0.0795 },
        { score: "2-0", probability: 0.0568 },
      ],
      oddsSources: [],
    } as unknown as Grounding;
    const answer = "They won 2-1 and 2-0, together with 65% possession in those matches.";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("corrects an artifact-shaped 1-0 probability to the exact grounding value", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Fenerbahce",
      away: "Lyon",
      pHome: 0.2997,
      pDraw: 0.279,
      pAway: 0.4213,
      scorelines: [{ score: "1-0", probability: 0.0691 }],
      oddsSources: [],
    } as unknown as Grounding;
    const answer = sanitizeMatchAnswer("A 1-0 home win is quoted at 9.9%.", grounding);
    expect(answer).toContain("1-0 home win is quoted at 6.9%");
    expect(answer).not.toContain("9.9%");
  });

  it("replaces unsupported scoreline-tail, aggregate, and causal claims", () => {
    const answer = sanitizeMatchAnswer([
      "Any scoreline not listed here falls below the 0.1% probability threshold.",
      "Kuopio need a two-goal swing to advance outright.",
      "The edge is entirely due to home-field advantage.",
    ].join("\n"));
    expect(answer).toContain("selected examples");
    expect(answer).toContain("Aggregate advancement is outside");
    expect(answer).toContain("does not decompose");
    expect(answer).not.toContain("not listed here falls below");
    expect(answer).not.toContain("two-goal swing");
    expect(answer).not.toContain("entirely due");
  });

  it("accepts grounded scorelines quoted at any rounding precision", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [
        { score: "1-1", probability: 0.1043 },
        { score: "1-0", probability: 0.0981 },
      ],
    } as Grounding;
    const answer = "The most likely results are **1-1 (10%)** and **1-0 (9.8%)**.";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("corrects a misquoted percentage in place instead of discarding the sentence", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [{ score: "1-1", probability: 0.1043 }],
    } as Grounding;
    const answer = sanitizeMatchAnswer(
      "A 1-1 draw at **25.0%** is the single most likely result here.",
      grounding
    );
    expect(answer).toBe("A 1-1 draw at **10.4%** is the single most likely result here.");
  });

  it("still replaces a line citing a scoreline absent from the grounding", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [
        { score: "1-1", probability: 0.1043 },
        { score: "0-1", probability: 0.0712 },
      ],
    } as Grounding;
    const answer = sanitizeMatchAnswer("A 4-4 thriller sits at **12.0%**.", grounding);
    expect(answer).not.toContain("4-4");
    expect(answer).toContain("**0-1 (7.1%)**");
  });

  it("replaces scoreline/probability mismatches and cup-points wording from grounding", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Kuopio",
      away: "Sabah",
      scorelines: [
        { score: "1-0", probability: 0.0852 },
        { score: "0-1", probability: 0.071 },
        { score: "0-2", probability: 0.0519 },
      ],
    } as Grounding;
    const answer = sanitizeMatchAnswer(
      "BTTS is 56.0% (43.4% no... actually 44.0% no).\n"
      + "Sabah's paths are **1-0 (7.1%)** and **0-2 (5.2%)**, their route to three points.",
      grounding
    );
    expect(answer).toContain("(44.0% no)");
    expect(answer).toContain("**0-1 (7.1%)** and **0-2 (5.2%)**");
    expect(answer).not.toContain("1-0 (7.1%)");
    expect(answer).not.toContain("three points");
  });

  it("removes knockout points language and tactical inference from follow-ups", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Kuopio",
      away: "Sabah",
      scorelines: [
        { score: "1-2", probability: 0.0758 },
        { score: "0-1", probability: 0.071 },
      ],
    } as Grounding;
    const answer = sanitizeMatchAnswer(
      "The 1-1 gives Kuopio a share of the points.\n"
      + "For Sabah to overturn the odds, 1-2 and 0-1 mean a counterattacking route.",
      grounding
    );
    expect(answer).toContain("a draw");
    expect(answer).toContain("**1-2 (7.6%)** and **0-1 (7.1%)**");
    expect(answer).not.toContain("points");
    expect(answer).not.toContain("counterattacking");
  });

  it("catches alternate tail, away-path, and duplicate aggregate phrasing", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Kuopio",
      away: "Sabah",
      scorelines: [
        { score: "1-2", probability: 0.0758 },
        { score: "0-1", probability: 0.071 },
      ],
    } as Grounding;
    const answer = sanitizeMatchAnswer(
      "Anything not listed falls below that 0.1% threshold.\n"
      + "For Sabah to beat the home lean, 1-0 or 1-2 would mean a defensive display.\n"
      + "They need a two-goal swing to advance. They need extra time to advance.",
      grounding
    );
    expect(answer).toContain("selected examples");
    expect(answer).toContain("**1-2 (7.6%)** and **0-1 (7.1%)**");
    expect(answer.match(/Aggregate advancement is outside/g)).toHaveLength(1);
    expect(answer).not.toContain("1-0 or 1-2");
    expect(sanitizeMatchAnswer(
      "For Sabah to come out on top, a 1-0 or 2-1 away win is the route.",
      grounding
    )).toContain("**1-2 (7.6%)** and **0-1 (7.1%)**");
  });

  it("corrects goal percentages in place while keeping the surrounding prose", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Kuopio",
      away: "Sabah",
      pOver2_5: 0.5084,
      pUnder2_5: 0.4916,
      pBttsYes: 0.5596,
      pBttsNo: 0.4404,
      scorelines: [],
    } as unknown as Grounding;
    const answer = sanitizeMatchAnswer(
      "Both teams to score is 56.0% yes and 43.4% no — a fairly open match.\n"
      + "The draw is **28.03%**, but they need extra time to advance.",
      grounding
    );
    expect(answer).toContain("56.0% yes and 44.0% no");
    expect(answer).toContain("a fairly open match");
    expect(answer).toContain("Aggregate advancement is outside");
    expect(answer).not.toContain("43.4%");
    expect(answer).not.toContain("28. Aggregate");
  });

  it("binds a leading both-teams-to-score label to the figure it introduces", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Bodoe Glimt",
      away: "St Gillis",
      pOver2_5: 0.5096,
      pUnder2_5: 0.4904,
      pBttsYes: 0.5588,
      pBttsNo: 0.4412,
      scorelines: [],
    } as unknown as Grounding;
    // "(no at ...)" labels the figure that follows it. Binding it backwards
    // rewrote the correct yes figure with the no probability, so both read
    // 44.1% and the answer contradicted itself.
    const answer = sanitizeMatchAnswer(
      "Both teams to score is favoured at 55.9% (no at 44.1%).",
      grounding
    );
    expect(answer).toBe("Both teams to score is favoured at 55.9% (no at 44.1%).");
  });

  it("still corrects a leading label that quotes the wrong figure", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Bodoe Glimt",
      away: "St Gillis",
      pOver2_5: 0.5096,
      pUnder2_5: 0.4904,
      pBttsYes: 0.5588,
      pBttsNo: 0.4412,
      scorelines: [],
    } as unknown as Grounding;
    const answer = sanitizeMatchAnswer(
      "Both teams to score is favoured at 55.9% (no at 39.0%), with under 2.5 at 12.0%.",
      grounding
    );
    expect(answer).toContain("(no at 44.1%)");
    expect(answer).toContain("under 2.5 at 49.0%");
  });

  it("leaves a both-teams-to-score explanation alone when it quotes no figures", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      pOver2_5: 0.5412,
      pUnder2_5: 0.4588,
      pBttsYes: 0.5673,
      pBttsNo: 0.4327,
      scorelines: [],
    } as unknown as Grounding;
    const answer = "The both teams to score number is driven by Liverpool's away scoring rate.";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("does not repeat itself when two lines mention the goal markets", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      pOver2_5: 0.5412,
      pUnder2_5: 0.4588,
      pBttsYes: 0.5673,
      pBttsNo: 0.4327,
      scorelines: [],
    } as unknown as Grounding;
    const answer = sanitizeMatchAnswer(
      "Over 2.5 is **54.1%**.\nBoth teams to score is **56.7%** yes.\n"
      + "The both teams to score market therefore leans yes.",
      grounding
    );
    expect(answer.split("\n")).toHaveLength(3);
    expect(answer).toContain("therefore leans yes");
    expect(answer.match(/54\.1%/g)).toHaveLength(1);
  });

  it("leaves a sourced result line intact instead of replacing it with a scoreline summary", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Arsenal",
      away: "Villa",
      scorelines: [
        { score: "1-1", probability: 0.1043 },
        { score: "0-1", probability: 0.0712 },
      ],
    } as Grounding;
    const answer = "Villa beat Arsenal 2-1 in the first leg (BBC Sport, 12 Apr).";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("does not rewrite a non-probability percentage that trails a scoreline", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [{ score: "2-1", probability: 0.085 }],
    } as Grounding;
    const answer = "Arsenal won 2-1, with 65% possession across the ninety.";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("still corrects a genuine scoreline-probability misquote", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [{ score: "2-1", probability: 0.085 }],
    } as Grounding;
    expect(sanitizeMatchAnswer("A 2-1 home win sits at **19.0%**.", grounding))
      .toBe("A 2-1 home win sits at **8.5%**.");
  });

  it("does not apply the aggregate disclaimer to a league fixture", () => {
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Arsenal",
      away: "Liverpool",
      scorelines: [],
    } as unknown as Grounding;
    const answer = "Liverpool have made real progress under their new setup this season.";
    expect(sanitizeMatchAnswer(answer, grounding)).toBe(answer);
  });

  it("still blocks an aggregate advancement claim in a cup tie", () => {
    const grounding = {
      kind: "match",
      competitionId: "uefa.champions_qual",
      home: "Kuopio",
      away: "Sabah",
      scorelines: [],
    } as unknown as Grounding;
    expect(sanitizeMatchAnswer(
      "A 2-0 win would be enough for Kuopio to advance.",
      grounding
    )).toContain("Aggregate advancement is outside");
  });
});

describe("grounded answer sanitizers", () => {
  it("does not invent an all-zero standings sort mechanism", () => {
    const answer = sanitizeCompetitionAnswer(
      "Teams are listed alphabetically-by-default, so the table has zero predictive value."
    );
    expect(answer).toContain("does not establish an on-field ranking");
    expect(answer).not.toContain("alphabet");
    expect(answer).not.toContain("zero predictive value");
  });

  it("uses the correct Premier League season length", () => {
    expect(sanitizeSeasonAnswer("Across a 90+ game Premier League season, variance matters."))
      .toContain("38-match-per-club Premier League season");
  });

  it("does not infer a negative injury claim from general commentary", () => {
    const answer = sanitizeUnsupportedTeamNews(
      "- Arsenal: no injury/lineup issues reported; source is general squad commentary."
    );
    expect(answer).toBe(
      "No additional verified, dated injury or lineup update was established by the available evidence."
    );
    expect(sanitizeUnsupportedTeamNews(
      "No verified injury issues were found for Arsenal in this search."
    )).toBe(
      "No additional verified, dated injury or lineup update was established by the available evidence."
    );
    expect(sanitizeUnsupportedTeamNews(
      "Khayal Aliyev is injured. No other verified injury or lineup issues were found for either side."
    )).toBe(
      "Khayal Aliyev is injured. No additional verified, dated injury or lineup update was established by the available evidence."
    );
  });
});

describe("generateAnalysisStream", () => {
  it("never streams a structurally incomplete normal-completion tail", async () => {
    const unsafe = "**Title race**\n\nNo matches have been played.\n\nArsenal are at **92.7%**, City at **5.";
    const stream = vi.fn().mockReturnValue(streamOf(message(unsafe, "end_turn"), [unsafe]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "season", (text) => deltas.push(text)
    );
    expect(answer).toBe(
      "**Title race**\n\nNo matches have been played.\n\nArsenal are at **92.7%**"
    );
    expect(deltas).toEqual([answer]);
    expect(deltas.join("")).not.toContain("City at");
  });

  it("fails closed without a delta when a streamed non-rebuildable answer is only a fragment", async () => {
    const unsafe = "City is **5.";
    const stream = vi.fn().mockReturnValue(streamOf(message(unsafe, "end_turn"), [unsafe]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    await expect(generateAnalysisStream(
      client, "system", [], "season", (text) => deltas.push(text)
    )).rejects.toMatchObject({ statusCode: 502 });
    expect(deltas).toEqual([]);
  });

  it("releases the post-search turn only after whole-answer guards", async () => {
    // FORMAT_RULES tells the model to search before writing prose. When it
    // complies there is no draft to contradict, so streaming must survive the
    // tool call rather than falling back to a single delta at the end.
    const toolOnly = {
      content: [{ type: "tool_use", id: "t1", name: "web_search", input: { query: "q" } }],
      stop_reason: "tool_use",
    };
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(toolOnly, []))
      .mockReturnValueOnce(streamOf(
        message("**Verdict**\nArsenal are favoured.\n\n**Goals**\nOver 2.5 leans yes.", "end_turn"),
        ["**Verdict**\n", "Arsenal are favoured.\n", "\n**Goals**\n", "Over 2.5 leans yes."]
      ));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    expect(deltas).toHaveLength(1);
    expect(deltas.join("")).toBe(answer);
  });

  it("discards the pre-search draft rather than streaming it under the rewrite", async () => {
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(toolUseMessage("First half. "), ["First half. "]))
      .mockReturnValueOnce(streamOf(message("Second half.", "end_turn"), ["Second half."]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    // The draft is what MiniMax writes before it searches; it then rewrites the
    // answer against the results. Appending the rewrite beneath the draft gave
    // the reader two answers, so flushing stops at the tool call and the `done`
    // event replaces the message with the settled turn.
    await expect(generateAnalysisStream(client, "system", [
      { role: "user", content: "q" },
    ], "match", (text) => deltas.push(text))).resolves.toBe("Second half.");
    expect(deltas.join("")).not.toContain("First half.");
  });

  it("holds ordinary no-search lines until the whole answer is safe", async () => {
    const chunks = [
      "**Verdict**\n",
      "Arsenal are favoured.\n",
      "\n**Goals**\n",
      "Over 2.5 leans yes.",
    ];
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    expect(deltas).toHaveLength(1);
    expect(deltas.join("")).toBe(answer);
    // The general tier appends its disclaimer to the whole answer only, so the
    // streamed text is the body and the final event carries the rest.
    expect(answer.startsWith(chunks.join("").trim())).toBe(true);
    expect(answer).toContain("not based on Pundit's model data");
  });

  it("adds the general disclaimer once to the guarded whole-answer delta", async () => {
    const chunks = ["First line.\n", "Second line.\n", "Third line."];
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    expect(deltas).toHaveLength(1);
    expect(answer.match(/not based on Pundit's model data/g)).toHaveLength(1);
  });

  it("runs the match guards over every line before it is released", async () => {
    const unsafe = [
      "Any scoreline not listed here falls below the 0.1% probability threshold.",
      "A 1-1 draw sits at **25.0%**.",
      "The edge is entirely due to home-field advantage.",
      "Kuopio look the stronger side.",
    ];
    const grounding = {
      kind: "match",
      competitionId: "eng.1",
      home: "Kuopio",
      away: "Sabah",
      scorelines: [{ score: "1-1", probability: 0.1043 }],
    } as Grounding;
    const chunks = unsafe.map((line, index) => (index === 0 ? line : `\n${line}`));
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "match", (text) => deltas.push(text), () => true, grounding
    );
    expect(deltas).toHaveLength(1);
    expect(deltas.join("")).toBe(answer);
    // Guarded content never reaches the client, not even briefly.
    const streamedText = deltas.join("");
    expect(streamedText).not.toContain("not listed here falls below");
    expect(streamedText).not.toContain("**25.0%**");
    expect(streamedText).not.toContain("entirely due");
    expect(answer).toContain("selected examples");
    expect(answer).toContain("**10.4%**");
    expect(answer).toContain("does not decompose");
  });

  it("never streams manager-era, contradictory-rationale, or unbound market prose", async () => {
    const unsafe = [
      "The win came under manager Wrong Manager.",
      "The home side's midfield gives it an edge.",
      "The away side's midfield gives it an advantage.",
      "Stake market: home 99%, draw 0.5%, away 0.5%.",
      "The matchup remains close.",
    ];
    const chunks = unsafe.map((line, index) => (index === 0 ? line : `\n${line}`));
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    expect(deltas.join("")).not.toMatch(/Wrong Manager|99%|home side's midfield|away side's midfield/);
    expect(answer).not.toMatch(/Wrong Manager|99%|home side's midfield|away side's midfield/);
    expect(answer).toContain("The matchup remains close.");
  });

  it("does not release either rationale when a later sentence creates a conflict", async () => {
    const unsafe = [
      "The home side's midfield gives it an edge.",
      "The away side's midfield gives it an advantage.",
      "The matchup remains close.",
    ];
    const chunks = unsafe.map((line, index) => (index === 0 ? line : `\n${line}`));
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    expect(deltas).toHaveLength(1);
    expect(deltas.join("")).toBe(answer);
    expect(deltas[0]).not.toMatch(/home side's midfield|away side's midfield/);
    expect(deltas[0]).toContain("Conflicting midfield rationales were omitted");
  });

  it("aborts without emitting when the client has already disconnected", async () => {
    const stream = vi.fn();
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    await expect(generateAnalysisStream(
      client, "system", [], "match", (text) => deltas.push(text), () => false
    )).rejects.toMatchObject({ statusCode: 499 });
    expect(stream).not.toHaveBeenCalled();
    expect(deltas).toEqual([]);
  });

  it("retries once when the stream dies before any text was emitted", async () => {
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(null, [], new Anthropic.APIConnectionError({ message: "boom" })))
      .mockReturnValueOnce(streamOf(message("Recovered.", "end_turn"), ["Recovered."]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysisStream(client, "system", [], "match", () => {}))
      .resolves.toBe("Recovered.");
    expect(stream).toHaveBeenCalledTimes(2);
  });

  // Even a one-line answer is delivered only after the guards run over the
  // complete response.
  it("holds a one-line answer until whole-answer guards have run", async () => {
    const unsafe = "Any scoreline not listed here falls below the 0.1% probability threshold.";
    const stream = vi.fn().mockReturnValue(streamOf(message(unsafe, "end_turn"), [unsafe]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    await expect(generateAnalysisStream(client, "system", [], "match", (text) => deltas.push(text)))
      .resolves.toContain("selected examples");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toContain("selected examples");
    expect(deltas[0]).not.toContain("not listed here falls below");
  });

  it("does not retry once text has reached the user", async () => {
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(null, ["partial "], new Anthropic.APIConnectionError({ message: "boom" })));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysisStream(client, "system", [], "match", () => {}))
      .rejects.toThrow();
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

describe("stripToolCallMarkup", () => {
  it("removes the doubled, unterminated tool call shipped to a user", () => {
    expect(stripToolCallMarkup(SCREENSHOT_LEAK)).toBe("");
  });

  it("removes a leading JSON tool payload and keeps the answer after it", () => {
    expect(stripToolCallMarkup(`${JSON_LEAK}\n\n**Verdict**\nArsenal are favoured at 78.4%.`))
      .toBe("**Verdict**\nArsenal are favoured at 78.4%.");
  });

  it("removes a closed name/arguments tool payload", () => {
    expect(stripToolCallMarkup(
      '{"name": "web_search", "arguments": {"query": "viking fk news"}}\nViking FK lead 1-0.'
    )).toBe("Viking FK lead 1-0.");
  });

  it("removes a well-formed tool call and a truncated one alike", () => {
    expect(stripToolCallMarkup(
      '<tool_call>\n<invoke name="web_search">\n<query>arsenal injuries</query>\n</invoke>\n</tool_call>'
    )).toBe("");
    expect(stripToolCallMarkup(
      '**Verdict**\nArsenal are favoured at 61.2%.\n<tool_call> <invoke name="web_search'
    )).toBe("**Verdict**\nArsenal are favoured at 61.2%.");
  });

  it("resumes a clean answer written underneath an unterminated leak", () => {
    expect(stripToolCallMarkup(
      `${SCREENSHOT_LEAK}\n\n**Verdict**\nDinamo Zagreb win **48.0%**.`
    )).toBe("**Verdict**\nDinamo Zagreb win **48.0%**.");
  });

  it("refuses to resume a tail that still carries tool markup", () => {
    // A bold label is not enough: the remainder must be free of tool syntax,
    // so a half-parsed payload underneath the leak still fails closed.
    expect(stripToolCallMarkup(
      `${SCREENSHOT_LEAK}\n\n**Verdict**\n<query>Dinamo Zagreb form</query>`
    )).toBe("");
    // Trailing prose with no section boundary is not an answer either.
    expect(stripToolCallMarkup(`${SCREENSHOT_LEAK}\nDinamo Zagreb form 2026`)).toBe("");
  });

  it("removes bare control-token fragments and stray closing tags", () => {
    expect(stripToolCallMarkup("]<]minimax[>[ <|tool_calls_begin|> <tool_call>")).toBe("");
    expect(stripToolCallMarkup("Arsenal are favoured.</tool_call> Coventry counter well."))
      .toBe("Arsenal are favoured. Coventry counter well.");
  });

  // The fourth production shape: a bracketed JSON invocation envelope, seen
  // live as the *entire* answer to "Arsenal vs Coventry". It is recognised as
  // JSON carrying tool keys, never as "something inside [[ ]]" -- the citation
  // sweep stays narrow precisely so bracketed prose survives.
  it("removes a bracketed JSON tool envelope that is the whole answer", () => {
    expect(stripToolCallMarkup(BRACKETED_JSON_LEAK)).toBe("");
  });

  it("removes a bracketed JSON tool envelope written mid-answer", () => {
    expect(stripToolCallMarkup(
      `**Verdict**\nArsenal are favoured at 78.4%.\n${BRACKETED_JSON_LEAK}\n**Goals**\nOver 2.5 at 55.0%.`
    )).toBe("**Verdict**\nArsenal are favoured at 78.4%.\n\n**Goals**\nOver 2.5 at 55.0%.");
  });

  it("leaves citation markers and bracketed prose alone", () => {
    for (const prose of [
      "Saka is out with a hamstring injury [[S1]].",
      "The unresolved marker [[1]] is the citation sweep's business, not this guard's.",
      "The shortlist [[a, b]] is bracketed prose and stays.",
      "Arsenal [[S1]] and Coventry [[S2]] both reported clean bills of health.",
    ]) {
      expect(stripToolCallMarkup(prose)).toBe(prose);
    }
  });

  it("leaves ordinary prose containing angle brackets or 'query' untouched", () => {
    for (const prose of [
      "In SQL a <query> is the statement you send to the database, nothing to do with football.",
      "Expected goals <1.5 here, and >2.5 only 31% of the time, so the under is favoured.",
      "Your query about Arsenal's away form: they win 54% of away fixtures this season.",
      "{Note} Arsenal are favoured at 61% and Coventry are the weaker side on the model.",
      "The token `tool_call` is model syntax, not a football term.",
    ]) {
      expect(stripToolCallMarkup(prose)).toBe(prose);
    }
  });
});

describe("extractLeakedSearchQueries", () => {
  it("recovers every query from the leaked parallel invoke block", () => {
    expect(extractLeakedSearchQueries(SCREENSHOT_LEAK)).toEqual([
      "Dinamo Zagreb vs Viking FK Champions League qualifier 2026 team news injuries lineup",
      "Dinamo Zagreb injury news Champions League playoff August 2026",
      "Viking FK Champions League playoff 2026 injury news squad",
    ]);
  });

  it("recovers queries from an unclosed JSON payload", () => {
    expect(extractLeakedSearchQueries(JSON_LEAK)).toEqual([
      "Arsenal team news injuries Premier League August 2026",
      "Coventry City injuries squad news August 2026",
    ]);
  });

  it("returns nothing for an answer that only mentions searching", () => {
    expect(extractLeakedSearchQueries("Arsenal are favoured at 61% on the model.")).toEqual([]);
  });

  it("recovers queries from the bracketed directive form", () => {
    expect(extractLeakedSearchQueries(BRACKETED_DIRECTIVE_LEAK)).toEqual([
      "Celtic LASK Champions League playoff 2026 team news injuries",
      "Celtic lineup news August 2026",
    ]);
  });
});

describe("the bracketed directive leak", () => {
  it("strips the production search_query spelling without leaving brackets", () => {
    expect(stripToolCallMarkup(PRODUCTION_SEARCH_QUERY_LEAK))
      .toBe("I can't answer that question.");
    expect(extractLeakedSearchQueries(PRODUCTION_SEARCH_QUERY_LEAK))
      .toEqual(["Premier League 2026-27 season start date fixtures"]);
  });

  it("is stripped out of an answer it rides along with", () => {
    expect(stripToolCallMarkup(
      `${BRACKETED_DIRECTIVE_LEAK}\n\n**Verdict**\nCeltic win **51.2%** on the model.`
    )).toBe("**Verdict**\nCeltic win **51.2%** on the model.");
  });

  /**
   * The tool name is what decides, not the brackets. Citation markers, bracket
   * arithmetic and markdown links all put a colon near a bracket, and none of
   * them may be touched -- the general bracket sweep this deliberately is not
   * is what once shipped an answer consisting of `[[1]]`.
   */
  it("leaves bracketed prose, citations and links alone", () => {
    for (const prose of [
      "The keeper is suspended [[S1]], so the back line changes.",
      "Celtic's route runs through [[1]] and the low-scoring draw.",
      "See the [match preview](https://example.com/preview) for the line-ups.",
      "Read the note [Celtic: a tactical history] before the second leg.",
      "The model's inputs [ratings: ClubElo] are pinned per release.",
    ]) {
      expect(stripToolCallMarkup(prose)).toBe(prose);
    }
  });
});

describe("text-form tool call recovery", () => {
  it("runs the leaked searches and answers from the retry turn", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(message(SCREENSHOT_LEAK, "end_turn"))
      .mockResolvedValueOnce(message(
        "**Verdict**\nDinamo Zagreb are favoured at 58.1% on the model.", "end_turn"
      ));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const bundle = { queries: [] as string[], results: [], providerCalls: 0 };
    const answer = await generateAnalysis(client, "system", [], "match", undefined, bundle);
    expect(answer).toContain("Dinamo Zagreb are favoured at 58.1%");
    expect(answer).not.toMatch(/tool_call|invoke|minimax/i);
    // One search: the provider budget must still fund the retry turn.
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(searchWeb.mock.calls[0][0]).toBe(
      "Dinamo Zagreb vs Viking FK Champions League qualifier 2026 team news injuries lineup"
    );
    expect(bundle.queries).toHaveLength(1);
    // The retry turn is asked for prose, not for another tool call.
    expect(create.mock.calls[1][0].tools).toBeUndefined();
  });

  it("runs the search a bracketed directive asked for instead of discarding it", async () => {
    // The structural shape gate in `deliverAnswer` already stops this reaching
    // the user. Recognising it at the boundary buys the better outcome: the
    // search the model wanted actually runs, so the user gets a researched
    // answer rather than the grounded fallback.
    const create = vi.fn()
      .mockResolvedValueOnce(message(BRACKETED_DIRECTIVE_LEAK, "end_turn"))
      .mockResolvedValueOnce(message(
        "**Verdict**\nCeltic are favoured at 51.2% on the model.", "end_turn"
      ));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const bundle = { queries: [] as string[], results: [], providerCalls: 0 };
    const answer = await generateAnalysis(client, "system", [], "match", undefined, bundle);
    expect(answer).toContain("Celtic are favoured at 51.2%");
    expect(answer).not.toContain("web_search");
    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(searchWeb.mock.calls[0][0])
      .toBe("Celtic LASK Champions League playoff 2026 team news injuries");
    expect(create.mock.calls[1][0].tools).toBeUndefined();
  });

  it("keeps an answer written underneath an unterminated leak without a retry", async () => {
    // The same predicate classifies the turn, so resuming the answer also
    // stops this being mis-read as leak-only and spending a continuation.
    const create = vi.fn().mockResolvedValue(message(
      `${SCREENSHOT_LEAK}\n\n**Verdict**\nDinamo Zagreb win **48.0%** on the model.`,
      "end_turn"
    ));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const answer = await generateAnalysis(client, "system", [], "match");
    expect(answer).toContain("Dinamo Zagreb win **48.0%**");
    expect(answer).not.toMatch(/tool_call|invoke|minimax/i);
    expect(create).toHaveBeenCalledTimes(1);
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("fails with a 502 rather than shipping an empty bubble when the retry leaks too", async () => {
    const create = vi.fn().mockResolvedValue(message(SCREENSHOT_LEAK, "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysis(client, "system", [], "general"))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it("strips a leak that rides along with a usable answer without a second turn", async () => {
    const create = vi.fn().mockResolvedValue(message(
      `${JSON_LEAK}\n\n**Verdict**\nArsenal are strong favourites at 78.4% on the model.`,
      "end_turn"
    ));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const answer = await generateAnalysis(client, "system", [], "match");
    expect(answer).toContain("Arsenal are strong favourites at 78.4%");
    expect(answer).not.toContain("search_queries");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never emits a leaked draft on the streaming path", async () => {
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(message(SCREENSHOT_LEAK, "end_turn"), [SCREENSHOT_LEAK]))
      .mockReturnValueOnce(streamOf(
        message("**Verdict**\nViking FK are 41.9% to advance on the model.", "end_turn"),
        ["**Verdict**\nViking FK are 41.9% to advance on the model."]
      ));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "match", (text) => deltas.push(text)
    );
    expect(answer).toContain("Viking FK are 41.9%");
    expect(deltas.join("")).not.toMatch(/tool_call|invoke|minimax/i);
  });
});

/**
 * The fifth production leak shape: a `<tool name="web_search">` element.
 *
 * Six empty pairs of it arrived on top of an otherwise perfect answer, so the
 * structural shape gate correctly did not fire -- the answer really was
 * answer-shaped -- and stripping was the only defence. It was also the only
 * defence that did nothing, because the tag vocabulary knew the name
 * `tool_call` and not the plain name `tool`.
 *
 * The fix is a class, not a sixth special case: a tag is markup when its
 * element name, normalised for case, namespace prefix and word separators, is
 * a tool-invocation name. These tests state that rule from both sides -- every
 * spelling of the name opens a strippable region, and the punctuation-heavy
 * prose the stripper has always had to survive still does.
 */
describe("the bare <tool> element leak", () => {
  const TOOL_ELEMENT_LEAK = [
    '<tool name="web_search"> </tool> <tool name="web_search"> </tool> <tool name="web_search"> </tool>',
    '<tool name="web_search"> </tool> <tool name="web_search"> </tool> <tool name="web_search"> </tool>',
  ].join("\n");

  it("is stripped off the top of the answer it rode along with", () => {
    expect(stripToolCallMarkup(
      `${TOOL_ELEMENT_LEAK}\n\n**Verdict**\nCeltic win **66.9%**, the draw **19.4%**.`
    )).toBe("**Verdict**\nCeltic win **66.9%**, the draw **19.4%**.");
  });

  it("is stripped whether the element is paired, self-closing, bare or attributed", () => {
    for (const leak of [
      "<tool>",
      "<tool></tool>",
      "<tool/>",
      '<tool name="web_search"/>',
      '<tool name="web_search" id="1">{"query": "celtic team news"}</tool>',
      '<TOOL NAME="web_search"> </TOOL>',
      '<tools><tool name="web_search"></tool></tools>',
      "<tool-call> </tool-call>",
      "<tool.call> </tool.call>",
      "<toolcall> </toolcall>",
      "<tool_invocation> </tool_invocation>",
      '<use_tool name="web_search"> </use_tool>',
      '<minimax:tool name="web_search"> </minimax:tool>',
    ]) {
      expect(stripToolCallMarkup(leak)).toBe("");
    }
  });

  it("carries the payload nested inside it out too", () => {
    expect(stripToolCallMarkup(
      '<tool name="web_search">\n<query>celtic lask team news</query>\n</tool>\n\n**Verdict**\nCeltic win **66.9%**.'
    )).toBe("**Verdict**\nCeltic win **66.9%**.");
  });

  it("does not damage the prose the stripper has always had to survive", () => {
    for (const prose of [
      "Saka is out with a hamstring injury [[S1]].",
      "The shortlist [[a, b]] is bracketed prose and stays.",
      "Rotation options are [2, 5] deep across the back line.",
      "Read more at [the preview](https://www.premierleague.com/news/12345) before kick-off.",
      "The model likes over >2.5 goals here, with under <2.5 the weaker side of the line.",
      "In SQL a `<query>` block is the statement you send to the database.",
      "Arsenal's toolkit of set-piece routines is the best in the league.",
      "The token `tool` is model syntax; the tools a coach has are not.",
    ]) {
      expect(stripToolCallMarkup(prose)).toBe(prose);
    }
  });
});
