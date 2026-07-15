import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../middleware";
import { generateAnalysis } from "./ask";

function clientWith(response: unknown): Pick<Anthropic, "messages"> {
  return {
    messages: { create: vi.fn().mockResolvedValue(response) },
  } as unknown as Pick<Anthropic, "messages">;
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
});
