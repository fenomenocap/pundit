import { describe, expect, it } from "vitest";
import { envelopChatAgentAnswer, finalizeChatAgentAnswer } from "./chat-agent-guard";
import type { AskGrounding } from "./ask";

const matchGrounding = {
  kind: "match",
  fixtureId: "espn:eng.1:401878771",
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
} as AskGrounding;

describe("finalizeChatAgentAnswer", () => {
  it("keeps grounded match percentages", () => {
    const answer = "Lean Chelsea. I have them at 54.0% with over 2.5 at 52.0%.";
    expect(finalizeChatAgentAnswer(answer, matchGrounding)).toContain("54.0%");
  });

  it("strips invented match percentages", () => {
    const answer = "Back Chelsea at 91.0% — lock it in.";
    const out = finalizeChatAgentAnswer(answer, matchGrounding);
    expect(out).not.toContain("91.0%");
    expect(out.toLowerCase()).toMatch(/no bet|couldn't tie/);
  });

  it("prepends a headline 1X2 when the agent prose omitted it", () => {
    const wrapped = envelopChatAgentAnswer(
      "Lean Chelsea. They carry the stronger rating band here.",
      "What does the model say?",
      matchGrounding,
    );
    expect(wrapped).toMatch(/Everton.*draw.*Chelsea/i);
    expect((wrapped.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("does not prepend or keep a headline win/draw/win line on follow-up turns", () => {
    const agentDraft = "My 1X2 is Everton 22.0%, draw 24.0% and Chelsea 54.0%. Lean Chelsea for the totals angle.";
    const wrapped = envelopChatAgentAnswer(
      agentDraft,
      "What about over and under 2.5?",
      matchGrounding,
      { hasHistory: true },
    );
    expect(wrapped).not.toMatch(/^My 1X2 is/i);
    expect((wrapped.match(/\bdraw\b/gi) ?? []).length).toBeLessThan(2);
  });
});
