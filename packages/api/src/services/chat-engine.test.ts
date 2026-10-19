import { describe, expect, it, vi } from "vitest";
import {
  chatEngineMode,
  configuredChatEngineMode,
  isChatAgentEngine,
  isChatEvalEngineOverrideGuardActive,
  logAskChatEngineTurn,
  parseChatEvalEngineOverrideHeader,
  parseChatEvalEngineOverrideValue,
  resolveChatEvalEngineOverride,
  resolveEffectiveChatEngine,
  withChatEngineRequestScope,
} from "./chat-engine";

describe("chat engine flag", () => {
  it("defaults to legacy", () => {
    const prior = process.env.CHAT_ENGINE;
    delete process.env.CHAT_ENGINE;
    expect(chatEngineMode()).toBe("legacy");
    expect(configuredChatEngineMode()).toBe("legacy");
    expect(isChatAgentEngine()).toBe(false);
    if (prior) process.env.CHAT_ENGINE = prior;
  });

  it("enables agent mode when CHAT_ENGINE=agent", () => {
    process.env.CHAT_ENGINE = "agent";
    expect(isChatAgentEngine()).toBe(true);
    expect(configuredChatEngineMode()).toBe("agent");
    delete process.env.CHAT_ENGINE;
  });

  it("keeps legacy when CHAT_ENGINE=legacy", () => {
    process.env.CHAT_ENGINE = "legacy";
    expect(configuredChatEngineMode()).toBe("legacy");
    expect(isChatAgentEngine()).toBe(false);
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

  it("honors eval header when CHAT_ENGINE is unset (production default)", () => {
    delete process.env.CHAT_ENGINE;
    expect(isChatEvalEngineOverrideGuardActive(false)).toBe(true);
    expect(resolveChatEvalEngineOverride("agent", isChatEvalEngineOverrideGuardActive(false))).toBe(
      "agent",
    );
    expect(resolveEffectiveChatEngine("agent")).toBe("agent");
    expect(resolveEffectiveChatEngine(null)).toBe("legacy");
    withChatEngineRequestScope(
      resolveChatEvalEngineOverride("agent", isChatEvalEngineOverrideGuardActive(false)),
      () => {
        expect(chatEngineMode()).toBe("agent");
      },
    );
  });

  it("allows engine header without replay when CHAT_ENGINE is explicitly legacy", () => {
    process.env.CHAT_ENGINE = "legacy";
    expect(isChatEvalEngineOverrideGuardActive(false)).toBe(true);
    expect(resolveChatEvalEngineOverride("agent", isChatEvalEngineOverrideGuardActive(false))).toBe(
      "agent",
    );
    delete process.env.CHAT_ENGINE;
  });

  it("logs effective engine and header override flag", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logAskChatEngineTurn({ effectiveEngine: "agent", engineFromHeaderOverride: true });
    expect(spy).toHaveBeenCalledWith(JSON.stringify({
      event: "ask_chat_engine",
      effectiveEngine: "agent",
      engineFromHeaderOverride: true,
    }));
    spy.mockRestore();
  });
});
