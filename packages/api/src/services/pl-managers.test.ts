import { describe, expect, it } from "vitest";
import { managerForClub, stripUnlistedManagers } from "./pl-managers";
import { card } from "./desk-voice";
import type { Grounding } from "./ask";

function match(over: Partial<Grounding> = {}): Grounding {
  return {
    kind: "match",
    fixtureId: "espn:eng.1:derby",
    competitionId: "eng.1",
    competition: "Premier League",
    homeFieldAdvantage: true,
    date: "2026-09-14",
    stage: "match",
    home: "Manchester United",
    away: "Manchester City",
    pHome: 0.26,
    pDraw: 0.21,
    pAway: 0.53,
    pOver2_5: 0.51,
    pUnder2_5: 0.49,
    pBttsYes: 0.53,
    pBttsNo: 0.47,
    topScores: [],
    scorelines: [],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    oddsSources: [],
    pricing: {
      pHome: 0.26,
      pDraw: 0.21,
      pAway: 0.53,
    } as unknown as Grounding["pricing"],
    marketDivergence: [],
    ...over,
  };
}

describe("2026/27 dugout", () => {
  it("resolves United and City to Carrick and Maresca", () => {
    expect(managerForClub("Manchester United")?.manager).toBe("Michael Carrick");
    expect(managerForClub("Man Utd")?.manager).toBe("Michael Carrick");
    expect(managerForClub("Manchester City")?.manager).toBe("Enzo Maresca");
    expect(managerForClub("Liverpool")?.manager).toBe("Andoni Iraola");
  });

  it("puts those names on the desk card", () => {
    const text = card(match());
    expect(text).toContain("Michael Carrick");
    expect(text).toContain("Enzo Maresca");
    expect(text).not.toContain("Amorim");
    expect(text).not.toContain("Guardiola");
  });

  it("strips Amorim when he is not on the card", () => {
    const prose = [
      "City control the chance map.",
      "If Amorim's lot nick an early one, the 1-1 modal jumps.",
      "Model leans the away side at 53%.",
    ].join(" ");
    const clean = stripUnlistedManagers(prose, ["Michael Carrick", "Enzo Maresca"]);
    expect(clean).toContain("City control the chance map");
    expect(clean).toContain("Model leans the away side");
    expect(clean).not.toMatch(/Amorim/i);
  });
});
