import { describe, expect, it } from "vitest";
import type { AskGrounding } from "./ask";
import { singleClubCurrentFactScope } from "./federated-evidence";
import {
  AGENT_HISTORY_CONTENT_MAX,
  capAgentAnswerForHistory,
  completeAgentAnswerEnding,
  enrichAgentTeamNewsAttribution,
  finalizeAgentPackagedAnswer,
  normalizeAgentManagerAnswer,
} from "./chat-agent-package";
import { parseHistory } from "../routes/ask";

const matchGrounding = {
  kind: "match",
  fixtureId: "espn:eng.1:401879263",
  competitionId: "eng.1",
  competition: "Premier League",
  homeFieldAdvantage: true,
  date: "2026-10-18",
  stage: "Regular Season",
  home: "Bournemouth",
  away: "Sunderland",
  pHome: 0.64,
  pDraw: 0.23,
  pAway: 0.13,
  pOver2_5: 0.53,
  pUnder2_5: 0.47,
  pBttsYes: 0.51,
  pBttsNo: 0.49,
  topScores: [],
} as unknown as AskGrounding;

describe("capAgentAnswerForHistory", () => {
  it("keeps answers within the desk history limit", () => {
    const long = `${"Word ".repeat(900)}Done.`;
    const capped = capAgentAnswerForHistory(long);
    expect(capped.length).toBeLessThanOrEqual(AGENT_HISTORY_CONTENT_MAX);
    expect(() => parseHistory([
      { role: "user", content: "Brief me on the match." },
      { role: "assistant", content: capped },
    ])).not.toThrow();
  });
});

describe("completeAgentAnswerEnding", () => {
  it("drops a dangling probability tail", () => {
    const broken = "Over 2.5 is 53.1% and under is 46.9%. Bournemouth at 63.";
    expect(completeAgentAnswerEnding(broken)).toBe("Over 2.5 is 53.1% and under is 46.9%.");
  });

  it("closes an truncated sentence at the token cap", () => {
    const tail = "Alex Scott remains sidelined with a thigh issue and the squad";
    expect(completeAgentAnswerEnding(tail)).toMatch(/\.$/);
  });
});

describe("enrichAgentTeamNewsAttribution", () => {
  it("adds publisher and date to an unsupported injury sentence", () => {
    const bundle = {
      queries: ["injuries"],
      results: [{
        id: "S1",
        title: "BBC Sport",
        url: "https://www.bbc.co.uk/sport/football/article",
        date: "2026-10-17T10:00:00Z",
        snippet: "Alex Scott is sidelined with a thigh injury.",
        tier: "news" as const,
      }],
      providerCalls: 1,
    };
    const out = enrichAgentTeamNewsAttribution("Alex Scott is sidelined with a thigh injury.", bundle as import("./ask").EvidenceBundle);
    expect(out).toMatch(/bbc\.co\.uk|BBC Sport/i);
    expect(out).toMatch(/17 Oct|2026-10-17/i);
  });
});

describe("normalizeAgentManagerAnswer", () => {
  it("rewrites manager delivery with verified status", () => {
    expect(singleClubCurrentFactScope("What's Bournemouth's manager today?", matchGrounding)).toEqual({
      kind: "manager",
      club: "Bournemouth",
    });
    const citations = [{
      id: "S1",
      title: "AFC Bournemouth",
      url: "https://www.afcb.co.uk/news/manager",
      date: "2026-10-01T12:00:00Z",
    }];
    const { prose, verification } = normalizeAgentManagerAnswer(
      "What's Bournemouth's manager today?",
      matchGrounding,
      "**Bournemouth's manager is Marco Rose.** He took over in 2026.",
      citations,
      { queries: [], results: [], providerCalls: 0 },
      Date.parse("2026-10-17T12:00:00Z"),
    );
    expect(prose).toMatch(/Bournemouth's manager is Marco Rose/i);
    expect(prose).toMatch(/1 Oct/);
    expect(verification).toEqual({ status: "verified", supportedClaimCount: 1, removedClaimCount: 0 });
  });
});

describe("finalizeAgentPackagedAnswer", () => {
  it("caps homepage-scale briefings for the next turn", () => {
    const prose = "x".repeat(5000);
    const { prose: out } = finalizeAgentPackagedAnswer(
      "Give me the match briefing.",
      matchGrounding,
      { queries: [], results: [], providerCalls: 0 },
      prose,
      [],
      { voice: "desk" },
    );
    expect(out.length).toBeLessThanOrEqual(AGENT_HISTORY_CONTENT_MAX);
  });
});
