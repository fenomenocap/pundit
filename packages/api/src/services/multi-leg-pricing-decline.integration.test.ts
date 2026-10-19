import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { answerQuestion, answerQuestionStream } from "./ask";
import * as chatEngine from "./chat-engine";

describe("multi-leg pricing decline (integration)", () => {
  it("returns a short decline for cross-game parlay on legacy and stream paths", async () => {
    const create = vi.spyOn(Anthropic.Messages.prototype, "create");
    const question = "Spurs to beat Coventry and Arsenal to beat Everton — combined fair price?";
    const json = await answerQuestion(question, [], undefined, undefined, undefined, undefined, "desk");
    expect(json.answer).toMatch(/I price single matches for now/);
    expect(json.answer).toMatch(/multi-leg pricing is coming soon/);
    expect(json.grounding).toBeNull();
    expect(create).not.toHaveBeenCalled();

    const deltas: string[] = [];
    const stream = await answerQuestionStream(question, [], undefined, {
      onGrounding: (grounding) => expect(grounding).toBeNull(),
      onDelta: (text) => deltas.push(text),
    });
    expect(stream.answer).toBe(json.answer);
    expect(deltas).toEqual([json.answer]);
    create.mockRestore();
  });

  it("returns the same decline on the agent engine without calling inference", async () => {
    const saved = process.env.CHAT_ENGINE;
    process.env.CHAT_ENGINE = "agent";
    const create = vi.spyOn(Anthropic.Messages.prototype, "create");
    try {
      expect(chatEngine.isChatAgentEngine()).toBe(true);
      const result = await answerQuestion("Build me a 2-leg parlay from today's matches");
      expect(result.answer).toMatch(/multi-leg pricing is coming soon/);
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      if (saved === undefined) delete process.env.CHAT_ENGINE;
      else process.env.CHAT_ENGINE = saved;
    }
  });
});
