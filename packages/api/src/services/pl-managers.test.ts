import { describe, expect, it } from "vitest";
import { managerForClub, stripUnlistedManagers } from "./pl-managers";
import { card, formatSearchEvidence } from "./desk-voice";
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

describe("desk current-world facts", () => {
  it("does not print a sealed dugout on the engine card", () => {
    const text = card(match());
    expect(text).not.toContain("Amorim");
    expect(text).not.toContain("Guardiola");
    expect(text).not.toContain("Carrick");
    expect(text).toMatch(/SEARCH EVIDENCE|not a model input/);
  });

  it("formats dated search snippets for the model", () => {
    const block = formatSearchEvidence([
      {
        title: "Manchester United appoint Michael Carrick as permanent head coach",
        link: "https://example.com/carrick",
        snippet: "Carrick has been United head coach since January 2026.",
        date: "2026-05-22",
      },
    ]);
    expect(block).toContain("2026-05-22");
    expect(block).toContain("Carrick");
    expect(block).toContain("SEARCH EVIDENCE");
  });

  it("strips Amorim when search did not establish him", () => {
    const prose = [
      "City control the chance map.",
      "If Amorim's lot nick an early one, the 1-1 modal jumps.",
      "Model leans the away side at 53%.",
    ].join(" ");
    const clean = stripUnlistedManagers(prose, []);
    expect(clean).toContain("City control the chance map");
    expect(clean).not.toMatch(/Amorim/i);
  });

  it("still knows the 2026/27 snapshot for tests", () => {
    expect(managerForClub("Manchester United")?.manager).toBe("Michael Carrick");
    expect(managerForClub("Manchester City")?.manager).toBe("Enzo Maresca");
  });
});
