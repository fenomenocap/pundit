import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AGENT_MAX_CUMULATIVE_LLM_TOKENS } from "./chat-agent-limits";
import { runChatAgent } from "./chat-agent";
import type { AskGrounding } from "./ask";
import * as tokenEstimate from "./chat-agent-token-estimate";

const matchGrounding = {
  kind: "match",
  fixtureId: "401",
  competitionId: "eng.1",
  competition: "Premier League",
  homeFieldAdvantage: true,
  date: "2026-10-18",
  stage: "Regular Season",
  home: "Everton",
  away: "Chelsea",
  pHome: 0.22,
  pDraw: 0.24,
  pAway: 0.54,
  pOver2_5: 0.52,
  pUnder2_5: 0.48,
  pBttsYes: 0.55,
  pBttsNo: 0.45,
  topScores: [{ score: "1-1", probability: 0.11 }],
  scorelines: [],
} as unknown as AskGrounding;

describe("runChatAgent token cap", () => {
  it("does not invoke the LLM when the projected step exceeds the remaining budget", async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Pick<Anthropic, "messages">;
    vi.spyOn(tokenEstimate, "stepFitsTokenBudget").mockReturnValue(false);
    const result = await runChatAgent("Who wins?", matchGrounding, client);
    expect(create).not.toHaveBeenCalled();
    expect(result.text).toBe("");
    expect(result.metrics.capHit).toBe("tokens");
    vi.restoreAllMocks();
  });
});

describe("stepFitsTokenBudget", () => {
  it("rejects a step when cumulative usage leaves no room for projected input + output", () => {
    const messages = [{ role: "user" as const, content: "x".repeat(120_000) }];
    const fits = tokenEstimate.stepFitsTokenBudget(
      AGENT_MAX_CUMULATIVE_LLM_TOKENS - 500,
      AGENT_MAX_CUMULATIVE_LLM_TOKENS,
      { system: "sys", messages, tools: [] },
    );
    expect(fits).toBe(false);
  });
});
