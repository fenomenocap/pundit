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
  singleClubCurrentFactScope,
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
  it.each([
    ["2026-10-07T06:00:00Z", "September 2026 October 2026"],
    ["2027-01-01T00:00:00Z", "December 2026 January 2027"],
  ])("diversifies manager retrieval with a recent news window (%s)", (origin, months) => {
    const grounding = matchGrounding();
    const question = "Who is Arsenal's manager and why?";
    const now = new Date(origin);
    const queries = planFederatedQueries(question, grounding, deterministicSearchQuery(question, "", grounding as never, now), now);
    expect(queries[1]).toContain(months);
    expect(queries[1]).toMatch(/manager head coach latest appointment contract news/);
    expect(queries[1]).toMatch(/BBC Sky Sports official/);
    expect(queries.some((query) => /Arteta|Emery|Wenger|Chelsea/.test(query))).toBe(false);
    expect(queries.some((query) => query.includes(question))).toBe(true);
    expect(queries.slice(0, 4)).toHaveLength(4);
  });

  it("targets an explicitly named club manager or result without searching its pinned opponent", () => {
    const grounding = matchGrounding();
    const now = new Date("2026-10-05T00:00:00Z");
    for (const question of ["Who's Arsenal's manager and why?", "What is Arsenal's latest result and why?"]) {
      const queries = planFederatedQueries(question, grounding, deterministicSearchQuery(question, "", grounding as never, now), now);
      expect(queries[0]).toMatch(/Arsenal.*(?:current manager|latest completed match result).*2026-10-05/);
      expect(queries[0]).toContain("official");
      expect(queries.some((query) => /Chelsea|injuries|predicted lineup|recent form/.test(query))).toBe(false);
      expect(queries.length).toBeLessThanOrEqual(6);
    }
  });

  it("does not infer single-club fact scope for ambiguous, two-club, explicit-fixture or role questions", () => {
    const grounding = matchGrounding();
    for (const question of ["Who is the manager?", "Who is Liverpool's manager?", "Who are Arsenal and Chelsea's managers?", "What was Arsenal vs Brighton's final score?", "Who manages the space in Arsenal's midfield?", "Who is Liverpool's manager and why do Arsenal struggle?", "Who is Arsenal's manager and Liverpool's manager?", "Who is Arsenal's manager and Liverpool?"]) {
      expect(singleClubCurrentFactScope(question, grounding)).toBeNull();
    }
    for (const question of [
      "What is Arsenal’s latest result against Liverpool?",
      "What is Arsenal's latest result against Riverside United?",
      "What was Arsenal's latest result away to Liverpool?",
      "What was Arsenal's latest result home to Riverside United?",
      "Who is Arsenal's manager against Liverpool?",
      "Who manages Arsenal against a high press?",
      "Who was Arsenal's manager in 2013?",
      "Who will be Arsenal's manager in 2028?",
      "Who is Arsenal's manager in 2013?",
      "Who manages Arsenal next season?",
      "What was Arsenal's latest result in 2013?",
      "What is Arsenal's final score tomorrow?",
      "Who is Arsenal's manager and why is Liverpool stronger?",
      "Who is Arsenal's manager and why is Leeds stronger?",
      "Who is Arsenal's manager? Who is Leeds' manager?",
      "Who is Arsenal's manager while Liverpool changes coach?",
      "Who is Arsenal's manager; what is Leeds' latest result?",
      "Who manages Arsenal, while Riverside United changes coach?",
      "Who is Arsenal's manager and why was he appointed? Who manages Leeds?",
      "What is Arsenal's latest result and why is Liverpool stronger?",
    ]) expect(singleClubCurrentFactScope(question, grounding)).toBeNull();
    for (const question of ["Who is Arsenal's manager and why?", "Who is Arsenal's manager and why was he appointed?", "Who is Arsenal's manager today and why was he appointed?", "Who is Arsenal's manager and why is he still in charge?", "What is Arsenal's latest result and why did they win?"]) {
      expect(singleClubCurrentFactScope(question, grounding)).toEqual({ kind: /manager/.test(question) ? "manager" : "result", club: "Arsenal" });
    }
    expect(singleClubCurrentFactScope("Who is the manager of Arsenal today?", grounding)).toEqual({ kind: "manager", club: "Arsenal" });
    expect(singleClubCurrentFactScope("Who coaches Arsenal today?", grounding)).toEqual({ kind: "manager", club: "Arsenal" });
    expect(singleClubCurrentFactScope("What is Manchester City's latest result?", matchGrounding({ home: "Man City" }))).toEqual({ kind: "result", club: "Man City" });
    expect(singleClubCurrentFactScope("What is Arsenal's latest result?", null)).toBeNull();
  });

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

  it("plans a standings and an outright search for a league-winner question", () => {
    const planned = planFederatedQueries("Who will win Serie A?", null, "Who will win Serie A? football latest 2026-27", new Date("2026-09-29T00:00:00Z"));
    expect(planned).toContain("Serie A 2026-27 standings table points");
    expect(planned).toContain("Serie A 2026-27 title odds favourites");
    expect(planFederatedQueries("Explain the offside rule", null, null)).toEqual([]);
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

  it("does not search injuries or managers for a tactical or briefing take", () => {
    const grounding = matchGrounding();
    for (const question of [
      "Tactical matchup",
      "Give me the match briefing for Arsenal vs Chelsea.",
    ]) {
      const planned = planFederatedQueries(question, grounding, null);
      expect(planned.some((query) => /team news injuries|predicted lineup|head coach|recent form/.test(query)))
        .toBe(false);
    }
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

  it("retrieves dated club injury updates before previews of an upcoming matchup", () => {
    const queries = planFederatedQueries("What is the latest team news?", matchGrounding(),
      "latest team news", new Date("2026-10-06T00:00:00Z"));
    expect(queries).toHaveLength(6);
    expect(queries).toContain("Arsenal latest injury update team news official club 2026-10-06");
    expect(queries).toContain("Chelsea latest injury update team news official club 2026-10-06");
    expect(queries.slice(0, 2)).toEqual([
      "Arsenal latest injury update team news official club 2026-10-06",
      "Chelsea latest injury update team news official club 2026-10-06",
    ]);
    expect(queries).toContain("Arsenal vs Chelsea team news injuries suspensions predicted lineup");
    expect(queries.some((query) => /goalscorer|odds movement/.test(query))).toBe(false);
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
