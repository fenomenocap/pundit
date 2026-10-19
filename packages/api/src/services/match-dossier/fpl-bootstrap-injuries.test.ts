import { describe, expect, it, beforeEach } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  buildFplInjuryEvidenceForFixture,
  loadFplBootstrapFromRecordedFixture,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "./fpl-bootstrap-injuries";
import {
  isFplBootstrapInjuryItem,
  isTakeV2DossierEvidence,
  publicMatchDossierView,
} from "./types";
import { clubLabelForFplTeam } from "./fpl-bootstrap-injuries";
import { buildMatchDossierForFixture } from "./builder";

describe("FPL bootstrap-static injuries (interim)", () => {
  beforeEach(() => {
    resetFplBootstrapCacheForTests();
    process.env.MATCH_DOSSIER_FPL_ENABLED = "true";
  });

  it("emits structured FPL contract fields for fixture clubs", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Arsenal", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const items = buildFplInjuryEvidenceForFixture(row, "2026-10-19T12:00:00.000Z", snapshot);
    expect(items.length).toBe(2);
    const saka = items.find((i) => i.player === "Saka")!;
    expect(isFplBootstrapInjuryItem(saka)).toBe(true);
    expect(saka).toMatchObject({
      source: "fpl-bootstrap-static",
      tier: "interim",
      internalOnly: true,
      player: "Saka",
      club: "Arsenal",
      status: "d",
      chanceOfPlaying: 75,
      newsAddedAt: "2026-10-18T10:00:00.000Z",
      newsText: "Knock - 75% chance of playing",
    });
    expect(saka.claim).toBe("Saka (Arsenal)");
    expect(saka.claim).not.toContain("Knock");
    expect(items.find((i) => i.player === "Isak")?.club).toBe("Newcastle");
    expect(items.every((i) => !isTakeV2DossierEvidence(i))).toBe(true);
    expect(items.every((i) => isFplBootstrapInjuryItem(i))).toBe(true);
  });

  it("maps bootstrap team names to fixture home/away labels", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Arsenal", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const arsenal = snapshot.teams.find((t) => t.name === "Arsenal")!;
    expect(clubLabelForFplTeam(row, arsenal)).toBe("Arsenal");
  });

  it("merges into dossier injuries when cache warm; public view strips internalOnly", () => {
    setFplBootstrapCacheForTests(loadFplBootstrapFromRecordedFixture());
    const row = fixture("Arsenal", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const dossier = buildMatchDossierForFixture(row, { now: asOfDate() });
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(true);
    const pub = publicMatchDossierView(dossier);
    expect(pub.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
  });
});

function asOfDate(): Date {
  return new Date("2026-10-19T12:00:00.000Z");
}
