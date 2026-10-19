import { describe, expect, it } from "vitest";
import { getChatEvalJudgeCore } from "./chat-eval-judge-bridge";

describe("chat-eval-judge-bridge", () => {
  it("loads the shared judge core module from repo scripts", () => {
    const core = getChatEvalJudgeCore();
    expect(typeof core.judgeEvalTurnPayloads).toBe("function");
  });
});
