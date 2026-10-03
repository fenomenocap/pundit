import { describe, expect, it } from "vitest";
import { stripUncitedResultClaims } from "./ask";

describe("stripUncitedResultClaims", () => {
  it("does not disclaim a result that a cited sentence still states", () => {
    const answer = [
      "PSG won the 2025 Champions League final, beating Inter 5-0 ([UEFA](https://www.uefa.com/a)).",
      "Inter lost the final to PSG, who lifted the trophy in Munich.",
      "This is general football analysis, not based on my match forecasts.",
    ].join(" ");
    const out = stripUncitedResultClaims(answer);
    expect(out).toContain("PSG won the 2025 Champions League final");
    expect(out).not.toContain("won’t state it");
  });

  it("still abstains when only uncited result claims existed", () => {
    const out = stripUncitedResultClaims(
      "Inter won the league title with 87 points and clinched it in April after a long run of wins."
    );
    expect(out).toContain("won’t state it");
  });
});
