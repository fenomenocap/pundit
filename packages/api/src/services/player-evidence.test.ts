import { describe, expect, it } from "vitest";
import { composeMatchResponse, composePlayerScorerAnswer, composeTeamNewsAnswer } from "./response-composer";
import { planResponse } from "./response-plan";
import {
  PLAYER_SCORER_ABSTENTION,
  TEAM_NEWS_COMPOSE_ABSTENTION,
  extractPlayerEvidence,
  hasTeamNewsEvidence,
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

  it("drops stale, unidentified, and off-fixture names", () => {
    expect(hasTrustworthyPlayerEvidence(extractPlayerEvidence([source({
      date: "2026-08-01T00:00:00Z",
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

  it("keeps a fixture-bound undated market quote and labels it undated", () => {
    const bundle = extractPlayerEvidence([source({ date: "" })], fixture);
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    expect(leadingScorerCandidate(bundle)?.observedAt).toBeNull();
  });

  it("extracts fractional list quotes on a Home vs Away title without inventing a side", () => {
    const bundle = extractPlayerEvidence([{
      id: "S1",
      title: "Sky Sports Bournemouth vs Brentford scorer odds",
      url: "https://example.com/scorers",
      date: "2026-09-11T08:00:00Z",
      snippet: "Semenyo 11/4 anytime, Wissa 2.1 to score",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    const lead = leadingScorerCandidate(bundle);
    expect(lead?.playerName).toBe("Wissa");
    expect(lead?.decimalOdds).toBe(2.1);
    expect(bundle.markets.some((row) => row.playerName === "Semenyo" && row.decimalOdds === 3.75)).toBe(true);
  });

  it("strips Oddschecker See All Odds chrome and keeps the real anytime price", () => {
    const bundle = extractPlayerEvidence([{
      id: "S4",
      title: "Bournemouth vs Brentford Betting Odds",
      url: "https://www.oddschecker.com/football/english/premier-league/bournemouth-v-brentford/winner",
      date: "",
      snippet: "Anytime Goalscorer. Igor Thiago See All Odds (1). 5/4. Evanilson See All Odds ... To Score 2 Or More Goals.",
    }], {
      fixtureId: "eng.1:bournemouth-brentford",
      home: "Bournemouth",
      away: "Brentford",
      kickoff: "2026-09-12T14:00:00Z",
    });
    expect(hasTrustworthyPlayerEvidence(bundle)).toBe(true);
    expect(leadingScorerCandidate(bundle)?.playerName).toBe("Igor Thiago");
    expect(leadingScorerCandidate(bundle)?.decimalOdds).toBe(2.25);
    expect(bundle.markets.some((row) => /see/i.test(row.playerName))).toBe(false);
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

  it("composes sourced availability and abstains when team news is empty", () => {
    const evidence = extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea team news",
      url: "https://example.com/news",
      date: "2026-09-11T08:00:00Z",
      snippet: "Cole Palmer ruled out for Chelsea.",
    }], fixture);
    expect(hasTeamNewsEvidence(evidence)).toBe(true);
    const answer = composeTeamNewsAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, evidence);
    expect(answer).toMatch(/Cole Palmer/);
    expect(answer).toMatch(/unavailable/);
    expect(answer).toMatch(/not a revised match forecast/i);
    expect(composeTeamNewsAnswer({
      kind: "match",
      fixtureId: fixture.fixtureId,
      home: fixture.home,
      away: fixture.away,
      date: fixture.kickoff,
    } as never, extractPlayerEvidence([], fixture))).toBe(TEAM_NEWS_COMPOSE_ABSTENTION);
    expect(hasTeamNewsEvidence(extractPlayerEvidence([{
      id: "S1",
      title: "Arsenal vs Chelsea team news",
      url: "https://example.com/news",
      date: "",
      snippet: "Cole Palmer ruled out for Chelsea.",
    }], fixture))).toBe(false);
  });
});
