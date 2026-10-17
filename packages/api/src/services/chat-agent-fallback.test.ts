import { describe, expect, it, vi } from "vitest";
import type { AskGrounding, EvidenceBundle } from "./ask";
import {
  AGENT_USER_BANNED_PHRASES,
  composeAgentEvidenceFallback,
  containsAgentInternalWording,
  sanitizeAgentUserText,
} from "./chat-agent-fallback";
import { agentNonEmptyGroundedFallback } from "./ask";
import { logChatAgentTurn, emptyChatAgentTurnMetrics } from "./chat-agent-limits";

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

const bundle: EvidenceBundle = {
  queries: ["injuries"],
  providerCalls: 1,
  results: [{
    id: "S1",
    title: "Injury update",
    url: "https://www.bbc.co.uk/sport/football/injury",
    date: "2026-10-10",
    snippet: "Everton list two doubts ahead of the weekend.",
    tier: "official",
  }],
};

describe("agent user-facing fallbacks", () => {
  it("never surfaces internal runtime wording", () => {
    const samples = [
      composeAgentEvidenceFallback("Team news?", matchGrounding, bundle, false),
      agentNonEmptyGroundedFallback("Lean Chelsea?", matchGrounding, false),
      sanitizeAgentUserText("No bet — the agent loop exhausted its tool budget before finishing.") || composeAgentEvidenceFallback("", matchGrounding, bundle, false),
    ];
    for (const text of samples) {
      expect(text.trim().length).toBeGreaterThan(10);
      for (const pattern of AGENT_USER_BANNED_PHRASES) {
        expect(text).not.toMatch(pattern);
      }
    }
    expect(containsAgentInternalWording("No bet — the agent loop exhausted its tool budget")).toBe(true);
  });

  it("includes fetched source citations in the evidence fallback", () => {
    const text = composeAgentEvidenceFallback("Any injuries?", matchGrounding, bundle, false);
    expect(text).toContain("[[S1]]");
    expect(text).toMatch(/Everton|22\.0%/);
  });

  it("emits chat_agent_turn on fallback-oriented metrics", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logChatAgentTurn({
      ...emptyChatAgentTurnMetrics(),
      latencyMs: 12,
      outcome: "fallback",
      capHit: "tokens",
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"event":"chat_agent_turn"'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"capHit":"tokens"'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"outcome":"fallback"'));
    spy.mockRestore();
  });
});
