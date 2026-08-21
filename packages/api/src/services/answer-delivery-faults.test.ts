import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { extractLeakedSearchQueries, generateAnalysis, sanitizeAnswerForTier } from "./ask";
import { clientWith, message } from "./__fixtures__/anthropic-stubs";

vi.mock("./web-search", () => ({ searchWeb: vi.fn().mockResolvedValue([]) }));

/**
 * Two faults the 2026-08-20 production battle test surfaced, both fixed at the
 * cause rather than by pattern-matching the symptom.
 */
describe("the output budget leaves room for MiniMax's reasoning", () => {
  // MiniMax counts internal reasoning against max_tokens and shares that budget
  // with the visible answer, so a ~100-token competition answer could still
  // stop on `max_tokens`, or return no text at all after an 8-12s generation.
  // Truncation and an empty completion are the two faces of one budget fault.
  it("still reports a truncated turn rather than shipping half an answer", async () => {
    await expect(generateAnalysis(clientWith(message("cut off", "max_tokens")),
      "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("still reports an empty completion", async () => {
    await expect(generateAnalysis(clientWith({ content: [], stop_reason: "end_turn" }),
      "system", [], "general")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("spends exactly one provider call on an answer that finished normally", async () => {
    const client = clientWith(message("**Verdict**\nFine.", "end_turn"));
    await generateAnalysis(client, "system", [], "general");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });
});

describe("the general disclaimer never lands under a stranded label", () => {
  // Production shipped "**What would change this**" followed by the general
  // disclaimer. `dropOrphanedSectionLabels` removes that label correctly on its
  // own; the bug was ordering -- the disclaimer was appended first, which gave
  // the orphan a body and hid it from the sweep.
  const ORPHANED = "I can't answer that.\n\n**Why**\n\nThey do not meet in any"
    + " current fixture.\n\n**What would change this**";
  const DISCLAIMER = "This is general football analysis, not based on Pundit's model data.";

  it("drops a label whose only body would have been the disclaimer", () => {
    const delivered = sanitizeAnswerForTier(ORPHANED, "general", undefined, true);
    expect(delivered).toContain(DISCLAIMER);
    expect(delivered).not.toMatch(
      /\*\*What would change this\*\*\s*\n\s*\nThis is general football analysis/
    );
  });

  it("keeps a label that has a body of its own", () => {
    const withBody = "**Why**\n\nThey do not meet.\n\n**What would change this**"
      + "\n\nA confirmed friendly announcement would change it.";
    const delivered = sanitizeAnswerForTier(withBody, "general", undefined, true);
    expect(delivered).toContain("A confirmed friendly announcement would change it.");
    expect(delivered).toContain("**What would change this**");
    expect(delivered).toContain(DISCLAIMER);
  });

  it("still appends the disclaimer to an answer with no labels at all", () => {
    const plain = "They do not meet in any current fixture.";
    expect(sanitizeAnswerForTier(plain, "general", undefined, true)).toContain(DISCLAIMER);
  });
});

/**
 * The 2026-08-21 fault: a match turn came back as one narrated sentence plus a
 * leaked tool call, and the user got the grounded fallback instead of an
 * answer. Two causes, both here -- the leak went unrecovered because the
 * narration counted as prose, and the dialect it leaked in carried its queries
 * where the extractor did not look.
 */
describe("a turn that is only narration plus a leaked tool call", () => {
  const NARRATED_LEAK = "I'll check for current team news and player availability"
    + ' before answering.\n\n]<]minimax[>[<tool_call> <invoke name="web_search">'
    + ' <parameter name="search_queries">["Hull City vs Manchester United August 2026'
    + ' team news", "Manchester United injury news"]</parameter> </invoke> </tool_call>';

  it("extracts the searches from the parameter dialect", () => {
    expect(extractLeakedSearchQueries(NARRATED_LEAK)).toEqual([
      "Hull City vs Manchester United August 2026 team news",
      "Manchester United injury news",
    ]);
  });

  it("recovers the turn instead of delivering an empty answer", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(message(NARRATED_LEAK, "end_turn"))
      .mockResolvedValueOnce(message("**Verdict**\nMan United are heavy favourites.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const answer = await generateAnalysis(client, "system", [], "match");
    expect(create).toHaveBeenCalledTimes(2);
    expect(answer).toContain("Man United are heavy favourites");
  });
});
