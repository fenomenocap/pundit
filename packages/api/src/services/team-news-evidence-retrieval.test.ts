import { describe, expect, it } from "vitest";
import type { WebSearchOutcome } from "./web-search";
import type { EvidenceTier } from "./evidence-authority";
import {
  appendManagerSearchResults,
  appendTeamNewsSearchResults,
  injuryOnlyTeamNewsHasApprovedEvidence,
  injuryOnlyTeamNewsHasApprovedEvidenceFromSelected,
  injuryOnlyTeamNewsNeedsSiteBeatRetry,
  injurySiteBeatFallbackOrder,
  injurySiteBeatQueries,
  managerLookupNeedsSiteBeatRetry,
  managerNarrowRetryQueries,
  managerSiteBeatFallbackOrder,
  managerSiteBeatQueries,
  NATIONAL_NEWS_SITE_BEAT_DEFAULTS,
  SITE_BEAT_RETRY_PROVIDER_CALLS,
  siteBeatRetryWouldExceedBudget,
} from "./team-news-evidence-retrieval";
import { initialEvidenceQueryCap, PROVIDER_CALL_BUDGET } from "./ask";

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

describe("site beat budget helpers", () => {
  it("reserves provider calls for injury-only and manager lookups", () => {
    expect(SITE_BEAT_RETRY_PROVIDER_CALLS).toBe(2);
    expect(initialEvidenceQueryCap({ injuryOnlyTeamNews: true })).toBe(6);
    expect(initialEvidenceQueryCap({ managerLookup: true })).toBe(6);
    expect(initialEvidenceQueryCap({})).toBe(6);
  });

  it("detects when a site-beat retry would exceed the provider budget", () => {
    expect(siteBeatRetryWouldExceedBudget(8, 2, PROVIDER_CALL_BUDGET)).toBe(false);
    expect(siteBeatRetryWouldExceedBudget(9, 2, PROVIDER_CALL_BUDGET)).toBe(true);
  });
});

describe("injurySiteBeatFallbackOrder", () => {
  it("prefers club-local beats before national defaults for Everton vs Chelsea", () => {
    const beats = injurySiteBeatFallbackOrder("Everton", "Chelsea");
    expect(beats[0]).toBe("liverpoolecho.co.uk");
    expect(beats[1]).toBe("football.london");
    expect(beats.slice(-2)).toEqual([...NATIONAL_NEWS_SITE_BEAT_DEFAULTS]);
  });

  it("builds retry queries without an ISO date", () => {
    expect(injurySiteBeatQueries("liverpoolecho.co.uk", "Everton", "Chelsea")).toEqual([
      "site:liverpoolecho.co.uk Everton injury update",
      "site:liverpoolecho.co.uk Chelsea injury update",
    ]);
  });
});

describe("manager site beat helpers", () => {
  it("orders local then national beats for a club manager lookup", () => {
    expect(managerSiteBeatFallbackOrder("Arsenal")[0]).toBe("football.london");
    expect(managerSiteBeatQueries("bbc.com/sport/football", "Arsenal")).toEqual([
      "site:bbc.com/sport/football Arsenal manager head coach",
    ]);
  });

  it("retries when no allowlisted manager reporting exists", () => {
    const fanBlog = {
      id: "S1",
      title: "Arsenal preview",
      url: "https://randomfan.example/preview",
      date: "",
      snippet: "Arsenal manager news is thin here.",
    };
    expect(managerLookupNeedsSiteBeatRetry([fanBlog], "Arsenal")).toBe(true);

    const beat = {
      id: "S2",
      title: "Arsenal manager update",
      url: "https://www.bbc.com/sport/football/articles/abc",
      date: "2026-10-13T00:00:00Z",
      snippet: "Arsenal manager Mikel Arteta spoke to reporters.",
    };
    expect(managerLookupNeedsSiteBeatRetry([beat], "Arsenal")).toBe(false);
  });

  it("builds a narrow head-coach retry with the official club site when known", () => {
    expect(managerNarrowRetryQueries("Everton")).toEqual([
      "Everton head coach",
      "site:evertonfc.com head coach manager",
    ]);
    expect(managerNarrowRetryQueries("Coventry City")).toEqual(["Coventry City head coach"]);
  });
});

describe("injuryOnlyTeamNewsHasApprovedEvidence", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");

  it("ignores dated club reports that would be dropped before desk filters", () => {
    const selected = [{
      id: "S1",
      title: "Everton vs Chelsea preview",
      url: "https://www.bbc.com/sport/football/articles/preview",
      date: "2026-10-13T00:00:00Z",
      snippet: "General schedule notes only.",
    }];
    expect(injuryOnlyTeamNewsHasApprovedEvidenceFromSelected(selected, fixture, now)).toBe(false);
    expect(injuryOnlyTeamNewsHasApprovedEvidenceFromSelected([{
      ...selected[0],
      title: "Everton team news update",
      snippet: "Dominic Calvert-Lewin was sidelined with a hamstring injury.",
    }], fixture, now)).toBe(true);
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

describe("appendManagerSearchResults", () => {
  it("merges allowlisted manager hits without team-news selection", () => {
    const existing = [{
      id: "S1",
      title: "Arsenal news",
      url: "https://www.bbc.com/sport/football/articles/old",
      date: "2026-10-01T00:00:00Z",
      snippet: "General news.",
      tier: "news" as EvidenceTier,
    }];
    const outcomes = [okOutcome([{
      title: "Arsenal manager Mikel Arteta speaks",
      link: "https://www.bbc.com/sport/football/articles/manager",
      date: "2026-10-13T00:00:00Z",
      snippet: "Arsenal manager Mikel Arteta updated reporters.",
    }])];
    const merged = appendManagerSearchResults(existing, outcomes);
    expect(merged.some((row) => row.url.includes("/manager"))).toBe(true);
  });
});
