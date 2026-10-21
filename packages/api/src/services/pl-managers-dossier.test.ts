import { describe, expect, it } from "vitest";
import type { DossierEvidenceItem } from "./match-dossier/types";
import { managerNamesFromVerifiedDossier, stripUnlistedManagers } from "./pl-managers";

function managerItem(claim: string, club: string, fresh = true): DossierEvidenceItem {
  return {
    id: `mgr-${claim.slice(0, 8)}`,
    claim,
    sourceUrl: "https://example.com",
    publisher: "example.com",
    publishedAt: "2026-10-18T08:00:00.000Z",
    retrievedAt: "2026-10-18T09:00:00.000Z",
    trustTier: "news",
    verification: "page-verified",
    direction: "neutral",
    relatedFactor: "other",
    category: "manager",
    club,
    origin: "scheduled",
    fixtureMatchVerified: true,
    freshnessVerified: fresh,
  };
}

describe("managerNamesFromVerifiedDossier", () => {
  it("allows verified manager claims through stripUnlistedManagers", () => {
    const item = managerItem("Kieran McKenna remains Ipswich head coach.", "Ipswich Town");
    const dossier = {
      fixture: {
        fixtureId: "test",
        espnEventId: 1,
        competitionId: "eng.1",
        competition: "Premier League",
        kickoffUtc: "2026-10-24T15:00:00.000Z",
        home: "Ipswich Town",
        away: "Forest",
      },
      evidence: [item],
      manager: { value: { home: { name: "Kieran McKenna remains Ipswich head coach.", tenureNote: null }, away: { name: null, tenureNote: null } } },
    } as Parameters<typeof managerNamesFromVerifiedDossier>[0];
    const allowed = managerNamesFromVerifiedDossier(dossier);
    const prose = "McKenna has Ipswich organized in a low block. If Postecoglou's lot nick one, the draw grows.";
    const clean = stripUnlistedManagers(prose, allowed);
    expect(clean).toMatch(/McKenna/);
    expect(clean).not.toMatch(/Postecoglou/i);
  });

  it("does not allowlist a prefix clause before the manager name (Postecoglou slip)", () => {
    const item = managerItem(
      "After Postecoglou left, Thomas Frank is the Tottenham head coach.",
      "Tottenham",
    );
    const dossier = {
      fixture: {
        fixtureId: "test",
        espnEventId: 1,
        competitionId: "eng.1",
        competition: "Premier League",
        kickoffUtc: "2026-10-24T15:00:00.000Z",
        home: "Tottenham",
        away: "Coventry",
      },
      evidence: [item],
      manager: {
        value: {
          home: { name: "Postecoglou remains Tottenham head coach.", tenureNote: null },
          away: { name: null, tenureNote: null },
        },
      },
    } as Parameters<typeof managerNamesFromVerifiedDossier>[0];
    const allowed = managerNamesFromVerifiedDossier(dossier);
    expect(allowed).toEqual(["Thomas Frank"]);
    expect(stripUnlistedManagers("Postecoglou's side sit deep.", allowed)).not.toMatch(/Postecoglou/i);
    expect(stripUnlistedManagers("Frank pushes high.", allowed)).toMatch(/Frank/i);
  });

  it("does not allow a stale structured slot when fresh evidence names someone else", () => {
    const fresh = managerItem("Thomas Frank is Tottenham head coach.", "Tottenham");
    const dossier = {
      fixture: {
        fixtureId: "test",
        espnEventId: 1,
        competitionId: "eng.1",
        competition: "Premier League",
        kickoffUtc: "2026-10-24T15:00:00.000Z",
        home: "Tottenham",
        away: "Coventry",
      },
      evidence: [fresh],
      manager: {
        value: {
          home: { name: "Postecoglou remains Tottenham head coach.", tenureNote: null },
          away: { name: null, tenureNote: null },
        },
      },
    } as Parameters<typeof managerNamesFromVerifiedDossier>[0];
    const allowed = managerNamesFromVerifiedDossier(dossier);
    expect(allowed).toEqual(["Thomas Frank"]);
    expect(stripUnlistedManagers("Postecoglou prefers a back five.", allowed)).not.toMatch(/Postecoglou/i);
  });
});
