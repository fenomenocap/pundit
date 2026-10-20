import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { extractArticleBodyFromHtml } from "../article-body-extract";
import { runDossierEvidenceCapture } from "./dossier-evidence-capture";
import {
  decodeEvidenceClaimText,
  gateHeadlineMismatch,
  gateTeamScope,
  gateUpcomingMatchContext,
  selectVerifiedBodyClaim,
  sentenceLooksLikePromoOrNav,
} from "./dossier-evidence-gate";

const asOf = new Date("2026-10-19T12:00:00.000Z");

describe("dossier evidence spot-check regressions (pass 2)", () => {
  it("(1) BBC: claim is body sentence only, not title — nav chrome", async () => {
    const row = fixture("Crystal Palace", "Newcastle", {
      utcDate: "2026-10-24T15:00:00.000Z",
      date: "2026-10-24",
    });
    const bodyLine = "Newcastle striker Alexander Isak is doubtful for the trip to Selhurst Park with a knee knock.";
    const html = `<html><body>
      BBC Homepage Skip to content Home News Sport
      <article>
      <h1>Crystal Palace vs Newcastle team news</h1>
      <p>${bodyLine}</p>
      </article>
    </body></html>`;
    const extracted = extractArticleBodyFromHtml(html, "https://www.bbc.co.uk/sport/football/example");
    expect(extracted?.source).toBeTruthy();
    const claim = selectVerifiedBodyClaim(row, "injuries", extracted!.text, "Isak doubtful Newcastle");
    expect(claim).toContain("Isak");
    expect(claim).not.toMatch(/BBC Homepage/i);
    expect(claim).not.toContain("—");

    const mockFetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const { verifiedItems } = await runDossierEvidenceCapture(row, {
      fixtureId: "espn:eng.1:spot-bbc",
      persistCapture: false,
      now: asOf,
      queries: ["Crystal Palace vs Newcastle team news injuries suspensions availability 2025/26"],
      searchOutcomes: [{
        status: "ok",
        provider: "test",
        reason: null,
        usedFallback: false,
        attempts: [],
        results: [{
          title: "Crystal Palace vs Newcastle team news",
          link: "https://www.bbc.co.uk/sport/football/spotcheck-bbc-team-news",
          snippet: "Isak doubtful for Selhurst Park trip",
          date: "2026-10-18",
        }],
      }],
      pageRetrieval: { fetch: mockFetch },
    });
    expect(verifiedItems[0]?.claim).toMatch(/Isak.*doubtful/i);
    expect(verifiedItems[0]?.claim).not.toMatch(/Skip to content/i);
  });

  it("(1) arsenal.com hospitality promo is rejected", () => {
    expect(sentenceLooksLikePromoOrNav("Skip to main content Shop Hospitality packages for Emirates Stadium")).toBe(true);
  });

  it("(1) liverpoolfc hospitality headline is rejected", () => {
    expect(sentenceLooksLikePromoOrNav("2026/27 Premier League Matchday Hospitality On Sale Now for members")).toBe(true);
  });

  it("(1) Yahoo nav chrome is rejected", () => {
    expect(sentenceLooksLikePromoOrNav("Search Query for Search Home News Sports Finance")).toBe(true);
  });

  it("(1) decodes HTML entities in stored claims", () => {
    expect(decodeEvidenceClaimText("Isak&#x27;s knee knock remains a doubt")).toBe("Isak's knee knock remains a doubt");
  });

  it("(2) rejects injury list vs Bayern/Villarreal", () => {
    const row = fixture("Arsenal", "Chelsea", { utcDate: "2026-10-24T15:00:00.000Z" });
    expect(gateUpcomingMatchContext(row, "Arsenal injury list vs Bayern Munich ahead of European tie", "injuries"))
      .toBe("match_context_other_opponent");
  });

  it("(2) rejects Newcastle team news tied to Villa game under Palace–Newcastle dossier", () => {
    const row = fixture("Crystal Palace", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const reason = gateUpcomingMatchContext(
      row,
      "Newcastle United published confirmed team news from the Aston Villa match with three changes.",
      "rotation",
    );
    expect(reason).toBe("fixture_mismatch:foreign_club");
  });

  it("(3) rejects women's / WSL manager scope", () => {
    expect(gateTeamScope(
      "Arturo Ruiz named new Brighton head coach",
      "Arturo Ruiz has been appointed Brighton head coach in the WSL.",
    )).toBe("team_scope_womens_or_youth");
  });

  it("(3) rejects ESPN search title when article headline is a different story", () => {
    expect(gateHeadlineMismatch(
      "Arturo Ruiz named new Brighton head coach in Premier League",
      "Brighton Women confirm new head coach for WSL campaign",
    )).toBe("headline_mismatch");
  });
});
