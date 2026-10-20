import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { runDossierEvidenceCapture } from "./dossier-evidence-capture";
import {
  gateContractNotNewsGrade,
  gatePriorRoundReference,
} from "./dossier-evidence-gate";

const asOf = new Date("2026-10-19T12:00:00.000Z");

function sportsMoleHtml(bodyLine: string): string {
  return `<html><body><article><h1>Team news</h1><p>${bodyLine}</p></article></body></html>`;
}

async function expectCaptureRejected(
  row: ReturnType<typeof fixture>,
  opts: {
    fixtureId: string;
    title: string;
    url: string;
    snippet: string;
    html: string;
    query: string;
    date: string;
  },
): Promise<string | undefined> {
  const mockFetch = async () => new Response(opts.html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const { verifiedItems, capture } = await runDossierEvidenceCapture(row, {
    fixtureId: opts.fixtureId,
    persistCapture: false,
    now: asOf,
    queries: [opts.query],
    searchOutcomes: [{
      status: "ok",
      provider: "test",
      reason: null,
      usedFallback: false,
      attempts: [],
      results: [{
        title: opts.title,
        link: opts.url,
        snippet: opts.snippet,
        date: opts.date,
      }],
    }],
    pageRetrieval: { fetch: mockFetch },
  });
  expect(verifiedItems).toHaveLength(0);
  const dropped = capture.verifications.find((v) => v.outcome === "dropped");
  expect(dropped).toBeTruthy();
  return dropped?.reason;
}

describe("dossier evidence spot-check regressions (pass 3)", () => {
  it("rejects Sports Mole Liverpool vs Villarreal team news on Liverpool–Chelsea dossier", async () => {
    const row = fixture("Liverpool", "Chelsea", { utcDate: "2026-10-25T15:00:00.000Z", date: "2026-10-25" });
    const reason = await expectCaptureRejected(row, {
      fixtureId: "espn:eng.1:pass3-liverpool-villarreal",
      title: "Liverpool vs Villarreal team news: Suspensions and injuries",
      url: "https://www.sportsmole.co.uk/football/liverpool-vs-villarreal-team-news_suspended-players_562001.html",
      snippet: "Liverpool suspended players Champions League",
      html: sportsMoleHtml("Liverpool have no suspended players for this match ahead of their next fixture."),
      query: "Liverpool vs Chelsea team news injuries suspensions availability 2025/26",
      date: "2026-10-18",
    });
    expect(reason).toMatch(/match_context_wrong_opponent|fixture_mismatch|match_context_non_pl/);
  });

  it("rejects Sports Mole Arsenal vs Bayern team news on Arsenal–Chelsea dossier", async () => {
    const row = fixture("Arsenal", "Chelsea", { utcDate: "2026-10-25T15:00:00.000Z", date: "2026-10-25" });
    const reason = await expectCaptureRejected(row, {
      fixtureId: "espn:eng.1:pass3-arsenal-bayern",
      title: "Arsenal vs Bayern team news: Injury list",
      url: "https://www.sportsmole.co.uk/football/arsenal-vs-bayern-team-news_injuries_562002.html",
      snippet: "Arsenal injury list European tie",
      html: sportsMoleHtml("There are no suspended players for this match in the Arsenal squad ahead of kick-off."),
      query: "Arsenal vs Chelsea team news injuries suspensions availability 2025/26",
      date: "2026-10-18",
    });
    expect(reason).toMatch(/match_context_wrong_opponent|fixture_mismatch|match_context_other_opponent/);
  });

  it("rejects Sports Mole Villa vs Viking team news on Villa–West Ham dossier", async () => {
    const row = fixture("Aston Villa", "West Ham", { utcDate: "2026-10-25T15:00:00.000Z", date: "2026-10-25" });
    const reason = await expectCaptureRejected(row, {
      fixtureId: "espn:eng.1:pass3-villa-viking",
      title: "Villa vs Viking team news: Suspensions and injuries",
      url: "https://www.sportsmole.co.uk/football/villa-vs-viking-team-news_suspended-players_562003.html",
      snippet: "Aston Villa suspended players Europa League",
      html: sportsMoleHtml("Aston Villa have no suspended players for this match after their midweek European game."),
      query: "Aston Villa vs West Ham team news injuries suspensions availability 2025/26",
      date: "2026-10-18",
    });
    expect(reason).toMatch(/match_context_wrong_opponent|fixture_mismatch|match_context_non_pl_competition/);
  });

  it("rejects Coventry–Fulham manager item about Hull", async () => {
    const row = fixture("Coventry", "Fulham", { utcDate: "2026-10-25T15:00:00.000Z", date: "2026-10-25" });
    const reason = await expectCaptureRejected(row, {
      fixtureId: "espn:eng.1:pass3-coventry-hull-manager",
      title: "Hull City confirm head coach update ahead of weekend",
      url: "https://www.sportsmole.co.uk/football/hull-city-head-coach-update-oct-2026_562004.html",
      snippet: "Hull head coach press conference",
      html: `<html><body><article><p>Hull City head coach Liam Rosenior said his squad is focused on the Championship run-in after a pivotal weekend.</p></article></body></html>`,
      query: "Coventry vs Fulham manager head coach press conference 2025/26",
      date: "2026-10-18",
    });
    expect(reason).toMatch(/claim_subject_foreign_club|fixture_mismatch:foreign_club/);
  });

  it("rejects Bournemouth item about Scotland v Slovenia", async () => {
    const row = fixture("Bournemouth", "Everton", { utcDate: "2026-10-25T15:00:00.000Z", date: "2026-10-25" });
    const reason = await expectCaptureRejected(row, {
      fixtureId: "espn:eng.1:pass3-bournemouth-scotland",
      title: "Scotland vs Slovenia: Team news and injury update",
      url: "https://www.sportsmole.co.uk/football/scotland-vs-slovenia-team-news-international_562005.html",
      snippet: "Scotland team news international fixture",
      html: `<html><body><article><p>Scotland vs Slovenia team news: two players are doubtful for the international friendly in Ljubljana.</p></article></body></html>`,
      query: "Bournemouth vs Everton team news injuries suspensions availability 2025/26",
      date: "2026-10-18",
    });
    expect(reason).toMatch(/claim_subject_international|fixture_mismatch|claim_subject_foreign/);
  });

  it("drops prior-round weekend references before the fixture kickoff", () => {
    const ctx = { asOf, kickoffUtc: "2026-10-25T15:00:00.000Z" };
    expect(gatePriorRoundReference(
      "Pivotal weekend preview",
      "After a pivotal weekend on 17-18 October, the side turn to the next Premier League assignment.",
      ctx,
    )).toBe("freshness_prior_round");
  });

  it("drops contract items older than 30 days from asOf", () => {
    const ctx = { asOf, kickoffUtc: "2026-10-25T15:00:00.000Z" };
    expect(gateContractNotNewsGrade(
      "Star agrees new deal",
      "The forward signed a contract extension until next season.",
      new Date("2026-08-20T12:00:00.000Z"),
      ctx,
    )).toBe("contract_not_news_grade");
  });
});
