import { describe, expect, it, vi } from "vitest";
import { generateAnalysis, sanitizeAnswerForTier } from "./ask";
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
