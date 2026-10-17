import { describe, expect, it } from "vitest";
import { finalizeChatAgentAnswer } from "./chat-agent-guard";
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
});
