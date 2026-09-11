import { describe, expect, it } from "vitest";
import { stripUnlistedManagers, managersNamedInEvidence } from "./pl-managers";
import { card, DESK_SYSTEM, formatSearchEvidence, humaniseDeskCitationDates, stripDeskBoardRecitals } from "./desk-voice";
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
    expect(text).toMatch(/SEARCH EVIDENCE|this turn/);
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
    expect(block).toContain("22 May");
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

  it("keeps a cited current coach named in this turn's evidence and still strips Amorim", () => {
    const evidence = [{
      title: "Manchester United appoint Michael Carrick as permanent head coach",
      snippet: "Carrick has been United head coach since January 2026. Guardiola remains at City.",
    }];
    const allowed = managersNamedInEvidence(evidence);
    expect(allowed.some((name) => /guardiola/i.test(name))).toBe(true);
    const prose = [
      "Carrick has United in a 4-2-3-1 [[S1]].",
      "Guardiola still manages City [[S2]].",
      "If Amorim's lot nick an early one, the 1-1 modal jumps.",
    ].join(" ");
    const clean = stripUnlistedManagers(prose, allowed);
    expect(clean).toMatch(/Carrick/);
    expect(clean).toMatch(/Guardiola/);
    expect(clean).not.toMatch(/Amorim/i);
  });

  it("formats search evidence with [[S]] markers for desk citations", () => {
    const block = formatSearchEvidence([
      {
        id: "S1",
        title: "Manchester United appoint Michael Carrick as permanent head coach",
        snippet: "Carrick has been United head coach since January 2026.",
        date: "2026-05-22",
      },
    ]);
    expect(block).toContain("[[S1]]");
    expect(block).toContain("22 May");
    expect(block).not.toMatch(/^\[1\]/m);
  });
});

describe("desk football voice", () => {
  it("forbids MiniMax from reciting board numbers or hedge-fund jargon", () => {
    expect(DESK_SYSTEM).toMatch(/Do not print probabilities/);
    expect(DESK_SYSTEM).toMatch(/Do not author EV%/);
    expect(DESK_SYSTEM).not.toMatch(/Put a number on it/);
    expect(DESK_SYSTEM).not.toMatch(/Never print EV%/);
    expect(DESK_SYSTEM).toMatch(/Never paste a URL/);
    expect(DESK_SYSTEM).toMatch(/2–4 sentences/);
    expect(DESK_SYSTEM).toMatch(/Do not use numbered lists/);
    expect(DESK_SYSTEM).toMatch(/category error/);
  });

  it("strips leftover percent and odds recitals from a football take", () => {
    const leaked = [
      "City should control territory and wait for the extra man in the box.",
      "I make City 53% and United 26%, fair 1.89.",
      "BTTS sits at 53%.",
      "Over 2.5 is a coin flip on the shared 2.70 xG.",
      "Who decides it is the first goal in behind.",
    ].join(" ");
    const clean = stripDeskBoardRecitals(leaked);
    expect(clean).toContain("City should control territory");
    expect(clean).toContain("Who decides it is the first goal in behind.");
    expect(clean).not.toMatch(/%/);
    expect(clean).not.toMatch(/fair 1\.89/i);
    expect(clean).not.toMatch(/BTTS/i);
    expect(clean).not.toMatch(/Over 2\.5/i);
  });

  it("strips a bare 1X2 recital without percent signs", () => {
    const clean = stripDeskBoardRecitals(
      "Chelsea should play through the half-spaces. Chelsea 79/16/5 on the card. Who decides it is the first ball in behind."
    );
    expect(clean).toContain("Chelsea should play through the half-spaces.");
    expect(clean).toContain("Who decides it is the first ball in behind.");
    expect(clean).not.toMatch(/79\/16\/5/);
  });

  it("shortens a citation ISO instant to a short date", () => {
    const out = humaniseDeskCitationDates(
      "Jackson is a doubt ([Chelsea XI vs Leeds](https://www.standard.co.uk/x), 2026-09-09T17:47:51.000Z)."
    );
    expect(out).toContain("9 Sep");
    expect(out).not.toContain("T17:47:51");
    expect(out).toContain("](https://www.standard.co.uk/x)");
  });
});
