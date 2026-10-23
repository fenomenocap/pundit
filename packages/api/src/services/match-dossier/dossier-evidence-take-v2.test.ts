import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { runDossierEvidenceCapture } from "./dossier-evidence-capture";
import { DOSSIER_SYNTHETIC_AWAY, DOSSIER_SYNTHETIC_HOME } from "./dossier-synthetic-fixture";
import { isTakeV2DossierEvidence, type DossierEvidenceItem } from "./types";

const asOf = new Date("2026-10-19T12:00:00.000Z");
/** Hermetic page retrieval: a fixed public address (no DNS) and a fixed clock, so these tests never depend on the network or the wall-clock date. */
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("take v2 dossier evidence contract (#341)", () => {
  it("promoted page-verified items set fixtureMatchVerified and freshnessVerified true", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, { fixtureId: 909990010 });
    const claimSnippet = "Test Player Alpha is doubtful for North Testborough FC";
    const mockFetch = async () => new Response(
      `<html><body><p>SYNTHETIC FIXTURE ONLY. ${claimSnippet} ahead of South Example City.</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const { verifiedItems } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:909990010",
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

    expect(verifiedItems).toHaveLength(1);
    const item = verifiedItems[0]!;
    expect(item.fixtureMatchVerified).toBe(true);
    expect(item.freshnessVerified).toBe(true);
    expect(isTakeV2DossierEvidence(item)).toBe(true);
  });

  it("drops stale-season items instead of promoting with false freshness flags", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      fixtureId: 909990011,
      utcDate: "2026-10-24T15:00:00.000Z",
    });
    const claimSnippet = "Test Player Gamma remains doubtful for North Testborough FC";
    const mockFetch = async () => new Response(
      `<html><body><p>SYNTHETIC FIXTURE ONLY. ${claimSnippet} ahead of South Example City.</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );

    const { verifiedItems, dropped } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:909990011",
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
          link: "https://www.bbc.co.uk/sport/synthetic-dossier-ci-stale-season",
          snippet: claimSnippet,
          date: "2026-05-10",
        }],
      }],
      pageRetrieval: { fetch: mockFetch, resolveHost: publicResolver, now: () => asOf },
    });

    expect(verifiedItems).toHaveLength(0);
    expect(dropped.some((d) => d.reason === "outside_current_season")).toBe(true);
    expect(verifiedItems.every((i) => i.freshnessVerified === true)).toBe(true);
  });

  it("isTakeV2DossierEvidence rejects FPL structured rows (x-pundit-take path uses isFplBootstrapInjuryItem)", () => {
    const item: DossierEvidenceItem = {
      id: "fpl",
      claim: "Saka (Arsenal)",
      sourceUrl: "https://fantasy.premierleague.com/api/bootstrap-static/",
      publisher: "fantasy.premierleague.com",
      publishedAt: "2026-10-18T10:00:00.000Z",
      retrievedAt: "2026-10-19T00:00:00.000Z",
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fpl-bootstrap-static",
      tier: "interim",
      internalOnly: true,
      player: "Saka",
      club: "Arsenal",
      status: "d",
      chanceOfPlaying: 75,
      newsAddedAt: "2026-10-18T10:00:00.000Z",
      newsText: "Knock - audit only",
    };
    expect(isTakeV2DossierEvidence(item)).toBe(false);
  });

  it("isTakeV2DossierEvidence rejects cited or partially flagged items", () => {
    const base: DossierEvidenceItem = {
      id: "x",
      claim: "c",
      sourceUrl: "https://example.test/a",
      publisher: "example.test",
      publishedAt: null,
      retrievedAt: "2026-10-19T00:00:00.000Z",
      trustTier: "news",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "other",
      category: "tactics",
      origin: "scheduled",
    };
    expect(isTakeV2DossierEvidence(base)).toBe(false);
    expect(isTakeV2DossierEvidence({
      ...base,
      verification: "page-verified",
      fixtureMatchVerified: true,
      freshnessVerified: false,
    })).toBe(false);
    expect(isTakeV2DossierEvidence({
      ...base,
      verification: "page-verified",
      fixtureMatchVerified: true,
      freshnessVerified: true,
    })).toBe(true);
  });
});
