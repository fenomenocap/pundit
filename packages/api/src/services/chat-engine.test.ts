import { describe, expect, it } from "vitest";
import { chatEngineMode, isChatAgentEngine } from "./chat-engine";

describe("chat engine flag", () => {
  it("defaults to legacy", () => {
    const prior = process.env.CHAT_ENGINE;
    delete process.env.CHAT_ENGINE;
    expect(chatEngineMode()).toBe("legacy");
    expect(isChatAgentEngine()).toBe(false);
    if (prior) process.env.CHAT_ENGINE = prior;
  });

  it("enables agent mode when CHAT_ENGINE=agent", () => {
    process.env.CHAT_ENGINE = "agent";
    expect(isChatAgentEngine()).toBe(true);
    delete process.env.CHAT_ENGINE;
  });
});
