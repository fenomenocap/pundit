import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  categoryForQuery,
  planDossierEvidenceQueries,
} from "./dossier-evidence";
import {
  claimLooksLikeBoilerplate,
  gateFixtureTeamMatch,
  gatePostDateResolve,
  gatePreFetch,
  gateSeasonAndCategoryWindow,
  resolveEvidencePublishedAt,
  seasonStartUtc,
} from "./dossier-evidence-gate";
import { extractPublicationDateWithSource } from "../evidence-page-retrieval";

const asOf = new Date("2026-10-19T12:00:00.000Z");
const kickoff = "2026-10-24T15:00:00.000Z";
const gateCtx = { asOf, kickoffUtc: kickoff };

describe("dossier evidence gate", () => {
  it("drops injury/lineup hits for the wrong fixture pairing", () => {
    const forestArsenal = fixture("Forest", "Arsenal", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const injuryQuery = planDossierEvidenceQueries(forestArsenal, asOf).find((q) => /injur|suspension|availability/i.test(q))!;

    const wrongPair = gateFixtureTeamMatch(
      forestArsenal,
      "Ipswich vs Forest team news",
      "Ipswich vs Forest — Confirmed team news from the prior meeting",
      categoryForQuery(injuryQuery),
    );
    expect(wrongPair).toBe("match_context_wrong_opponent");

    const foreignClub = gateFixtureTeamMatch(
      forestArsenal,
      "Everton v Forest preview",
      "Everton v Forest — Rotation expected for the midweek tie",
      "rotation",
    );
    expect(foreignClub).toBe("match_context_wrong_opponent");
  });

  it("drops lineup snippets that name unrelated clubs (Spurs–Coventry dossier)", () => {
    const spursCoventry = fixture("Tottenham", "Coventry", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const reason = gatePreFetch(spursCoventry, {
      title: "Coventry vs Fulham predicted lineup",
      snippet: "Coventry vs Fulham starting xi expected with rotation",
      url: "https://www.bbc.co.uk/sport/football/example-coventry-fulham",
      publishedAtRaw: "2026-10-18",
      query: `${spursCoventry.home} vs ${spursCoventry.away} predicted lineup rotation starting xi 2026-10-19`,
    }, gateCtx);
    expect(reason).toMatch(/claim_subject_foreign_club|match_context_wrong_opponent|fixture_mismatch:foreign_club/);
  });

  it("rejects BBC nav chrome as boilerplate", () => {
    expect(claimLooksLikeBoilerplate("Skip to content Home News Sport", "")).toBe(true);
    const pre = gatePreFetch(fixture("Chelsea", "Tottenham"), {
      title: "BBC Sport",
      snippet: "Home News Sport Business Innovation Culture Travel",
      url: "https://www.bbc.co.uk/sport/football/articles/example",
      publishedAtRaw: "2026-10-19",
      query: "Chelsea vs Tottenham team news injuries suspensions availability 2025/26",
    }, gateCtx);
    expect(pre).toBe("boilerplate_chrome");
  });

  it("(6) applies season and category window to tactics and motivation, not only injuries", () => {
    const seasonStart = seasonStartUtc(kickoff);
    const priorSeason = new Date(seasonStart.getTime() - 30 * 86_400_000);
    expect(gateSeasonAndCategoryWindow("tactics", priorSeason, "Pressing shape note", gateCtx)).toBe(
      "outside_current_season",
    );

    const staleMotivation = new Date(asOf.getTime() - 20 * 86_400_000);
    expect(gateSeasonAndCategoryWindow("motivation", staleMotivation, "Title race motivation", gateCtx)).toBe(
      "category_window_exceeded_14d",
    );

    const freshTactics = new Date(asOf.getTime() - 5 * 86_400_000);
    expect(gateSeasonAndCategoryWindow("tactics", freshTactics, "High press matchup", gateCtx)).toBeNull();
  });

  it("(6) drops May 2026 team-news dates when dossier asOf is October 2026", () => {
    const chelseaSpurs = fixture("Chelsea", "Tottenham", { utcDate: kickoff, date: kickoff.slice(0, 10) });
    const mayDate = new Date("2026-05-10T12:00:00.000Z");
    const post = gatePostDateResolve(chelseaSpurs, {
      title: "Chelsea vs Tottenham team news",
      snippet: "Injury update from the spring fixture",
      url: "https://www.bbc.co.uk/sport/football/example-chelsea-spurs-may",
      publishedAtRaw: "2026-05-10",
      query: "Chelsea vs Tottenham team news injuries suspensions availability 2025/26",
    }, { iso: mayDate.toISOString(), source: "search-result" }, gateCtx);
    expect(post).toBe("outside_current_season");
  });

  it("(7) requires publishedAt unless a page date is parsed, and records the source", () => {
    const htmlMeta = `<html><head><meta property="article:published_time" content="2026-10-18T09:00:00Z" /></head><body>Article</body></html>`;
    const fromMeta = extractPublicationDateWithSource(htmlMeta, asOf);
    expect(fromMeta?.source).toBe("meta-article-published-time");
    expect(resolveEvidencePublishedAt("", fromMeta!.date, fromMeta!.source)?.source).toBe(
      "meta-article-published-time",
    );

    const htmlJsonLd = `<html><script type="application/ld+json">{"datePublished":"2026-10-17T08:00:00Z"}</script></html>`;
    const fromJson = extractPublicationDateWithSource(htmlJsonLd, asOf);
    expect(fromJson?.source).toBe("json-ld-datePublished");

    const htmlTime = `<html><body><time datetime="2026-10-16T07:00:00Z">16 Oct</time></body></html>`;
    const fromTime = extractPublicationDateWithSource(htmlTime, asOf);
    expect(fromTime?.source).toBe("time-datetime");

    expect(resolveEvidencePublishedAt("", "", undefined)).toBeNull();
    const missing = gatePostDateResolve(fixture("Forest", "Arsenal"), {
      title: "Forest update",
      snippet: "Availability note without any search date",
      url: "https://www.bbc.co.uk/sport/football/example-no-date",
      publishedAtRaw: "",
      query: "Forest injury suspension update 2026-10-19",
    }, null, gateCtx);
    expect(missing).toBe("missing_published_at");
  });

  it("flags stale manager appointment copy outside the current season window", () => {
    const leBrisDate = new Date("2024-11-21T12:00:00.000Z");
    const reason = gateSeasonAndCategoryWindow(
      "manager",
      leBrisDate,
      "Sunderland appointed Le Bris as new head coach in November 2024",
      gateCtx,
    );
    expect(reason).toBe("outside_current_season");
  });
});
