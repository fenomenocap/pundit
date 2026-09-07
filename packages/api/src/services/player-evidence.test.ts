import { describe, expect, it } from "vitest";
import { composeMatchResponse, composePlayerScorerAnswer } from "./response-composer";
import { planResponse } from "./response-plan";
import {
  PLAYER_SCORER_ABSTENTION,
  extractPlayerEvidence,
  hasTrustworthyPlayerEvidence,
  leadingScorerCandidate,
  type PlayerEvidenceSource,
  type PlayerFixtureRef,
} from "./player-evidence";

const fixture: PlayerFixtureRef = {
  fixtureId: "eng.1:1",
  home: "Arsenal",
  away: "Chelsea",
  kickoff: "2026-09-12T14:00:00Z",
};

const source = (over: Partial<PlayerEvidenceSource> = {}): PlayerEvidenceSource => ({
  id: "S1",
  title: "Chelsea vs Arsenal anytime scorer odds",
  url: "https://example.com/scorers",
  date: "2026-09-11T08:00:00Z",
  snippet: "Cole Palmer anytime 2.10, Cole Palmer expected to start for Chelsea.",
  ...over,
});

describe("player evidence adapter", () => {
  it("extracts a dated player-market quote bound to the fixture", () => {
    const bundle = extractPlayerEvidence([source()], fixture);
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    const lead = leadingScorerCandidate(bundle);
    expect(lead?.playerName).toBe("Cole Palmer");
    expect(lead?.teamId).toBe("Chelsea");
    expect(lead?.decimalOdds).toBe(2.1);
    expect(lead?.impliedProbability).toBeCloseTo(1 / 2.1);
    expect(lead?.sourceId).toBe("S1");
  });

  it("drops stale, undated, unidentified, and off-fixture names", () => {
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      date: "2026-08-01T00:00:00Z",
    })], fixture))).toBe(false);
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      date: "",
    })], fixture))).toBe(false);
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      title: "Premier League odds",
      snippet: "Anytime 2.10",
    })], fixture))).toBe(false);
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      snippet: "Zlatan Ibrahimovic anytime 1.50 for AC Milan",
      title: "Serie A scorers",
    })], fixture))).toBe(false);
  });

  it("drops contradictory lineup status for the same player", () => {
    const bundle = extractPlayerEvidence([
      source({
        id: "S1",
        snippet: "Cole Palmer anytime 2.10, Cole Palmer expected to start for Chelsea.",
        title: "Chelsea lineup",
      }),
      source({
        id: "S2",
        title: "Chelsea injury news",
        snippet: "Cole Palmer ruled out for Chelsea.",
        date: "2026-09-11T12:00:00Z",
      }),
    ], fixture);
    expect(bundle.observations).toEqual([]);
    expect(bundle.markets).toEqual([]);
  });

  it("composes a labelled market observation without a Pundit scorer probability", () => {
    const evidence = extractPlayerEvidence([source()], fixture);
    const answer = composePlayerScorerAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, evidence);
    expect(answer).toMatch(/Cole Palmer/);
    expect(answer).toMatch(/2\.10 decimal \[\[S1\]\]/);
    expect(answer).toMatch(/don't treat that quote as a Pundit probability/i);
    expect(answer).not.toMatch(/I make Cole Palmer \d/);
    expect(answer).not.toMatch(/My short answer is/);
  });

  it("abstains when evidence is missing or unusable", () => {
    expect(composePlayerScorerAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, extractPlayerEvidence([], fixture))).toBe(PLAYER_SCORER_ABSTENTION);
    expect(composeMatchResponse(
      "Who scores?",
      { kind: "match", fixtureId: fixture.fixtureId, home: fixture.home, away: fixture.away, date: fixture.kickoff } as never,
      planResponse("Who scores?", { groundingKind: "match", hasHistory: true })
    )).toBe(PLAYER_SCORER_ABSTENTION);
  });
});
