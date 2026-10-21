import { describe, expect, it } from "vitest";
import type { DossierEvidenceItem } from "./match-dossier/types";
import { managerNamesFromVerifiedDossier, stripUnlistedManagers } from "./pl-managers";

describe("managerNamesFromVerifiedDossier", () => {
  it("allows verified manager claims through stripUnlistedManagers", () => {
    const item: DossierEvidenceItem = {
      id: "mgr-1",
      claim: "Kieran McKenna remains Ipswich head coach.",
      sourceUrl: "https://example.com",
      publisher: "example.com",
      publishedAt: "2026-10-18T08:00:00.000Z",
      retrievedAt: "2026-10-18T09:00:00.000Z",
      trustTier: "news",
      verification: "page-verified",
      direction: "neutral",
      relatedFactor: "other",
      category: "manager",
      origin: "scheduled",
      fixtureMatchVerified: true,
      freshnessVerified: true,
    };
    const dossier = {
      evidence: [item],
      manager: { value: { home: { name: "Kieran McKenna", tenureNote: null }, away: { name: null, tenureNote: null } } },
    } as Parameters<typeof managerNamesFromVerifiedDossier>[0];
    const allowed = managerNamesFromVerifiedDossier(dossier);
    const prose = "McKenna has Ipswich organized in a low block. If Postecoglou's lot nick one, the draw grows.";
    const clean = stripUnlistedManagers(prose, allowed);
    expect(clean).toMatch(/McKenna/);
    expect(clean).not.toMatch(/Postecoglou/i);
  });
});
