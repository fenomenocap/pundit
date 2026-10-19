import { describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { extractClaimKeyTokens, verifyClaimAgainstPageText } from "./dossier-claim-page-verify";
import { DOSSIER_SYNTHETIC_AWAY, DOSSIER_SYNTHETIC_HOME } from "./dossier-synthetic-fixture";

describe("dossier claim page verify", () => {
  it("extracts team and name tokens from claims", () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY);
    const keys = extractClaimKeyTokens(
      "SYNTHETIC CI — North Testborough striker Test Player Alpha doubtful",
      row,
    );
    expect(keys.some((k) => k.includes("testborough"))).toBe(true);
    expect(keys.some((k) => k.includes("alpha"))).toBe(true);
  });

  it("passes when entities and numbers appear on page", () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY);
    const claim = "North Testborough FC injury — Test Player Alpha is doubtful.";
    const page = `
      Team news for North Testborough FC ahead of the South Example City match.
      Test Player Alpha is doubtful and may miss the fixture. Squad number 14.
    `;
    const result = verifyClaimAgainstPageText(claim, page, row);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchedSnippet.length).toBeGreaterThan(10);
      expect(result.contentSha256).toHaveLength(64);
    }
  });

  it("fails when key numbers are absent", () => {
    const row = fixture("Arsenal", "Everton");
    const result = verifyClaimAgainstPageText(
      "Arsenal have won 12 of their last 15 home matches",
      "Arsenal beat Everton in a close game with strong pressing.",
      row,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/number_not_on_page/);
  });
});
