import { describe, expect, it } from "vitest";
import { formalClubNamesInText, shouldUseFormalClubNames } from "./display-club-names";

describe("formalClubNamesInText", () => {
  it("uses the web's full club names", () => {
    expect(formalClubNamesInText("Most likely on Aston Villa v Man City: 1-2. (Man City win, 50.3%)"))
      .toBe("Most likely on Aston Villa v Manchester City: 1-2. (Manchester City win, 50.3%)");
    expect(formalClubNamesInText("Most likely on Hull v Brentford: 0-1.")).toBe("Most likely on Hull City v Brentford: 0-1.");
    expect(formalClubNamesInText("Chelsea v Man United; Forest v Leeds; Coventry v Ipswich"))
      .toBe("Chelsea v Manchester United; Nott'm Forest v Leeds United; Coventry City v Ipswich Town");
  });
  it("leaves names that are already full", () => {
    const text = "Hull City, Manchester City, Nott'm Forest, Nottingham Forest, Leeds United, Ipswich Town, Coventry City";
    expect(formalClubNamesInText(text)).toBe(text);
  });
  it("applies to English-league and non-match answers only", () => {
    expect(shouldUseFormalClubNames({ kind: "match", competitionId: "eng.1" })).toBe(true);
    expect(shouldUseFormalClubNames({ kind: "match", competitionId: "uefa.champions" })).toBe(false);
    expect(shouldUseFormalClubNames(null)).toBe(true);
  });
});
