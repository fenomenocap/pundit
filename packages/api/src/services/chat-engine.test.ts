import { describe, expect, it } from "vitest";
import {
  chatEngineMode,
  isChatAgentEngine,
  isChatEvalEngineOverrideGuardActive,
  parseChatEvalEngineOverrideHeader,
  parseChatEvalEngineOverrideValue,
  resolveChatEvalEngineOverride,
  withChatEngineRequestScope,
} from "./chat-engine";

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

  it("ignores eval engine header without eval guard", () => {
    expect(parseChatEvalEngineOverrideHeader("agent", false)).toBeNull();
  });

  it("honors eval engine header when eval guard is active", () => {
    delete process.env.CHAT_ENGINE;
    expect(parseChatEvalEngineOverrideHeader("agent", true)).toBe("agent");
    withChatEngineRequestScope("agent", () => {
      expect(chatEngineMode()).toBe("agent");
    });
    expect(chatEngineMode()).toBe("legacy");
  });

  it("parses eval engine header values when eval guard is active", () => {
    expect(parseChatEvalEngineOverrideValue("agent")).toBe("agent");
    expect(resolveChatEvalEngineOverride("agent", false)).toBeNull();
    expect(resolveChatEvalEngineOverride("legacy", false)).toBeNull();
    expect(resolveChatEvalEngineOverride("agent", true)).toBe("agent");
    expect(resolveChatEvalEngineOverride(undefined, false)).toBeNull();
  });

  it("allows engine header without replay when CHAT_ENGINE is explicitly legacy", () => {
    process.env.CHAT_ENGINE = "legacy";
    expect(isChatEvalEngineOverrideGuardActive(false)).toBe(true);
    expect(resolveChatEvalEngineOverride("agent", isChatEvalEngineOverrideGuardActive(false))).toBe(
      "agent",
    );
    delete process.env.CHAT_ENGINE;
  });
});
