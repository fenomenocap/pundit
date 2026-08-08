import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../middleware";
import {
  generateAnalysis,
  generateAnalysisStream,
  Grounding,
  sanitizeCompetitionAnswer,
  sanitizeMatchAnswer,
  sanitizeSeasonAnswer,
  sanitizeUnsupportedTeamNews,
} from "./ask";

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
        { type: "server_tool_use", id: "tool", name: "web_search", input: {} },
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

  it("continues a paused web-search turn, replaying its content as an assistant turn", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(message("First half. ", "pause_turn"))
      .mockResolvedValueOnce(message("Second half.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysis(client, "system", [
      { role: "user", content: "q" },
    ], "match")).resolves.toBe("First half. Second half.");
    expect(create).toHaveBeenCalledTimes(2);
    const continuationMessages = create.mock.calls[1][0].messages;
    expect(continuationMessages.at(-1)).toMatchObject({ role: "assistant" });
  });

  it("gives up with a 504 when the turn never resumes", async () => {
    const create = vi.fn().mockResolvedValue(message("still searching", "pause_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    await expect(generateAnalysis(client, "system", [], "match"))
      .rejects.toMatchObject({ statusCode: 504 });
    expect(create).toHaveBeenCalledTimes(6); // initial call + MAX_CONTINUATIONS
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
  it("emits deltas across continuations and joins the final text", async () => {
    const stream = vi.fn()
      .mockReturnValueOnce(streamOf(message("First half. ", "pause_turn"), ["First half. "]))
      .mockReturnValueOnce(streamOf(message("Second half.", "end_turn"), ["Second half."]));
    const client = { messages: { stream } } as unknown as Pick<Anthropic, "messages">;
    const deltas: string[] = [];
    await expect(generateAnalysisStream(client, "system", [
      { role: "user", content: "q" },
    ], "match", (text) => deltas.push(text))).resolves.toBe("First half. Second half.");
    expect(deltas).toEqual(["First half. Second half."]);
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
    expect(answer).toBe(chunks.join("").trim());
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
