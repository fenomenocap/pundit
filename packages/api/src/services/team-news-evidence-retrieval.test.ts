import { describe, expect, it } from "vitest";
import type { WebSearchOutcome } from "./web-search";
import type { EvidenceTier } from "./evidence-authority";
import {
  appendTeamNewsSearchResults,
  injuryOnlyTeamNewsNeedsSiteBeatRetry,
  injurySiteBeatQueries,
  INJURY_ONLY_SITE_BEAT_FALLBACK_ORDER,
} from "./team-news-evidence-retrieval";

const fixture = {
  fixtureId: "espn:eng.1:401878771",
  home: "Everton",
  away: "Chelsea",
  kickoff: "2026-10-17",
};

const okOutcome = (
  results: Array<{ title: string; link: string; snippet?: string; date?: string }>
): WebSearchOutcome => ({
  status: "ok",
  provider: "minimax",
  usedFallback: false,
  reason: null,
  attempts: [],
  results: results.map((row) => ({
    title: row.title,
    link: row.link,
    snippet: row.snippet ?? "",
    date: row.date ?? "",
  })),
});

describe("injurySiteBeatQueries", () => {
  it("orders beats for fallback after the six-query initial pass", () => {
    expect(INJURY_ONLY_SITE_BEAT_FALLBACK_ORDER[0]).toBe("football.london");
    expect(injurySiteBeatQueries("football.london", "Everton", "Chelsea", "2026-10-14")).toEqual([
      "site:football.london Everton injury update 2026-10-14",
      "site:football.london Chelsea injury update 2026-10-14",
    ]);
  });
});

describe("injuryOnlyTeamNewsNeedsSiteBeatRetry", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");

  it("does not retry when dated club candidates already exist", () => {
    const sources = [{
      id: "S1",
      title: "Chelsea injury latest",
      url: "https://www.football.london/chelsea-fc/news/injury",
      date: "2026-10-13T15:30:03Z",
      snippet: "Reece James (Chelsea) is injured.",
    }];
    expect(injuryOnlyTeamNewsNeedsSiteBeatRetry(sources, fixture, now)).toBe(false);
  });

  it("does not retry when allowlisted club-injury pages may hydrate", () => {
    const sources = [{
      id: "S1",
      title: "Everton injury latest",
      url: "https://www.skysports.com/football/news/123",
      date: "",
      snippet: "Dominic Calvert-Lewin injury concern for Everton.",
    }];
    expect(injuryOnlyTeamNewsNeedsSiteBeatRetry(sources, fixture, now)).toBe(false);
  });

  it("retries when only non-allowlisted or non-injury hits remain", () => {
    const fanBlog = {
      id: "S1",
      title: "Everton vs Chelsea preview",
      url: "https://randomfan.example/preview",
      date: "2026-10-13T15:30:03Z",
      snippet: "Injury news for both sides.",
    };
    expect(injuryOnlyTeamNewsNeedsSiteBeatRetry([fanBlog], fixture, now)).toBe(true);

    const preview = {
      id: "S2",
      title: "Everton vs Chelsea team news",
      url: "https://www.bbc.com/sport/football/articles/abc",
      date: "2026-10-13T15:30:03Z",
      snippet: "Predicted lineup for the fixture.",
    };
    expect(injuryOnlyTeamNewsNeedsSiteBeatRetry([preview], fixture, now)).toBe(true);
  });
});

describe("appendTeamNewsSearchResults", () => {
  it("merges new allowlisted injury hits and re-selects team-news sources", () => {
    const existing = [{
      id: "S1",
      title: "Everton vs Chelsea preview",
      url: "https://www.bbc.com/sport/football/articles/preview",
      date: "2026-10-13T00:00:00Z",
      snippet: "Fixture preview only.",
      tier: "news" as EvidenceTier,
    }];
    const outcomes = [okOutcome([{
      title: "Chelsea dealt injury scare before Everton clash",
      link: "https://www.football.london/chelsea-fc/news/chelsea-dealt-injury-scare-before-34759085",
      date: "2026-10-13T15:30:03Z",
      snippet: "Reece James (Chelsea) is injured.",
    }])];
    const merged = appendTeamNewsSearchResults(existing, outcomes, fixture);
    expect(merged.some((row) => row.url.includes("football.london"))).toBe(true);
    expect(merged[0]?.url).toContain("football.london");
  });
});
