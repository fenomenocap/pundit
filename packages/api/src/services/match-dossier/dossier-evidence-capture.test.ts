import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { DOSSIER_SYNTHETIC_AWAY, DOSSIER_SYNTHETIC_HOME } from "./dossier-synthetic-fixture";
import { runDossierEvidenceCapture } from "./dossier-evidence-capture";

const asOf = new Date("2026-10-19T12:00:00.000Z");
/** Hermetic page retrieval: a fixed public address (no DNS) and a fixed clock, so these tests never depend on the network or the wall-clock date. */
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("dossier evidence capture (synthetic, no network)", () => {
  it("verifies claims against mocked page bodies on example.test", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      fixtureId: 909990002,
    });
    const claimSnippet = "Test Player Alpha is doubtful for North Testborough FC";
    const mockFetch = async () => new Response(
      `<html><body><p>SYNTHETIC FIXTURE ONLY. ${claimSnippet} ahead of South Example City.</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const { capture, verifiedItems } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:909990002",
      persistCapture: false,
      now: asOf,
      queries: ["North Testborough FC injury suspension update 2026-10-19"],
      searchOutcomes: [{
        status: "ok",
        provider: "test",
        reason: null,
        usedFallback: false,
        attempts: [],
        results: [{
          title: "SYNTHETIC CI — North Testborough training",
          link: "https://www.bbc.co.uk/sport/synthetic-dossier-ci-fixture-only",
          snippet: claimSnippet,
          date: "2026-10-19",
        }],
      }],
      pageRetrieval: { fetch: mockFetch, resolveHost: publicResolver, now: () => asOf },
    });

    expect(capture.summary.verified).toBe(1);
    expect(capture.verifications[0]?.outcome).toBe("verified");
    expect(verifiedItems).toHaveLength(1);
    expect(verifiedItems[0]?.verification).toBe("page-verified");
    expect(verifiedItems[0]?.contentSha256).toHaveLength(64);
  });

  it("records drop reasons in capture log", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY);
    const mockFetch = async () => new Response("not found", { status: 404 });

    const { capture } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:909990003",
      persistCapture: false,
      now: asOf,
      queries: ["q"],
      searchOutcomes: [{
        status: "ok",
        provider: "test",
        reason: null,
        usedFallback: false,
        attempts: [],
        results: [{
          title: "Bad page",
          link: "https://www.bbc.co.uk/sport/football/fake-path-for-test",
          snippet: "Totally unrelated claim about Unknown Player Zeta",
          date: "2026-10-19",
        }],
      }],
      pageRetrieval: { fetch: mockFetch, resolveHost: publicResolver, now: () => asOf },
    });

    expect(capture.summary.verified).toBe(0);
    expect(capture.summary.dropped).toBe(1);
    expect(capture.verifications[0]?.reason).toMatch(/fetch_failed/);
  });

  it("(7) accepts page meta published time when search result has no date", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      fixtureId: 909990004,
      utcDate: "2026-10-24T15:00:00.000Z",
      date: "2026-10-24",
    });
    const claimSnippet = "Test Player Beta remains doubtful for North Testborough FC";
    const mockFetch = async () => new Response(
      `<html><head><meta property="article:published_time" content="2026-10-18T09:00:00Z" /></head>`
      + `<body><p>SYNTHETIC FIXTURE ONLY. ${claimSnippet} ahead of South Example City.</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const { verifiedItems, dropped } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:909990004",
      persistCapture: false,
      now: asOf,
      queries: ["North Testborough FC injury suspension update 2026-10-19"],
      searchOutcomes: [{
        status: "ok",
        provider: "test",
        reason: null,
        usedFallback: false,
        attempts: [],
        results: [{
          title: "SYNTHETIC CI — North Testborough training",
          link: "https://www.bbc.co.uk/sport/synthetic-dossier-ci-fixture-only-meta-date",
          snippet: claimSnippet,
          date: "",
        }],
      }],
      pageRetrieval: { fetch: mockFetch, resolveHost: publicResolver, now: () => asOf },
    });

    expect(dropped.filter((d) => d.reason === "missing_published_at")).toHaveLength(0);
    expect(verifiedItems).toHaveLength(1);
    expect(verifiedItems[0]?.publishedAtSource).toBe("meta-article-published-time");
    expect(verifiedItems[0]?.publishedAt).toMatch(/^2026-10-18/);
  });
});
