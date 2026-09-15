import { describe, expect, it } from "vitest";
import { sampleAgentFreshness } from "../config/freshness-policy";
import { deterministicSearchQuery } from "./ask";
import {
  asksStatisticalQuestion,
  groundedSkippedQueries,
  isRecentFormQuery,
  mergeSearchResults,
  planFederatedQueries,
  skipFormQueriesWhenGrounded,
  type FederatedMatchGrounding,
} from "./federated-evidence";
import type { WebSearchOutcome } from "./web-search";

const matchGrounding = (
  overrides: Partial<FederatedMatchGrounding> = {}
): FederatedMatchGrounding => ({
  kind: "match",
  home: "Arsenal",
  away: "Chelsea",
  homeForm: ["W", "D", "L"],
  awayForm: ["L", "W", "D"],
  freshness: sampleAgentFreshness({ tier: "matchday", reason: "kickoff within 24h" }),
  ...overrides,
});

describe("planFederatedQueries", () => {
  it("fans out analytics queries with embedded source hints for stat questions", () => {
    const mbeumo = "How has Bryan Mbeumo performed statistically this season?";
    const planned = planFederatedQueries(
      mbeumo,
      null,
      deterministicSearchQuery(mbeumo)
    );
    expect(planned.length).toBeGreaterThanOrEqual(2);
    expect(planned.some((query) => /\bfbref\b/.test(query))).toBe(true);
    expect(planned.some((query) => /\bwhoscored\b/.test(query))).toBe(true);
    expect(planned.some((query) => /\bfotmob\b/.test(query))).toBe(true);
    expect(planned.some((query) => /\btheanalyst\b/.test(query))).toBe(true);
    expect(planned.some((query) => /\btransfermarkt\b/.test(query))).toBe(true);
    expect(planned.every((query) => !/\bsite:/i.test(query))).toBe(true);
  });

  it("skips recent-form searches when match form is already grounded on matchday", () => {
    const grounding = matchGrounding();
    const planned = planFederatedQueries(
      "What about Arsenal vs Chelsea?",
      grounding,
      null
    );
    expect(skipFormQueriesWhenGrounded(grounding)).toBe(true);
    expect(planned.some((query) => isRecentFormQuery(query))).toBe(false);
  });

  it("still plans recent-form searches when freshness is normal", () => {
    const grounding = matchGrounding({
      freshness: sampleAgentFreshness({ tier: "normal", reason: "no imminent fixtures" }),
    });
    const planned = planFederatedQueries(
      "What about Arsenal vs Chelsea?",
      grounding,
      null
    );
    expect(skipFormQueriesWhenGrounded(grounding)).toBe(false);
    expect(planned.some((query) => isRecentFormQuery(query))).toBe(true);
  });

  it("reuses team-news fan-out without market-only queries", () => {
    const grounding = matchGrounding();
    const teamNewsQueries = planFederatedQueries(
      "What is the latest team news?",
      grounding,
      null
    );
    expect(teamNewsQueries.some((query) => /team news injuries/.test(query))).toBe(true);
    expect(teamNewsQueries.some((query) => /odds movement|public betting/.test(query))).toBe(false);
  });

  it("caps federated planning at six queries", () => {
    const planned = planFederatedQueries(
      "Give me your full preview of Arsenal vs Chelsea, including the 1X2, likely scorelines and any comparable market disagreement.",
      matchGrounding({ freshness: sampleAgentFreshness({ tier: "normal", reason: "test" }) }),
      null
    );
    expect(planned.length).toBeLessThanOrEqual(6);
  });

  it("returns no queries for general knowledge without a search cue", () => {
    expect(
      planFederatedQueries(
        "Explain the offside rule",
        null,
        deterministicSearchQuery("Explain the offside rule")
      )
    ).toEqual([]);
  });
});

describe("mergeSearchResults", () => {
  const outcome = (
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

  it("dedupes by URL and tags authority tier", () => {
    const merged = mergeSearchResults([
      outcome([
        { title: "A", link: "https://www.fbref.com/a" },
        { title: "Dup", link: "https://www.fbref.com/a" },
        { title: "B", link: "https://www.reuters.com/b" },
      ]),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((row) => row.link.includes("fbref"))?.tier).toBe("analytics");
    expect(merged.find((row) => row.link.includes("reuters"))?.tier).toBe("news");
  });

  it("ranks official and analytics ahead of news for stat questions", () => {
    const merged = mergeSearchResults(
      [
        outcome([
          { title: "News", link: "https://www.reuters.com/story" },
          { title: "Stats", link: "https://www.fbref.com/stats" },
          { title: "Club", link: "https://www.arsenal.com/news/update" },
        ]),
      ],
      { asksStats: true }
    );
    expect(merged.map((row) => row.tier)).toEqual(["official", "analytics", "news"]);
  });
});

describe("asksStatisticalQuestion", () => {
  it("detects explicit stats vocabulary and performed-this-season phrasing", () => {
    expect(asksStatisticalQuestion("How has Bryan Mbeumo performed statistically this season?")).toBe(true);
    expect(asksStatisticalQuestion("Explain the offside rule")).toBe(false);
  });
});

describe("groundedSkippedQueries", () => {
  it("returns the recent-form query skipped when match form is already grounded", () => {
    expect(groundedSkippedQueries(matchGrounding())).toEqual([
      "Arsenal Chelsea recent form last 5 matches results",
    ]);
  });

  it("returns nothing when form is not already on the card", () => {
    expect(groundedSkippedQueries(null)).toEqual([]);
  });
});
