import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  extractLeakedSearchQueries,
  generateAnalysis,
  PROVIDER_CALL_BUDGET,
  sanitizeAnswerForTier,
} from "./ask";
import { clientWith, message } from "./__fixtures__/anthropic-stubs";

const searchWeb = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("./web-search", () => ({
  searchWeb,
  searchWebBatch: (queries: string[]) => Promise.all(queries.map((q) => searchWeb(q))),
}));

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

/**
 * Production kept degrading on turns where MiniMax reached for a search and
 * the tool channel misbehaved. The shapes differed every time -- narration
 * with no markup at all, a `<tool ... />` element, a bare JSON payload -- so
 * recovery keys off whether the turn is deliverable, not off the dialect.
 */
describe("a match turn that reached for a tool and produced nothing shippable", () => {
  const recovered = "**Model vs market**\nThe model is 20.6 points above the market.";

  async function turnsFor(first: string) {
    const create = vi.fn()
      .mockResolvedValueOnce(message(first, "end_turn"))
      .mockResolvedValueOnce(message(recovered, "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const answer = await generateAnalysis(client, "system", [], "match");
    return { calls: create.mock.calls.length, answer };
  }

  it("recovers a turn that is only narration, with no markup to detect", async () => {
    const { calls, answer } = await turnsFor(
      "I'll search for current team news on both sides before answering."
    );
    expect(calls).toBe(2);
    expect(answer).toContain("20.6 points above the market");
  });

  it("recovers the self-closing <tool /> dialect", async () => {
    const { calls, answer } = await turnsFor(
      'I\'ll check the team news first.\n\n]<]minimax[>[<tool_call>'
      + ' <tool name="web_search" query="Hull City team news August 2026" /> </tool_call>'
    );
    expect(calls).toBe(2);
    expect(answer).toContain("20.6 points above the market");
  });

  it("recovers a fragment that survives stripping but carries no answer shape", async () => {
    const { calls } = await turnsFor(
      'Let me search for that.\n\n{ "search_queries": ["Hull defence injuries"] }\n\nChecking now.'
    );
    expect(calls).toBe(2);
  });

  it("leaves a clean short answer alone", async () => {
    const create = vi.fn().mockResolvedValue(message("**Verdict**\nMan United by 20.6 points.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    await generateAnalysis(client, "system", [], "match");
    expect(create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Recovery costs provider calls, and the budget is shared with the mandatory
 * search. Production returned a 504 with an empty bubble on a market question
 * once recovery started competing for the last call -- a degraded answer the
 * grounding can still carry is strictly better than no answer at all.
 */
describe("recovery never spends a budget it cannot finish on", () => {
  const narrated = "I'll search for the current market before answering.";

  it("declines to recover when the retry turn could not be funded", async () => {
    const create = vi.fn().mockResolvedValue(message(narrated, "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    // One call left: it funds the turn itself, leaving nothing for a retry.
    const bundle = { queries: [] as string[], results: [], providerCalls: PROVIDER_CALL_BUDGET - 1 };
    await generateAnalysis(client, "system", [], "match", undefined, bundle);
    expect(create).toHaveBeenCalledTimes(1);
    expect(bundle.providerCalls).toBe(PROVIDER_CALL_BUDGET);
  });

  it("recovers without a search when only the retry turn can be funded", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(message(narrated, "end_turn"))
      .mockResolvedValueOnce(message("**Model vs market**\nThe gap is 20.4 points.", "end_turn"));
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    const bundle = { queries: [] as string[], results: [], providerCalls: PROVIDER_CALL_BUDGET - 2 };
    const answer = await generateAnalysis(client, "system", [], "match", undefined, bundle);
    expect(answer).toContain("20.4 points");
    expect(create).toHaveBeenCalledTimes(2);
    expect(bundle.providerCalls).toBe(PROVIDER_CALL_BUDGET);
  });
});
