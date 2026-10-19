import { describe, expect, it, beforeEach } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  buildFplInjuryEvidenceForFixture,
  loadFplBootstrapFromRecordedFixture,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "./fpl-bootstrap-injuries";
import { isTakeV2DossierEvidence, publicMatchDossierView } from "./types";
import { buildMatchDossierForFixture } from "./builder";

describe("FPL bootstrap-static injuries (interim)", () => {
  beforeEach(() => {
    resetFplBootstrapCacheForTests();
    process.env.MATCH_DOSSIER_FPL_ENABLED = "true";
  });

  it("maps doubtful players for fixture clubs with news_added as publishedAt", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Arsenal", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const items = buildFplInjuryEvidenceForFixture(row, "2026-10-19T12:00:00.000Z", snapshot);
    expect(items.length).toBe(2);
    expect(items.every((i) => i.source === "fpl-bootstrap-static" && i.internalOnly === true)).toBe(true);
    expect(items.find((i) => i.claim.includes("Saka"))?.publishedAt).toBe("2026-10-18T10:00:00.000Z");
    expect(items.every((i) => !isTakeV2DossierEvidence(i))).toBe(true);
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
