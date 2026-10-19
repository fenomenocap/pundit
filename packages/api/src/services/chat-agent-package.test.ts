import { describe, expect, it } from "vitest";
import type { AskGrounding, EvidenceBundle } from "./ask";
import { normalizeAgentManagerAnswer } from "./ask";
import type { RetrievedEvidencePage } from "./evidence-page-retrieval";
import {
  AGENT_HISTORY_CONTENT_MAX,
  capAgentAnswerForHistory,
  completeAgentAnswerEnding,
  enrichAgentTeamNewsAttribution,
  finalizeAgentPackagedAnswer,
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

const managerBundle: EvidenceBundle = {
  queries: ["manager"],
  providerCalls: 1,
  results: [{
    id: "S1",
    title: "AFC Bournemouth",
    url: "https://www.afcb.co.uk/news/manager",
    date: "2026-10-01T12:00:00Z",
    snippet: "Club site reporting.",
    tier: "official",
  }],
};

const managerPages: RetrievedEvidencePage[] = [{
  id: "S1",
  url: "https://www.afcb.co.uk/news/manager",
  title: "AFC Bournemouth",
  date: "2026-10-01T12:00:00Z",
  authority: "official",
  finalUrl: "https://www.afcb.co.uk/news/manager",
  text: "Bournemouth's manager is Marco Rose.",
  retrievedAt: "2026-10-17T12:00:00Z",
}];

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
});

describe("enrichAgentTeamNewsAttribution", () => {
  const bundle: EvidenceBundle = {
    queries: ["injuries"],
    results: [{
      id: "S1",
      title: "BBC Sport",
      url: "https://www.bbc.co.uk/sport/football/article",
      date: "2026-10-17T10:00:00Z",
      snippet: "Alex Scott is sidelined with a thigh injury.",
      tier: "news",
    }],
    providerCalls: 1,
  };

  it("adds publisher and date when [[S#]] maps to a source that names the player", () => {
    const out = enrichAgentTeamNewsAttribution(
      "Alex Scott is sidelined with a thigh injury [[S1]].",
      bundle,
      matchGrounding,
    );
    expect(out).toMatch(/bbc\.co\.uk|BBC Sport/i);
    expect(out).toMatch(/17 Oct|2026-10-17/i);
  });

  it("leaves the sentence unchanged without an explicit [[S#]] marker", () => {
    const raw = "Alex Scott is sidelined with a thigh injury.";
    expect(enrichAgentTeamNewsAttribution(raw, bundle, matchGrounding)).toBe(raw);
  });

  it("does not attach a source when the player is absent from that source text", () => {
    const raw = "Marco Rose is sidelined with a thigh injury [[S1]].";
    expect(enrichAgentTeamNewsAttribution(raw, bundle, matchGrounding)).toBe(raw);
  });
});

describe("normalizeAgentManagerAnswer", () => {
  const question = "What's Bournemouth's manager today?";
  const agentProse = "**Bournemouth's manager is Marco Rose.** He took over in 2026.";
  const citations = [{
    id: "S1",
    title: "AFC Bournemouth",
    url: "https://www.afcb.co.uk/news/manager",
    date: "2026-10-01T12:00:00Z",
  }];
  const nowMs = Date.parse("2026-10-17T12:00:00Z");

  it("stays not-required when no publisher page was fetched this turn", () => {
    const result = normalizeAgentManagerAnswer(
      question, matchGrounding, agentProse, citations, managerBundle, undefined, nowMs,
    );
    expect(result.verification.status).toBe("not-required");
    expect(result.prose).toBe(agentProse);
  });

  it("stays not-required when the fetched body does not establish the role", () => {
    const pages = [{ ...managerPages[0], text: "Premier League fixtures and tables for the weekend." }];
    const result = normalizeAgentManagerAnswer(
      question, matchGrounding, agentProse, citations, managerBundle, pages, nowMs,
    );
    expect(result.verification.status).toBe("not-required");
    expect(result.prose).toBe(agentProse);
  });

  it("rewrites and verifies only when publisher-owned extraction succeeds", () => {
    const result = normalizeAgentManagerAnswer(
      question, matchGrounding, agentProse, citations, managerBundle, managerPages, nowMs,
    );
    expect(result.prose).toMatch(/Bournemouth's manager is Marco Rose/i);
    expect(result.prose).toMatch(/1 Oct/);
    expect(result.verification).toEqual({
      status: "verified",
      supportedClaimCount: 1,
      removedClaimCount: 0,
    });
  });
});

describe("finalizeAgentPackagedAnswer", () => {
  it("does not inject composed dated-club-news template prose", () => {
    const agentDraft = "Both clubs have a few injury doubts going into Sunday.";
    const out = finalizeAgentPackagedAnswer(agentDraft, { voice: "desk" });
    expect(out).toBe(agentDraft);
    expect(out).not.toMatch(/In an update published on/i);
  });

  it("caps homepage-scale briefings for the next turn", () => {
    const prose = "x".repeat(5000);
    const out = finalizeAgentPackagedAnswer(prose, { voice: "desk" });
    expect(out.length).toBeLessThanOrEqual(AGENT_HISTORY_CONTENT_MAX);
  });
});
