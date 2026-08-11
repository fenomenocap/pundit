import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../middleware";
import {
  generateAnalysis,
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
} from "./ask";

// The tool loop executes searches for real; stub the backend so these tests
// stay offline and deterministic.
const searchWeb = vi.hoisted(() => vi.fn());
vi.mock("./web-search", () => ({ searchWeb }));

beforeEach(() => {
  searchWeb.mockReset();
  searchWeb.mockResolvedValue([
    { title: "Arsenal team news", link: "https://example.com/a", snippet: "s", date: "2026-08-10" },
  ]);
});

// A response asking for one web search, as MiniMax returns it.
function toolUseMessage(text: string, id = "tool-1") {
  return {
    content: [
      { type: "text", text, citations: [] },
      { type: "tool_use", id, name: "web_search", input: { query: "arsenal team news" } },
    ],
    stop_reason: "tool_use",
  };
}

function clientWith(response: unknown): Pick<Anthropic, "messages"> {
  return {
    messages: { create: vi.fn().mockResolvedValue(response) },
  } as unknown as Pick<Anthropic, "messages">;
}

function message(text: string, stopReason: string) {
  return { content: [{ type: "text", text, citations: [] }], stop_reason: stopReason };
}

// Stub of the SDK's MessageStream: emits deltas on subscribe, then resolves
// (or rejects) finalMessage.
function streamOf(final: unknown, deltas: string[] = [], error?: unknown) {
  return {
    on(event: string, handler: (text: string) => void) {
      if (event === "text") deltas.forEach(handler);
      return this;
    },
    finalMessage: () => (error ? Promise.reject(error) : Promise.resolve(final)),
  };
}

describe("generateAnalysis", () => {
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

  it("rejects empty and token-exhausted responses", async () => {
    await expect(generateAnalysis(clientWith({ content: [], stop_reason: "end_turn" }),
      "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
    await expect(generateAnalysis(clientWith({
      content: [{ type: "text", text: "truncated", citations: [] }],
      stop_reason: "max_tokens",
    }), "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
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
    expect(searchWeb).toHaveBeenCalledWith("arsenal team news");

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
    expect(create).toHaveBeenCalledTimes(6); // initial call + MAX_CONTINUATIONS
  });
});

describe("stripProcessNarration", () => {
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
  it("streams the post-search turn progressively when nothing was drafted", async () => {
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
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas[0]).toBe("**Verdict**");
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

  it("releases settled lines progressively and the deltas rebuild the answer", async () => {
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
    // More than one delta means the client renders text while generation is
    // still running, which is the whole point of the change.
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas[0]).toBe("**Verdict**");
    expect(deltas.join("")).toBe(answer);
    // The general tier appends its disclaimer to the whole answer only, so the
    // streamed text is the body and the final event carries the rest.
    expect(answer.startsWith(chunks.join("").trim())).toBe(true);
    expect(answer).toContain("not based on Pundit's model data");
  });

  it("does not repeat the general disclaimer into each streamed prefix", async () => {
    const chunks = ["First line.\n", "Second line.\n", "Third line."];
    const stream = vi.fn().mockReturnValue(
      streamOf(message(chunks.join(""), "end_turn"), chunks)
    );
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    const answer = await generateAnalysisStream(
      client, "system", [], "general", (text) => deltas.push(text)
    );
    // Appending it per prefix broke prefix-stability, so the flusher diverged
    // and the client fell back to a single delta at the end.
    expect(deltas.length).toBeGreaterThan(1);
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
    expect(deltas.length).toBeGreaterThan(1);
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

  // Progressive release settles at line boundaries, so an answer that never
  // completes a line has nothing to release early and is still delivered in one
  // piece once the guards have run over the whole thing.
  it("holds back an answer with no settled line until the guards have run", async () => {
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
